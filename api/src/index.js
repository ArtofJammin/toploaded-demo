// Top Loaded TCG API — Cloudflare Worker entry.
// Routes live in ./routes/*.js; each exports register(router). Paths have no
// "/api" prefix (the local dev server strips it). See README.md for the endpoint list.
import { Router } from './lib/router.js';
import { HttpError, json, corsHeaders, clientIp } from './lib/http.js';
import { attachAuth } from './lib/auth.js';
import * as health from './routes/health.js';
import * as config from './routes/config.js';
import * as auth from './routes/auth.js';
import * as forms from './routes/forms.js';
import * as checkout from './routes/checkout.js';
import * as square from './routes/square.js';
import * as alerts from './routes/alerts.js';
import * as credit from './routes/credit.js';
import * as live from './routes/live.js';
import * as inventory from './routes/inventory.js';
import * as price from './routes/price.js';

export const router = new Router();
for (const m of [health, config, auth, forms, checkout, square, alerts, credit, live, inventory, price]) {
  if (typeof m.register === 'function') m.register(router);
}

export async function handle(req, env, exec) {
  const cors = corsHeaders(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const ctx = { req, env, exec, url, params: {}, ip: clientIp(req), auth: null };
  try {
    await attachAuth(ctx);
    const res = await router.handle(ctx);
    for (const [k, val] of Object.entries(cors)) res.headers.set(k, val);
    return res;
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error('[api]', req.method, url.pathname, e && e.stack || e);
    const body = { error: e instanceof HttpError ? e.message : 'internal error' };
    if (e instanceof HttpError && e.extra) Object.assign(body, e.extra);
    const headers = { ...cors };
    if (e && e.retryAfter) headers['retry-after'] = String(e.retryAfter);
    return json(body, status, headers);
  }
}

export default {
  fetch: (req, env, exec) => handle(req, env, exec),
  // Daily housekeeping. Inventory sync itself runs as a GitHub Action (see
  // .github/workflows/inventory.yml); this only prunes and warms caches.
  async scheduled(event, env, exec) {
    exec.waitUntil(inventory.scheduledMaintenance ? inventory.scheduledMaintenance(env) : Promise.resolve());
  },
};
