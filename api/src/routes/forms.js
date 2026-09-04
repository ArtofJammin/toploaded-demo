// Form submissions from the public site + the staff inbox.
//   POST /forms/:kind            public → {ok, id, emailed}   (5 / 10 min per IP per kind, honeypot "website")
//   GET  /forms?kind=&status=&limit=   staff → {forms:[newest first], count, open}
//   PUT  /forms/:kind/:id        staff → {status:"new"|"done"|"archived", note?} → {ok, form}
// Kinds and their fields:
//   vendor     name, email, tables (1-3), game, phone?, message?
//   buylist    name, contact, games (string or string[]), desc
//   signup     name, seats (1-4), eventId, contact?, date? (YYYY-MM-DD)
//   newsletter email
//   restock    email, productId, productName
//   contact    name, email, message
// Every string is HTML-stripped and capped. Records live at "form:<kind>:<id>" and a
// small per-kind index "forms:index:<kind>" ([{id, at, status}], newest first) keeps
// the inbox to one read per kind instead of a KV list() walk.
import { getJSON, putJSON } from '../lib/kv.js';
import { HttpError, readJson, v } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { sendEmail } from '../lib/email.js';
import { loadConfig } from './config.js';

export const KINDS = ['vendor', 'buylist', 'signup', 'newsletter', 'restock', 'contact'];
export const STATUSES = ['new', 'done', 'archived'];
const INDEX_MAX = 500;      // per kind; older records stay in KV but drop off the inbox
const MAX_BODY = 16 * 1024;

const idxKey = (kind) => `forms:index:${kind}`;
const recKey = (kind, id) => `form:${kind}:${id}`;

function uid() {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return Date.now().toString(36) + r;
}

