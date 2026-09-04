// Store-credit ledger for the staff desk.
//   GET  /credit?q=            staff  → {customers:[{id,name,phone,balance,updatedAt}]} (≤ 50; name or phone digits)
//   POST /credit               staff  → {name, phone, email?} → {ok, customer}   (409 when the phone exists)
//   GET  /credit/lookup?phone= public → {found, balance, name:"A••• R."} exact phone only; 10 / 10 min per IP
//   GET  /credit/:id           staff  → {customer, entries:[last 50, newest first]}
//   POST /credit/:id/add       staff  → {cash, note?}             trade: credits cash × (1 + config.buy.creditBonus)
//                                       {redeem:true, amount}     subtracts; 409 if it would go below 0
//                                       {adjust:true, amount, note} admin only, ± correction with a required note
//                                     → {customer, entry, bonus}
// KV: "credit:<id>" customer, "credit:index" [{id,name,phone,balance,updatedAt}] for search,
// "credit:log:<id>" ledger entries {id, at, kind, cash, credited, note, balanceAfter, by} newest first.
// Money is dollars rounded to cents; the balance is always recomputed server-side.
import { getJSON, putJSON, pushList } from '../lib/kv.js';
import { HttpError, readJson, v } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { loadConfig } from './config.js';

const INDEX = 'credit:index';
const LOG_MAX = 500;
const custKey = (id) => `credit:${id}`;
const logKey = (id) => `credit:log:${id}`;

function uid() {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return Date.now().toString(36) + r;
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function cleanText(s, opts) {
  return v.str(String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' '), opts);
}
function optText(x, opts) { return (x === undefined || x === null || x === '') ? '' : cleanText(x, opts); }

// Digits only; a US number with a leading country code loses the 1.
export function normalizePhone(x) {
  let d = String(x == null ? '' : x).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d;
}
function requirePhone(x) {
  const d = normalizePhone(x);
  if (d.length < 7 || d.length > 15) throw new HttpError(400, 'phone looks wrong');
  return d;
}
export function formatPhone(d) {
  if (/^\d{10}$/.test(d)) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (/^\d{7}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}
// "Alex Rivera" → "A••• R."; "Alex" → "A•••". Enough for a customer to recognise
// themselves on the public lookup without exposing the name.
export function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0][0].toUpperCase() + '•••';
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}
function idParam(x) {
  const s = v.str(x, { max: 40, min: 1, name: 'id' });
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new HttpError(400, 'id looks wrong');
  return s;
}

async function readIndex(env) {
  const list = await getJSON(env.KV, INDEX, []);
  return Array.isArray(list) ? list : [];
}
function summary(c) { return { id: c.id, name: c.name, phone: c.phone, balance: c.balance, updatedAt: c.updatedAt }; }
async function saveCustomer(env, c) {
  await putJSON(env.KV, custKey(c.id), c);
  const idx = await readIndex(env);
  const i = idx.findIndex(e => e.id === c.id);
  if (i > -1) idx[i] = summary(c); else idx.unshift(summary(c));
  await putJSON(env.KV, INDEX, idx);
  return c;
}
async function loadCustomer(env, id) {
  const c = await getJSON(env.KV, custKey(id), null);
  if (!c) throw new HttpError(404, 'customer not found');
  return c;
}
export async function creditBonus(env) {
  const cfg = await loadConfig(env).catch(() => null);
  const b = Number(cfg && cfg.buy && cfg.buy.creditBonus);
  return Number.isFinite(b) ? Math.min(1, Math.max(0, b)) : 0.1;
}

export function register(r) {
  r.get('/credit/lookup', async ({ env, url, ip }) => {
    await rateLimit(env, `credit-lookup:${ip}`, { limit: 10, windowSec: 600 });
    const phone = requirePhone(url.searchParams.get('phone'));
    const hit = (await readIndex(env)).find(e => e.phone === phone);
    if (!hit) return { found: false };
    const c = await getJSON(env.KV, custKey(hit.id), null);
    if (!c) return { found: false };
    return { found: true, balance: round2(c.balance), name: maskName(c.name) };
  });

  r.get('/credit', requireRole('staff'), async ({ env, url }) => {
    const q = optText(url.searchParams.get('q') || '', { max: 80, name: 'q' }).toLowerCase();
    const digits = q.replace(/\D/g, '');
    const idx = await readIndex(env);
    let rows = idx;
    if (q) {
      rows = idx.filter(e => {
        const byName = String(e.name || '').toLowerCase().includes(q);
        const byPhone = digits.length >= 3 && String(e.phone || '').includes(digits);
        return byName || byPhone;
      });
    }
    rows = rows.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 50);
    return { customers: rows.map(e => ({ ...e, phoneDisplay: formatPhone(e.phone) })) };
  });

  r.post('/credit', requireRole('staff'), async ({ env, req, auth }) => {
    const body = await readJson(req, 4096);
    const name = cleanText(body.name, { max: 80, min: 2, name: 'name' });
    const phone = requirePhone(body.phone);
    const email = body.email ? v.email(body.email) : '';
    const idx = await readIndex(env);
    const dupe = idx.find(e => e.phone === phone);
    if (dupe) throw new HttpError(409, 'a customer with that phone already exists', { id: dupe.id, name: dupe.name });
    const now = new Date().toISOString();
    const customer = { id: uid(), name, phone, phoneDisplay: formatPhone(phone), email, balance: 0, createdAt: now, updatedAt: now, createdBy: auth.role };
    await saveCustomer(env, customer);
    return { ok: true, customer };
  });

  r.get('/credit/:id', requireRole('staff'), async ({ env, params }) => {
    const customer = await loadCustomer(env, idParam(params.id));
    const log = await getJSON(env.KV, logKey(customer.id), []);
    return { customer, entries: (Array.isArray(log) ? log : []).slice(0, 50) };
  });

  r.post('/credit/:id/add', requireRole('staff'), async ({ env, req, params, auth }) => {
    const customer = await loadCustomer(env, idParam(params.id));
    const body = await readJson(req, 4096);
    const note = optText(body.note, { max: 200, name: 'note' });
    const bonus = await creditBonus(env);
    const before = round2(customer.balance || 0);
    let entry;
    if (body.redeem === true) {
      const amount = round2(v.num(body.amount, { min: 0.01, max: 10000, name: 'amount' }));
      if (before - amount < -0.001) throw new HttpError(409, 'not enough credit', { balance: before, amount });
      entry = { kind: 'redeem', cash: 0, credited: -amount };
    } else if (body.adjust === true) {
      if (auth.role !== 'admin') throw new HttpError(403, 'admin only');
      const amount = round2(v.num(body.amount, { min: -10000, max: 10000, name: 'amount' }));
      if (amount === 0) throw new HttpError(400, 'amount out of range');
      if (!note) throw new HttpError(400, 'note is required for an adjustment');
      if (before + amount < -0.001) throw new HttpError(409, 'balance cannot go below zero', { balance: before, amount });
      entry = { kind: 'adjust', cash: 0, credited: amount };
    } else {
      const cash = round2(v.num(body.cash, { min: 0.01, max: 10000, name: 'cash' }));
      entry = { kind: 'trade', cash, credited: round2(cash * (1 + bonus)) };
    }
    const now = new Date().toISOString();
    const balanceAfter = round2(before + entry.credited);
    entry = { id: uid(), at: now, ...entry, note, balanceAfter, by: auth.role };
    customer.balance = balanceAfter;
    customer.updatedAt = now;
    await pushList(env.KV, logKey(customer.id), entry, LOG_MAX);
    await saveCustomer(env, customer);
    return { customer, entry, bonus };
  });
}
