// Inventory freshness + admin "Sync now".
//   GET  /inventory/status        → {generated, products, listings, units, lastRun:{at, ok, message, dispatched?}, syncing, hooks, square, github, cached}
//                                   `generated` etc. come from SITE_URL + inventory-summary.json (KV cache 5 min)
//   POST /inventory/sync  admin   → dispatches the GitHub Action (workflow_dispatch) and records lastRun
//                                   {ok:true, dispatched:true, runsUrl} | {ok:false, reason:"GITHUB_TOKEN not set"} (200)
//                                   429 when a dispatch happened in the last 10 minutes
// scheduledMaintenance(env) is called by the daily cron in index.js: prunes expired
// live spot claims, trims live chat to 60 and clears the status cache (then re-warms it).
import { HttpError } from '../lib/http.js';
import { getJSON, putJSON } from '../lib/kv.js';
import { requireRole } from '../lib/auth.js';
import { squareConfigured } from '../lib/square.js';
import { resetInventoryCache } from './price.js';

const STATUS_TTL = 5 * 60;
const SYNC_COOLDOWN_MS = 10 * 60 * 1000;
const SPOT_HOLD_MS = 6 * 3600 * 1000;
const GITHUB = 'https://api.github.com';

function siteUrl(env, file) {
  return String(env.SITE_URL || '').replace(/\/?$/, '/') + file;
}

