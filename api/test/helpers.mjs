// Test helpers: spin up the worker in-process with a MemoryKV and call routes.
import { createHash } from 'node:crypto';
import worker from '../src/index.js';
import { MemoryKV } from '../src/lib/memory-kv.js';

export const sha = (s) => createHash('sha256').update(s).digest('hex');

export function makeEnv(extra = {}) {
  return {
    KV: new MemoryKV(),
    SITE_ORIGIN: 'https://artofjammin.github.io',
    SQUARE_ENV: 'sandbox',
    SITE_URL: 'https://artofjammin.github.io/toploaded-demo/',
    TOKEN_SECRET: 'test-secret',
    STAFF_PIN_HASH: sha('staff'),
    ADMIN_PIN_HASH: sha('admin'),
    ...extra,
  };
}

export function client(env) {
  const exec = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
  async function call(method, path, body, { token, headers = {}, raw } = {}) {
    const h = { 'content-type': 'application/json', origin: 'https://artofjammin.github.io', 'cf-connecting-ip': '1.2.3.4', ...headers };
    if (token) h.authorization = 'Bearer ' + token;
    const req = new Request('https://api.test' + path, { method, headers: h, body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)) });
    const res = await worker.fetch(req, env, exec);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    call,
    get: (p, o) => call('GET', p, undefined, o),
    post: (p, b, o) => call('POST', p, b, o),
    put: (p, b, o) => call('PUT', p, b, o),
    del: (p, o) => call('DELETE', p, undefined, o),
    async login(pin) { const r = await call('POST', '/auth/login', { pin }); return r.data.token; },
  };
}
