// Live break state: spot claims, chat and the viewer count.
//   GET  /live?sid=                  public → {live:config.live, spots:{taken,mine,price,total,claims}, viewers}
//   POST /live/spots/claim           public → {spot, name?, sid} claims spot n (6 h hold); 409 when someone else has it
//   POST /live/spots/release         public → {spot, sid} frees a spot you hold (staff can free any) → {ok, released, taken}
//   POST /live/spots/:n/confirm      staff  → mark a spot paid: no expiry
//   POST /live/spots/reset           staff  → clear every claim
//   GET  /live/chat?since=<ms|iso>   public → {messages:[newest last, ≤ 60], now, viewers}
//   POST /live/chat                  public → {user, text} → {ok, message}; 20 / min per IP, 200 chars, links + slurs filtered
//   POST /live/viewers               public → heartbeat {sid} → {viewers} (distinct sids seen in the last 60 s)
// KV: "live:spots" {claims:[{spot,name,sid,at,exp,expires,confirmed}]}, "live:chat" [messages], "live:viewers" {sid:ms}.
// (claims is an array so the daily cron in routes/inventory.js can prune it with the same rules.)
// KV has no compare-and-swap, so a claim writes then re-reads and yields if another sid won.
import { getJSON, putJSON } from '../lib/kv.js';
import { HttpError, readJson, v } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { loadConfig } from './config.js';

const SPOTS = 'live:spots';
const CHAT = 'live:chat';
const VIEWERS = 'live:viewers';
export const CLAIM_TTL_MS = 6 * 3600 * 1000;
export const CHAT_MAX = 60;
export const VIEWER_WINDOW_MS = 60 * 1000;
const VIEWERS_MAX = 2000;

function uid() {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return Date.now().toString(36) + r;
}
function cleanText(s, opts) {
  return v.str(String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' '), opts);
}
function optText(x, opts) { return (x === undefined || x === null || x === '') ? '' : cleanText(x, opts); }
function sidOf(x, { required = true } = {}) {
  if (x === undefined || x === null || x === '') {
    if (required) throw new HttpError(400, 'sid is required');
    return '';
  }
  const s = v.str(x, { max: 64, min: 6, name: 'sid' });
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new HttpError(400, 'sid looks wrong');
  return s;
}
function spotNum(x, total) {
  const n = v.num(x, { min: 1, max: total, name: 'spot' });
  if (!Number.isInteger(n)) throw new HttpError(400, 'spot must be a whole number');
  return n;
}
// "Mike Rivera" → "Mike R." for the public grid.
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

// ---- chat filters ----
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|tv|co|me|app|shop|store|xyz|info|biz|us|link|ly|cc|club|online|site)\b(?:\/[^\s]*)?/gi;
const SLUR_RE = /\b(?:f+u+c+k+|s+h+i+t+|b+i+t+c+h+|c+u+n+t+|a+s+s+h+o+l+e+|w+h+o+r+e+|s+l+u+t+|f+a+g+g*o*t*|n+i+g+g+(?:e+r+|a+)|r+e+t+a+r+d+|t+r+a+n+n+y+|k+i+k+e+|s+p+i+c+|c+h+i+n+k+|w+e+t+b+a+c+k+|d+y+k+e+|b+e+a+n+e+r+|c+o+o+n+|t+o+w+e+l+h+e+a+d+)(?:s|es|ing|er|ers|ed)?\b/gi;
export function filterChat(text) {
  return String(text || '')
    .replace(URL_RE, '[link removed]')
    .replace(SLUR_RE, '***')
    .replace(/\s+/g, ' ')
    .trim();
}
function userName(x) {
  const s = optText(x, { max: 24, name: 'user' }).replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim();
  return s || 'guest';
}