// Fetches inventory-summary.json (no throw; null when unreachable).
async function fetchSummary(env) {
  try {
    const init = { headers: { accept: 'application/json', 'user-agent': 'toploaded-api' }, cf: { cacheTtl: 0 } };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(6000);
    const r = await fetch(siteUrl(env, 'inventory-summary.json'), init);
    if (!r.ok) return null;
    const s = await r.json();
    if (!s || typeof s !== 'object') return null;
    return {
      generated: s.generated || null,
      products: Number(s.products) || 0,
      listings: Number(s.listings) || 0,
      units: Number(s.units) || 0,
      games: s.games || null,
      fetchedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

// Cached summary (KV inventory:status, 5 min). force=true refetches.
export async function summaryStatus(env, { force = false } = {}) {
  if (!force) {
    const cached = await getJSON(env.KV, 'inventory:status', null);
    if (cached && cached.fetchedAt) return { ...cached, cached: true };
  }
  const fresh = await fetchSummary(env);
  if (fresh) {
    await putJSON(env.KV, 'inventory:status', fresh, { expirationTtl: STATUS_TTL });
    return { ...fresh, cached: false };
  }
  const stale = await getJSON(env.KV, 'inventory:status', null);
  return stale ? { ...stale, cached: true, stale: true } : { generated: null, products: 0, listings: 0, units: 0, fetchedAt: null, cached: false, unreachable: true };
}

function isSyncing(lastRun, generated) {
  if (!lastRun || !lastRun.at || !lastRun.dispatched) return false;
  const age = Date.now() - Date.parse(lastRun.at);
  if (!(age >= 0 && age < SYNC_COOLDOWN_MS)) return false;
  // Once the site publishes a summary newer than the dispatch the run is done.
  return !(generated && Date.parse(generated) > Date.parse(lastRun.at));
}

export function register(r) {
  r.get('/inventory/status', async ({ env }) => {
    const summary = await summaryStatus(env);
    const lastRun = (await getJSON(env.KV, 'inventory:lastRun', null)) || { at: null, ok: null, message: 'never run from the site' };
    const hooks = (await getJSON(env.KV, 'square:hooks:last', {})) || {};
    return {
      ...summary,
      lastRun,
      syncing: isSyncing(lastRun, summary.generated),
      hooks,
      square: { configured: squareConfigured(env), env: env.SQUARE_ENV || null, webhook: !!env.SQUARE_WEBHOOK_SIGNATURE_KEY },
      github: { configured: !!env.GITHUB_TOKEN, repo: env.GITHUB_REPO || null, workflow: env.GITHUB_WORKFLOW || 'inventory.yml' },
    };
  });

  r.post('/inventory/sync', requireRole('admin'), async ({ env }) => {
    const repo = env.GITHUB_REPO || 'ArtofJammin/toploaded-demo';
    const workflow = env.GITHUB_WORKFLOW || 'inventory.yml';
    const runsUrl = `https://github.com/${repo}/actions/workflows/${workflow}`;
    if (!env.GITHUB_TOKEN) {
      return { ok: false, dispatched: false, reason: 'GITHUB_TOKEN not set', runsUrl };
    }
    const prev = await getJSON(env.KV, 'inventory:lastRun', null);
    if (prev && prev.dispatched && prev.at && Date.now() - Date.parse(prev.at) < SYNC_COOLDOWN_MS) {
      const mins = Math.max(1, Math.round((Date.now() - Date.parse(prev.at)) / 60000));
      throw new HttpError(429, `a sync was already started ${mins} min ago — give it a few minutes`, { ok: false, dispatched: false, lastRun: prev, runsUrl });
    }
    const at = new Date().toISOString();
    let res, status = 0, detail = '';
    try {
      const init = {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'accept': 'application/vnd.github+json',
          'user-agent': 'toploaded-api',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: env.GITHUB_REF || 'main' }),
      };
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(8000);
      res = await fetch(`${GITHUB}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, init);
      status = res.status;
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        detail = (body && body.message) || (await res.text().catch(() => '')) || '';
      }
    } catch (e) {
      status = 0;
      detail = e && e.message ? e.message : 'network error';
    }
    const ok = status === 204 || status === 200;
    const message = ok ? 'sync requested — the site updates in a few minutes' : `GitHub ${status || 'unreachable'}${detail ? `: ${detail}` : ''}`;
    await putJSON(env.KV, 'inventory:lastRun', { at, ok, message, dispatched: ok, status });
    if (ok) await env.KV.delete('inventory:status');
    if (!ok) throw new HttpError(502, message, { ok: false, dispatched: false, runsUrl });
    return { ok: true, dispatched: true, at, runsUrl };
  });
}

// ---- daily housekeeping (index.js scheduled handler) ----
function claimExpired(c, now) {
  if (!c || typeof c !== 'object') return false;
  if (c.confirmed || c.paid) return false;
  if (c.expires) { const t = typeof c.expires === 'number' ? (c.expires < 1e12 ? c.expires * 1000 : c.expires) : Date.parse(c.expires); return Number.isFinite(t) && t < now; }
  const at = c.at || c.claimedAt || c.time;
  const t = typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : Date.parse(at);
  return Number.isFinite(t) && now - t > SPOT_HOLD_MS;
}

export async function scheduledMaintenance(env) {
  const now = Date.now();
  const report = { spotsPruned: 0, chatTrimmed: 0, statusRefreshed: false };
  try {
    const spots = await getJSON(env.KV, 'live:spots', null);
    if (Array.isArray(spots)) {
      const keep = spots.filter(c => !claimExpired(c, now));
      report.spotsPruned = spots.length - keep.length;
      if (report.spotsPruned) await putJSON(env.KV, 'live:spots', keep);
    } else if (spots && typeof spots === 'object') {
      const holder = Array.isArray(spots.taken) ? 'taken' : (Array.isArray(spots.claims) ? 'claims' : null);
      if (holder) {
        const keep = spots[holder].filter(c => !claimExpired(c, now));
        report.spotsPruned = spots[holder].length - keep.length;
        if (report.spotsPruned) await putJSON(env.KV, 'live:spots', { ...spots, [holder]: keep });
      } else {
        const next = {};
        for (const [k, c] of Object.entries(spots)) { if (claimExpired(c, now)) report.spotsPruned++; else next[k] = c; }
        if (report.spotsPruned) await putJSON(env.KV, 'live:spots', next);
      }
    }
  } catch (e) { console.error('[maintenance] spots', e && e.message); }
  try {
    const chat = await getJSON(env.KV, 'live:chat', null);
    if (Array.isArray(chat) && chat.length > 60) {
      // README: newest last → keep the tail.
      report.chatTrimmed = chat.length - 60;
      await putJSON(env.KV, 'live:chat', chat.slice(-60));
    }
  } catch (e) { console.error('[maintenance] chat', e && e.message); }
  try {
    await env.KV.delete('inventory:status');
    resetInventoryCache();
    const fresh = await summaryStatus(env, { force: true });
    report.statusRefreshed = !!fresh && !fresh.unreachable;
  } catch (e) { console.error('[maintenance] status', e && e.message); }
  return report;
}
