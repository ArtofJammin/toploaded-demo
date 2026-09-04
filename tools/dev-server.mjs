#!/usr/bin/env node
// Local dev server: builds the site, serves the repo root as static files, and
// mounts the Cloudflare Worker from api/ at /api/* with an in-memory KV (persisted
// to tools/.dev-kv.json so admin edits survive restarts). Zero dependencies.
//
//   node tools/dev-server.mjs            → http://localhost:8787
//   node tools/dev-server.mjs --port 3000 --no-watch --fresh
//
// Secrets: copy api/.dev.vars.example to api/.dev.vars (KEY=VALUE lines). Without
// it the dev passcodes are staff / admin and every integration runs in dry-run mode.
//   POST /api/__scheduled  triggers the worker's cron handler by hand.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, watch } from 'node:fs';
import { join, dirname, resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from './build.mjs';
import workerModule from '../api/src/index.js';
let worker = workerModule;
import { MemoryKV } from '../api/src/lib/memory-kv.js';

const tools = dirname(fileURLToPath(import.meta.url));
const repo = resolve(tools, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(process.env.PORT || opt('--port', 8787));
const KV_FILE = join(tools, '.dev-kv.json');

// ---- env / secrets ----
function loadDevVars() {
  const out = {};
  const f = join(repo, 'api', '.dev.vars');
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const sha = (s) => createHash('sha256').update(s).digest('hex');
const vars = loadDevVars();
const staffPin = vars.DEV_STAFF_PIN || 'staff';
const adminPin = vars.DEV_ADMIN_PIN || 'admin';
const env = {
  SITE_ORIGIN: '*',
  SQUARE_ENV: 'sandbox',
  GITHUB_REPO: 'ArtofJammin/toploaded-demo',
  GITHUB_WORKFLOW: 'inventory.yml',
  SITE_URL: `http://localhost:${PORT}/`,
  TOKEN_SECRET: 'dev-secret-not-for-production',
  STAFF_PIN_HASH: sha(staffPin),
  ADMIN_PIN_HASH: sha(adminPin),
  ...vars,
};
if (!vars.STAFF_PIN_HASH) env.STAFF_PIN_HASH = sha(staffPin);
if (!vars.ADMIN_PIN_HASH) env.ADMIN_PIN_HASH = sha(adminPin);

// ---- KV ----
let initial = {};
if (!flag('--fresh') && existsSync(KV_FILE)) { try { initial = JSON.parse(readFileSync(KV_FILE, 'utf8')); } catch {} }
env.KV = new MemoryKV(initial);
let saveTimer = null;
env.KV.onChange = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeFileSync(KV_FILE, JSON.stringify(env.KV.toJSON(), null, 1)), 150); };
const exec = { waitUntil: (p) => Promise.resolve(p).catch(e => console.error('[waitUntil]', e)), passThroughOnException() {} };

// ---- static ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.ics': 'text/calendar' };
function serveStatic(pathname, res) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = normalize(join(repo, p));
  if (!file.startsWith(repo) || file.includes(join(repo, '.git')) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}

// ---- worker bridge ----
async function serveApi(req, res, pathname) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = new URL(pathname + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), `http://localhost:${PORT}`);
  const headers = new Headers();
  for (const [k, val] of Object.entries(req.headers)) if (typeof val === 'string') headers.set(k, val);
  headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
  const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  let response;
  if (pathname === '/__scheduled' && req.method === 'POST') {
    await worker.scheduled({ cron: 'manual', scheduledTime: Date.now() }, env, exec);
    response = new Response(JSON.stringify({ ok: true, ran: 'scheduled' }), { headers: { 'content-type': 'application/json' } });
  } else {
    response = await worker.fetch(request, env, exec);
  }
  const out = {};
  response.headers.forEach((val, k) => { out[k] = val; });
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

// ---- build + watch ----
build();
if (!flag('--no-watch')) {
  let t = null;
  const rebuild = () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error('[build]', e.message); } }, 120); };
  for (const d of ['src', 'src/css', 'src/html', 'src/js']) { const dir = join(repo, d); if (existsSync(dir)) watch(dir, rebuild); }
  watch(join(repo, 'config.default.json'), rebuild);
  // api/src changes: re-import the worker with a cache-busting query so new routes load without a restart
  let at = null;
  const reloadWorker = () => { clearTimeout(at); at = setTimeout(async () => {
    try { worker = (await import(`../api/src/index.js?t=${Date.now()}`)).default; console.log('[api] worker reloaded'); }
    catch (e) { console.error('[api] reload failed:', e.message); }
  }, 200); };
  for (const d of ['api/src', 'api/src/routes', 'api/src/lib']) { const dir = join(repo, d); if (existsSync(dir)) watch(dir, reloadWorker); }
}

createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  try {
    if (pathname === '/api' || pathname.startsWith('/api/')) await serveApi(req, res, pathname.slice(4) || '/');
    else serveStatic(pathname, res);
  } catch (e) {
    console.error('[dev]', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('server error: ' + (e && e.message));
  }
}).listen(PORT, () => {
  console.log(`Top Loaded dev server → http://localhost:${PORT}   (API at /api, KV in ${KV_FILE})`);
  console.log(`Dev passcodes: staff="${staffPin}"  admin="${adminPin}"  (override in api/.dev.vars)`);
});