// Strip tags + control characters, collapse runs of blank lines. Keeps newlines so
// a buylist description still reads as the customer typed it.
export function clean(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function text(x, { max = 500, min = 0, name = 'field' } = {}) {
  if (x === undefined || x === null) x = '';
  if (typeof x === 'number' || typeof x === 'boolean') x = String(x);
  return clean(v.str(x, { max, min, name }));
}
function optText(x, opts) { return (x === undefined || x === null || x === '') ? '' : text(x, opts); }
function int(x, { min, max, name }) {
  const n = v.num(x, { min, max, name });
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number`);
  return n;
}
function phone(x) {
  const s = optText(x, { max: 40, name: 'phone' });
  if (s && s.replace(/\D/g, '').length < 7) throw new HttpError(400, 'phone looks wrong');
  return s;
}
function slug(x, { name, max = 40 }) {
  const s = text(x, { max, min: 1, name });
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s)) throw new HttpError(400, `${name} looks wrong`);
  return s;
}

// Returns the validated, cleaned field set for a kind (unknown fields are dropped).
export function validateFields(kind, b) {
  b = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  switch (kind) {
    case 'vendor':
      return {
        name: text(b.name, { max: 80, min: 2, name: 'name' }),
        email: v.email(b.email),
        phone: phone(b.phone),
        tables: int(b.tables, { min: 1, max: 3, name: 'tables' }),
        game: text(b.game, { max: 40, min: 1, name: 'game' }),
        message: optText(b.message, { max: 1000, name: 'message' }),
        show: optText(b.show, { max: 10, name: 'show' }),
        waitlist: b.waitlist === true || b.waitlist === 'true' ? true : undefined,
      };
    case 'buylist': {
      const games = Array.isArray(b.games) ? b.games.slice(0, 10).map(g => text(g, { max: 40, name: 'games' })).filter(Boolean).join(', ') : text(b.games, { max: 200, name: 'games' });
      if (!games) throw new HttpError(400, 'games is required');
      return {
        name: text(b.name, { max: 80, min: 2, name: 'name' }),
        contact: text(b.contact, { max: 200, min: 3, name: 'contact' }),
        games,
        desc: text(b.desc, { max: 2000, min: 3, name: 'desc' }),
        photosUrl: optText(b.photosUrl, { max: 500, name: 'photosUrl' }),
      };
    }
    case 'signup': {
      const out = {
        name: text(b.name, { max: 80, min: 2, name: 'name' }),
        seats: int(b.seats, { min: 1, max: 4, name: 'seats' }),
        eventId: slug(b.eventId, { name: 'eventId' }),
        contact: optText(b.contact, { max: 200, name: 'contact' }),
      };
      const date = optText(b.date, { max: 10, name: 'date' });
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw new HttpError(400, 'date must be YYYY-MM-DD');
        out.date = date;
      }
      return out;
    }
    case 'newsletter':
      return { email: v.email(b.email), topic: optText(b.topic, { max: 40, name: 'topic' }) };
    case 'restock':
      return {
        email: v.email(b.email),
        productId: slug(b.productId, { name: 'productId', max: 60 }),
        productName: text(b.productName, { max: 200, min: 1, name: 'productName' }),
      };
    case 'contact':
      return {
        name: text(b.name, { max: 80, min: 2, name: 'name' }),
        email: v.email(b.email),
        message: text(b.message, { max: 2000, min: 3, name: 'message' }),
      };
    default:
      throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
  }
}

const LABEL = { vendor: 'Vendor table request', buylist: 'Buylist quote request', signup: 'Event signup', newsletter: 'Newsletter signup', restock: 'Restock request', contact: 'Website message' };

export function emailFor(kind, f, extra = {}) {
  const lines = [];
  let subject;
  switch (kind) {
    case 'vendor':
      subject = `[Top Loaded] Vendor table request from ${f.name}`;
      lines.push(`Name: ${f.name}`, `Email: ${f.email}`, f.phone && `Phone: ${f.phone}`, `Tables: ${f.tables}`, `Game: ${f.game}`, f.message && `\n${f.message}`);
      break;
    case 'buylist':
      subject = `[Top Loaded] Buylist quote from ${f.name}`;
      lines.push(`Name: ${f.name}`, `Contact: ${f.contact}`, `Games: ${f.games}`, `\n${f.desc}`);
      break;
    case 'signup':
      subject = `[Top Loaded] ${extra.eventName || 'Event'} signup from ${f.name} (${f.seats} seat${f.seats === 1 ? '' : 's'})`;
      lines.push(`Name: ${f.name}`, `Seats: ${f.seats}`, `Event: ${extra.eventName || f.eventId}`, f.date && `Date: ${f.date}`, f.contact && `Contact: ${f.contact}`);
      break;
    case 'newsletter':
      subject = `[Top Loaded] Newsletter signup: ${f.email}`;
      lines.push(`Email: ${f.email}`);
      break;
    case 'restock':
      subject = `[Top Loaded] Restock request: ${f.productName}`;
      lines.push(`Product: ${f.productName} (#${f.productId})`, `Notify: ${f.email}`);
      break;
    case 'contact':
      subject = `[Top Loaded] Message from ${f.name}`;
      lines.push(`Name: ${f.name}`, `Email: ${f.email}`, `\n${f.message}`);
      break;
    default:
      subject = `[Top Loaded] ${LABEL[kind] || kind}`;
  }
  const body = lines.filter(Boolean).join('\n') + `\n\n— sent from the website form (${LABEL[kind] || kind})`;
  return { subject, text: body, replyTo: f.email || undefined };
}

async function readIndex(env, kind) {
  const list = await getJSON(env.KV, idxKey(kind), []);
  return Array.isArray(list) ? list : [];
}

export function register(r) {
  r.post('/forms/:kind', async ({ env, req, ip, params }) => {
    const kind = v.oneOf(params.kind, KINDS, { name: 'kind' });
    await rateLimit(env, `form:${kind}:${ip}`, { limit: 5, windowSec: 600 });
    const body = await readJson(req, MAX_BODY);
    // Honeypot: bots fill every field. Pretend it worked, keep nothing.
    if (body && typeof body.website === 'string' && body.website.trim()) return { ok: true, id: uid(), emailed: false };
    const fields = validateFields(kind, body);
    const id = uid();
    const at = new Date().toISOString();
    const extra = {};
    if (kind === 'signup') {
      const cfg = await loadConfig(env).catch(() => null);
      const ev = cfg && Array.isArray(cfg.events) ? cfg.events.find(e => e && e.id === fields.eventId) : null;
      if (ev && ev.name) extra.eventName = fields.eventName = String(ev.name);
    }
    const record = { id, kind, at, ip, ...fields, status: 'new' };
    let emailed = false;
    if (env.NOTIFY_EMAIL) {
      try {
        const res = await sendEmail(env, emailFor(kind, fields, extra));
        emailed = !!(res && res.sent);
      } catch (e) { console.log('[forms] email failed', e && e.message || e); }
    }
    record.emailed = emailed;
    await putJSON(env.KV, recKey(kind, id), record);
    const idx = await readIndex(env, kind);
    idx.unshift({ id, at, status: 'new' });
    if (idx.length > INDEX_MAX) idx.length = INDEX_MAX;
    await putJSON(env.KV, idxKey(kind), idx);
    return { ok: true, id, emailed };
  });

  r.get('/forms', requireRole('staff'), async ({ env, url }) => {
    const q = url.searchParams;
    const kind = q.get('kind') ? v.oneOf(q.get('kind'), KINDS, { name: 'kind' }) : null;
    const status = q.get('status') ? v.oneOf(q.get('status'), STATUSES, { name: 'status' }) : null;
    const limit = q.get('limit') ? int(q.get('limit'), { min: 1, max: 200, name: 'limit' }) : 50;
    const kinds = kind ? [kind] : KINDS;
    let entries = [];
    let open = 0;
    for (const k of kinds) {
      for (const e of await readIndex(env, k)) {
        if (e.status === 'new') open++;
        if (!status || e.status === status) entries.push({ ...e, kind: k });
      }
    }
    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    entries = entries.slice(0, limit);
    const forms = [];
    for (const e of entries) {
      const rec = await getJSON(env.KV, recKey(e.kind, e.id), null);
      if (rec) forms.push(rec);
    }
    return { forms, count: forms.length, open };
  });

  r.put('/forms/:kind/:id', requireRole('staff'), async ({ env, req, params, auth }) => {
    const kind = v.oneOf(params.kind, KINDS, { name: 'kind' });
    const id = slug(params.id, { name: 'id', max: 40 });
    const body = await readJson(req, 4096);
    const status = v.oneOf(body.status, STATUSES, { name: 'status' });
    const note = optText(body.note, { max: 500, name: 'note' });
    const rec = await getJSON(env.KV, recKey(kind, id), null);
    if (!rec) throw new HttpError(404, 'submission not found');
    rec.status = status;
    if (body.note !== undefined) rec.note = note;
    rec.updatedAt = new Date().toISOString();
    rec.by = auth.role;
    await putJSON(env.KV, recKey(kind, id), rec);
    const idx = await readIndex(env, kind);
    const hit = idx.find(e => e.id === id);
    if (hit) hit.status = status; else idx.unshift({ id, at: rec.at, status });
    await putJSON(env.KV, idxKey(kind), idx);
    return { ok: true, form: rec };
  });
}