// ---- storage helpers ----
async function liveConfig(env) {
  const cfg = await loadConfig(env).catch(() => null);
  const live = (cfg && cfg.live && typeof cfg.live === 'object') ? cfg.live : {};
  const total = Number.isInteger(Number(live.spots)) && Number(live.spots) > 0 ? Math.min(200, Number(live.spots)) : 12;
  const price = Number.isFinite(Number(live.spotPrice)) ? Number(live.spotPrice) : 0;
  return { live, total, price };
}
// Claims keyed by spot number, with expired holds dropped (confirmed spots never
// expire). Accepts the stored array or an older {n: claim} map.
export async function loadClaims(env, now = Date.now()) {
  const doc = await getJSON(env.KV, SPOTS, null);
  const raw = doc && doc.claims ? doc.claims : {};
  const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([k, c]) => (c && typeof c === 'object' ? { spot: Number(k), ...c } : null));
  const claims = {};
  let changed = !Array.isArray(raw) && list.length > 0;
  for (const c of list) {
    const n = c && Number(c.spot);
    const bad = !c || typeof c !== 'object' || !Number.isInteger(n) || n < 1 || (!c.confirmed && c.exp && Date.parse(c.exp) <= now);
    if (bad) { changed = true; continue; }
    claims[n] = c;
  }
  return { claims, changed };
}
async function saveClaims(env, claims) {
  const list = nums(claims).map(n => claims[n]);
  await putJSON(env.KV, SPOTS, { claims: list, updatedAt: new Date().toISOString() });
}
const nums = (claims) => Object.keys(claims).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
function spotView(claims, sid, total, price) {
  const taken = nums(claims);
  const out = {
    taken,
    mine: sid ? taken.filter(n => claims[n] && claims[n].sid === sid) : [],
    open: Math.max(0, total - taken.length),
    total,
    price,
    claims: taken.map(n => ({ spot: n, name: shortName(claims[n].name), confirmed: !!claims[n].confirmed, exp: claims[n].confirmed ? null : claims[n].exp || null })),
  };
  return out;
}

async function readChat(env) {
  const list = await getJSON(env.KV, CHAT, []);
  return Array.isArray(list) ? list.filter(m => m && typeof m === 'object') : [];
}
export async function addChat(env, { user, text, sys = false }) {
  const list = await readChat(env);
  // ts is strictly increasing so ?since=<ts> never skips a same-millisecond neighbour.
  const last = list.length ? Number(list[list.length - 1].ts) || 0 : 0;
  const now = Math.max(Date.now(), last + 1);
  const message = { id: uid(), at: new Date(now).toISOString(), ts: now, user: sys ? 'system' : user, text };
  if (sys) message.sys = true;
  list.push(message);
  while (list.length > CHAT_MAX) list.shift();
  await putJSON(env.KV, CHAT, list);
  return message;
}

async function readViewers(env, now = Date.now()) {
  const map = await getJSON(env.KV, VIEWERS, {});
  const out = {};
  if (map && typeof map === 'object') {
    for (const [sid, ts] of Object.entries(map)) if (Number(ts) > now - VIEWER_WINDOW_MS) out[sid] = Number(ts);
  }
  return out;
}
export async function viewerCount(env) { return Object.keys(await readViewers(env)).length; }

// Cron hook: drop expired holds, stale viewers, and trim chat.
export async function pruneLive(env) {
  const { claims, changed } = await loadClaims(env);
  if (changed) await saveClaims(env, claims);
  await putJSON(env.KV, VIEWERS, await readViewers(env));
  const chat = await readChat(env);
  if (chat.length > CHAT_MAX) await putJSON(env.KV, CHAT, chat.slice(-CHAT_MAX));
  return { spots: nums(claims).length };
}

