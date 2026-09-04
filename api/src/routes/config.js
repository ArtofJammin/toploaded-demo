// Site configuration (hours, banner, show, events, live state, links…).
//   GET /config          public  → merged {defaults ← KV "config"}
//   PUT /config          admin   → deep-merge patch into KV "config", returns merged config
//   DELETE /config       admin   → reset to defaults
// The shape is config.default.json. Unknown top-level keys are rejected so a typo
// in the admin UI cannot bloat the record.
import { getJSON, putJSON } from '../lib/kv.js';
import { HttpError, readJson } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { DEFAULT_CONFIG, deepMerge } from '../defaults.js';

const MAX_BYTES = 200 * 1024; // logo data-URLs are the only big thing

// Shape rules for a patch: type per top-level key, URL schemes for links, an
// allowlist of stream hosts, string length caps, bounded nesting.
const TYPES = {
  title: 'string', tagline: 'string', phone: 'string', phoneRaw: 'string', email: 'string', timezone: 'string',
  address: 'object', hours: 'object', hoursText: 'object', banner: 'object', logo: 'string?', show: 'object',
  events: 'array', live: 'object', links: 'object', buy: 'object', ticker: 'array', testimonials: 'array',
  rip: 'object', updatedAt: 'string?',
};
const EMBED_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'twitch.tv', 'www.twitch.tv', 'player.twitch.tv', 'whatnot.com', 'www.whatnot.com'];
function isHttpUrl(u) { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } }
function checkStrings(node, path, depth) {
  if (depth > 6) throw new HttpError(400, `${path} is nested too deeply`);
  if (typeof node === 'string') {
    if (path !== 'logo' && node.length > 2000) throw new HttpError(400, `${path} is too long`);
    if (/^\s*(javascript|data|vbscript):/i.test(node) && path !== 'logo') throw new HttpError(400, `${path} has a disallowed URL scheme`);
    return;
  }
  if (Array.isArray(node)) { if (node.length > 200) throw new HttpError(400, `${path} has too many entries`); node.forEach((v, i) => checkStrings(v, `${path}[${i}]`, depth + 1)); return; }
  if (node && typeof node === 'object') { for (const [k, v] of Object.entries(node)) checkStrings(v, `${path}.${k}`, depth + 1); }
}
export function validatePatch(patch) {
  for (const [k, val] of Object.entries(patch)) {
    const t = TYPES[k];
    if (!t) throw new HttpError(400, `unknown setting "${k}"`);
    const base = t.replace('?', '');
    const ok = (val === null && t.endsWith('?')) ||
      (base === 'string' && typeof val === 'string') ||
      (base === 'array' && Array.isArray(val)) ||
      (base === 'object' && val && typeof val === 'object' && !Array.isArray(val));
    if (!ok) throw new HttpError(400, `"${k}" must be ${t.endsWith('?') ? 'a ' + base + ' or null' : (base === 'array' ? 'a list' : 'a ' + base)}`);
    checkStrings(val, k, 0);
  }
  if (typeof patch.logo === 'string' && patch.logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(patch.logo)) {
    throw new HttpError(400, 'logo must be a PNG/JPEG/WebP/SVG data URL');
  }
  if (patch.links) for (const [k, u] of Object.entries(patch.links)) {
    if (u === '' || u === null) continue;
    if (typeof u !== 'string' || !isHttpUrl(u)) throw new HttpError(400, `links.${k} must be an http(s) URL`);
  }
  if (patch.live && typeof patch.live.embed === 'string' && patch.live.embed) {
    let host = '';
    try { const u = new URL(patch.live.embed); if (u.protocol !== 'https:') throw 0; host = u.hostname.toLowerCase(); } catch { throw new HttpError(400, 'live.embed must be an https URL'); }
    if (!EMBED_HOSTS.includes(host)) throw new HttpError(400, 'live.embed must be a YouTube, Twitch or Whatnot URL');
  }
  if (patch.hours) for (const [d, v] of Object.entries(patch.hours)) {
    if (v === null) continue;
    if (!Array.isArray(v) || v.length !== 2 || !v.every(x => typeof x === 'string' && /^\d{2}:\d{2}$/.test(x))) throw new HttpError(400, `hours.${d} must be null or ["HH:MM","HH:MM"]`);
  }
  if (patch.events) for (const [i, ev] of patch.events.entries()) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw new HttpError(400, `events[${i}] must be an object`);
    if (ev.dow !== undefined && !(Number.isInteger(ev.dow) && ev.dow >= 0 && ev.dow <= 6)) throw new HttpError(400, `events[${i}].dow must be 0-6`);
  }
  if (patch.ticker) for (const [i, row] of patch.ticker.entries()) {
    if (!Array.isArray(row) || row.length !== 2 || !row.every(x => typeof x === 'string')) throw new HttpError(400, `ticker[${i}] must be [label, price]`);
  }
}

export async function loadConfig(env) {
  const stored = await getJSON(env.KV, 'config', {});
  return deepMerge(DEFAULT_CONFIG, stored || {});
}

export function register(r) {
  r.get('/config', async ({ env }) => loadConfig(env));

  r.put('/config', requireRole('admin'), async ({ env, req }) => {
    const patch = await readJson(req, MAX_BYTES);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'patch must be an object');
    for (const k of Object.keys(patch)) {
      if (!(k in DEFAULT_CONFIG)) throw new HttpError(400, `unknown setting "${k}"`);
    }
    validatePatch(patch);
    const stored = (await getJSON(env.KV, 'config', {})) || {};
    const next = deepMerge(stored, patch);
    next.updatedAt = new Date().toISOString();
    await putJSON(env.KV, 'config', next);
    return deepMerge(DEFAULT_CONFIG, next);
  });

  r.delete('/config', requireRole('admin'), async ({ env }) => {
    await env.KV.delete('config');
    return DEFAULT_CONFIG;
  });
}
