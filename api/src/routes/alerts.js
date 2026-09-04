// Cross-channel sync alerts ("sold in-store → pull the TCGplayer listing" and back).
//   GET  /alerts?status=open|acked&limit=   staff → {alerts:[open first, newest first, then acked], open:n}
//   POST /alerts                            staff → {msg, ch, source?} manual alert (stock edited on the site)
//   POST /alerts/:id/ack                    staff → mark done (idempotent)
// One KV key "alerts" holds the bounded list (newest first, max 200). Other routes
// (the Square webhook, the inventory diff) import appendAlert(env, {msg, ch, source}).
import { getJSON, putJSON } from '../lib/kv.js';
import { HttpError, readJson, v } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';

export const CHANNELS = ['TCGplayer', 'Square'];
export const MAX_ALERTS = 200;
const KEY = 'alerts';

function uid() {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return Date.now().toString(36) + r;
}
function cleanText(s, opts) {
  return v.str(String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' '), opts);
}

export async function readAlerts(env) {
  const list = await getJSON(env.KV, KEY, []);
  return Array.isArray(list) ? list.filter(a => a && typeof a === 'object' && a.id) : [];
}

// Open alerts first (newest first), then acknowledged ones (newest first).
export function sortAlerts(list) {
  const byTime = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));
  return list.filter(a => !a.ack).sort(byTime).concat(list.filter(a => a.ack).sort(byTime));
}

// Keeps the list bounded: drop acknowledged alerts before open ones.
function trim(list) {
  if (list.length <= MAX_ALERTS) return list;
  const sorted = sortAlerts(list);
  return sorted.slice(0, MAX_ALERTS);
}

// Append an alert (dedupes an identical open message on the same channel: bumps
// its count and timestamp instead of adding a twin). Returns the alert.
export async function appendAlert(env, { msg, ch, source = 'system', sku, qty } = {}) {
  const text = cleanText(msg, { max: 240, min: 2, name: 'msg' });
  const channel = v.oneOf(ch, CHANNELS, { name: 'ch' });
  const list = await readAlerts(env);
  const now = new Date().toISOString();
  const twin = list.find(a => !a.ack && a.ch === channel && a.msg === text);
  if (twin) {
    twin.count = (twin.count || 1) + 1;
    twin.at = now;
    await putJSON(env.KV, KEY, list);
    return twin;
  }
  const alert = { id: uid(), at: now, ch: channel, msg: text, source: cleanText(source || 'system', { max: 80, name: 'source' }) || 'system', ack: false };
  if (sku !== undefined && sku !== null && sku !== '') alert.sku = cleanText(sku, { max: 60, name: 'sku' });
  if (qty !== undefined && qty !== null && qty !== '') alert.qty = v.num(qty, { min: 0, max: 1e6, name: 'qty' });
  list.unshift(alert);
  await putJSON(env.KV, KEY, trim(list));
  return alert;
}

export async function ackAlert(env, id, by = 'staff') {
  const list = await readAlerts(env);
  const alert = list.find(a => a.id === id);
  if (!alert) throw new HttpError(404, 'alert not found');
  if (!alert.ack) {
    alert.ack = true;
    alert.ackedAt = new Date().toISOString();
    alert.ackedBy = by;
    await putJSON(env.KV, KEY, list);
  }
  return { alert, open: list.filter(a => !a.ack).length };
}

export function register(r) {
  r.get('/alerts', requireRole('staff'), async ({ env, url }) => {
    const q = url.searchParams;
    const status = q.get('status') ? v.oneOf(q.get('status'), ['open', 'acked'], { name: 'status' }) : null;
    const limit = q.get('limit') ? Math.floor(v.num(q.get('limit'), { min: 1, max: MAX_ALERTS, name: 'limit' })) : MAX_ALERTS;
    const list = await readAlerts(env);
    const open = list.filter(a => !a.ack).length;
    let alerts = sortAlerts(list);
    if (status === 'open') alerts = alerts.filter(a => !a.ack);
    else if (status === 'acked') alerts = alerts.filter(a => a.ack);
    return { alerts: alerts.slice(0, limit), open };
  });

  r.post('/alerts', requireRole('staff'), async ({ env, req, auth }) => {
    const body = await readJson(req, 8 * 1024);
    const alert = await appendAlert(env, { msg: body.msg, ch: body.ch, source: body.source || auth.role, sku: body.sku, qty: body.qty });
    const list = await readAlerts(env);
    return { ok: true, alert, open: list.filter(a => !a.ack).length };
  });

  r.post('/alerts/:id/ack', requireRole('staff'), async ({ env, params, auth }) => {
    const id = v.str(params.id, { max: 40, min: 1, name: 'id' });
    const { alert, open } = await ackAlert(env, id, auth.role);
    return { ok: true, alert, open };
  });
}