function parseSince(raw) {
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

export function register(r) {
  r.get('/live', async ({ env, url }) => {
    const sid = sidOf(url.searchParams.get('sid'), { required: false });
    const { live, total, price } = await liveConfig(env);
    const { claims, changed } = await loadClaims(env);
    if (changed) await saveClaims(env, claims);
    return { live, spots: spotView(claims, sid, total, price), viewers: await viewerCount(env), now: new Date().toISOString() };
  });

  r.post('/live/spots/claim', async ({ env, req, ip }) => {
    await rateLimit(env, `spot:${ip}`, { limit: 30, windowSec: 60 });
    const body = await readJson(req, 4096);
    const { total, price } = await liveConfig(env);
    const spot = spotNum(body.spot, total);
    const sid = sidOf(body.sid);
    const name = optText(body.name, { max: 24, name: 'name' });
    let { claims } = await loadClaims(env);
    const held = claims[spot];
    if (held && held.sid !== sid) throw new HttpError(409, `spot #${spot} is taken`, { spot, taken: nums(claims) });
    if (held) {
      if (name && !held.name) { held.name = name; await saveClaims(env, claims); }
      return { ok: true, spot, exp: held.confirmed ? null : held.exp, name: held.name || '', ...spotView(claims, sid, total, price) };
    }
    const now = Date.now();
    const exp = new Date(now + CLAIM_TTL_MS).toISOString();
    const claim = { spot, name, sid, at: new Date(now).toISOString(), exp, expires: exp, confirmed: false };
    claims[spot] = claim;
    await saveClaims(env, claims);
    // Re-check: with two writers the last put wins, so make sure it was ours.
    ({ claims } = await loadClaims(env));
    if (!claims[spot] || claims[spot].sid !== sid) throw new HttpError(409, `spot #${spot} is taken`, { spot, taken: nums(claims) });
    await addChat(env, { sys: true, text: `Spot #${spot} claimed${name ? ' by ' + shortName(name) : ''}` }).catch(() => {});
    return { ok: true, spot, exp: claim.exp, name, ...spotView(claims, sid, total, price) };
  });

  r.post('/live/spots/release', async ({ env, req, auth }) => {
    const body = await readJson(req, 4096);
    const { total, price } = await liveConfig(env);
    const spot = spotNum(body.spot, 200);
    const staff = !!auth;
    const sid = sidOf(body.sid, { required: !staff });
    const { claims } = await loadClaims(env);
    const held = claims[spot];
    if (!held) return { ok: true, released: false, spot, ...spotView(claims, sid, total, price) };
    if (!staff) {
      if (held.sid !== sid) throw new HttpError(403, 'that spot is held by someone else', { spot, taken: nums(claims) });
      if (held.confirmed) throw new HttpError(403, 'that spot is confirmed — ask staff to release it', { spot, taken: nums(claims) });
    }
    delete claims[spot];
    await saveClaims(env, claims);
    await addChat(env, { sys: true, text: `Spot #${spot} opened up` }).catch(() => {});
    return { ok: true, released: true, spot, ...spotView(claims, sid, total, price) };
  });

  r.post('/live/spots/:n/confirm', requireRole('staff'), async ({ env, req, params, auth }) => {
    const body = await readJson(req, 4096);
    const { total, price } = await liveConfig(env);
    const spot = spotNum(params.n, total);
    const name = optText(body.name, { max: 24, name: 'name' });
    const { claims } = await loadClaims(env);
    const now = new Date().toISOString();
    const prev = claims[spot] || { spot, sid: null, name: '', at: now };
    claims[spot] = { ...prev, spot, name: name || prev.name || '', confirmed: true, exp: null, expires: null, confirmedAt: now, confirmedBy: auth.role };
    await saveClaims(env, claims);
    return { ok: true, spot, claim: claims[spot], ...spotView(claims, '', total, price) };
  });

  r.post('/live/spots/reset', requireRole('staff'), async ({ env }) => {
    await saveClaims(env, {});
    const { total, price } = await liveConfig(env);
    await addChat(env, { sys: true, text: 'Spots reset — the board is open' }).catch(() => {});
    return { ok: true, ...spotView({}, '', total, price) };
  });

  r.get('/live/chat', async ({ env, url }) => {
    const since = parseSince(url.searchParams.get('since'));
    const list = await readChat(env);
    const messages = (since ? list.filter(m => Number(m.ts) > since) : list).slice(-CHAT_MAX);
    return { messages, now: Date.now(), viewers: await viewerCount(env) };
  });

  r.post('/live/chat', async ({ env, req, ip, auth }) => {
    await rateLimit(env, `chat:${ip}`, { limit: 20, windowSec: 60 });
    const body = await readJson(req, 4096);
    const raw = cleanText(body.text, { max: 200, min: 1, name: 'text' });
    const text = filterChat(raw);
    if (!text) throw new HttpError(400, 'say something');
    const sys = body.sys === true && !!auth;
    const message = await addChat(env, { user: userName(body.user), text, sys });
    return { ok: true, message };
  });

  r.post('/live/viewers', async ({ env, req }) => {
    const body = await readJson(req, 2048);
    const sid = sidOf(body.sid);
    const now = Date.now();
    const map = await readViewers(env, now);
    map[sid] = now;
    const keys = Object.keys(map);
    if (keys.length > VIEWERS_MAX) {
      keys.sort((a, b) => map[a] - map[b]).slice(0, keys.length - VIEWERS_MAX).forEach(k => { delete map[k]; });
    }
    await putJSON(env.KV, VIEWERS, map);
    return { viewers: Object.keys(map).length };
  });
}
