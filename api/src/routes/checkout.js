// Checkout → Square Payment Link.
//   POST /checkout {lines:[{id, name, price, qty, game?}], fulfillment:"pickup"|"ship", email?, note?}
//     → {url, orderId, total, totalCents, subtotalCents, shippingCents, mock:false, lines}   (Square configured)
//     → {url:null, orderId, …, mock:true, reason, lines:[{id, name, price, qty, trusted}]}   (no Square: demo confirmation)
//   GET  /checkout/orders?limit=   staff → {orders:[...newest first]} (every attempt, 7 days)
//   GET  /checkout/orders/:id      public → {order:{id, status, total, at, fulfillment}} — status only, nothing the buyer typed
// The client's price and name are never billed. A line is billable only when the server
// can price it itself:
//   tcg-<productId>   lowest listing in inventory.json (qty ≤ stock, else 409 with what is available)
//   live-spot-<n>     config.live.spotPrice (n ≤ config.live.spots; qty is always 1)
// Ids are trimmed and lower-cased before matching. With Square configured any other id is
// a 400 and an unreachable inventory.json is a 503 (fail closed). Without Square (mock
// mode) such lines are accepted with the client's figures and flagged trusted:false so
// the demo confirmation still works and staff can see what was not verified.
import { HttpError, readJson, v } from '../lib/http.js';
import { getJSON, putJSON, listJSON } from '../lib/kv.js';
import { rateLimit } from '../lib/ratelimit.js';
import { requireRole, sha256hex } from '../lib/auth.js';
import { squareConfigured, createPaymentLink, toCents } from '../lib/square.js';
import { loadInventory, itemOffer } from './price.js';
import { loadConfig } from './config.js';

const ORDER_TTL = 7 * 24 * 3600;
const MAX_LINES = 40;
const TCG_RE = /^tcg-(\d+)$/;
const SPOT_RE = /^live-spot-(\d+)$/;

function orderId() {
  const t = Date.now().toString(36);
  const rnd = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return `TL-${t}-${rnd}`.toUpperCase();
}

function shippingCents(env, subtotalCents) {
  const flat = Number(env.SHIPPING_CENTS != null ? env.SHIPPING_CENTS : 499);
  const freeOver = Number(env.FREE_SHIPPING_CENTS != null ? env.FREE_SHIPPING_CENTS : 10000);
  if (!Number.isFinite(flat) || flat <= 0) return 0;
  return subtotalCents >= freeOver ? 0 : Math.round(flat);
}

// "  TCG-614504 " → "tcg-614504"; null/empty → null.
function normalizeId(x, name) {
  if (x === null || x === undefined) return null;
  const s = v.str(String(x), { max: 80, name }).toLowerCase();
  return s || null;
}
const serverPriced = (id) => !!id && (TCG_RE.test(id) || SPOT_RE.test(id));

function validateLines(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'cart is empty');
  if (raw.length > MAX_LINES) throw new HttpError(400, `too many lines (max ${MAX_LINES})`);
  return raw.map((l, i) => {
    if (!l || typeof l !== 'object') throw new HttpError(400, `line ${i + 1} is invalid`);
    const id = normalizeId(l.id, `line ${i + 1} id`);
    const name = v.str(l.name, { min: 1, max: 120, name: `line ${i + 1} name` });
    // The client's price is only a shape check (and the demo fallback); server-priced ids may omit it.
    const price = (l.price == null && serverPriced(id)) ? 0 : v.num(l.price, { min: 0.01, max: 10000, name: `line ${i + 1} price` });
    const qty = v.num(l.qty == null ? 1 : l.qty, { min: 1, max: 20, name: `line ${i + 1} qty` });
    if (!Number.isInteger(qty)) throw new HttpError(400, `line ${i + 1} qty must be a whole number`);
    const game = typeof l.game === 'string' ? l.game.slice(0, 12) : null;
    return { id, name, price: Math.round(price * 100) / 100, cents: toCents(price), qty, game };
  });
}

// Live-break spot pricing from the saved config (same rules as routes/live.js).
async function liveOffer(env) {
  const cfg = await loadConfig(env).catch(() => null);
  const live = (cfg && cfg.live && typeof cfg.live === 'object') ? cfg.live : {};
  const total = Number.isInteger(Number(live.spots)) && Number(live.spots) > 0 ? Math.min(200, Number(live.spots)) : 12;
  const price = Number(live.spotPrice);
  return { total, price: Number.isFinite(price) && price > 0 ? price : null, title: typeof live.title === 'string' ? live.title.trim() : '' };
}

// Prices every line server-side. strict (Square configured) rejects anything it cannot
// price; otherwise unknown lines keep the client's figures with trusted:false.
// Returns {lines, conflicts, priced: "inventory" | "mixed" | "client"}.
async function reconcile(env, lines, { strict }) {
  const hasTcg = lines.some(l => l.id && TCG_RE.test(l.id));
  const hasSpot = lines.some(l => l.id && SPOT_RE.test(l.id));
  const inv = hasTcg ? await loadInventory(env) : null;
  if (hasTcg && !inv && strict) throw new HttpError(503, 'pricing is unavailable right now — try again in a minute');
  const live = hasSpot ? await liveOffer(env) : null;
  const conflicts = [];
  const untrusted = (l, i, why) => {
    if (strict) throw new HttpError(400, `line ${i + 1} (${l.name}) ${why} — remove it and try again`);
    return { ...l, trusted: false };
  };
  const out = lines.map((l, i) => {
    let m;
    if (l.id && (m = TCG_RE.exec(l.id))) {
      if (!inv) return untrusted(l, i, 'could not be priced');
      const raw = inv.byId.get(m[1]);
      if (!raw) { conflicts.push({ id: l.id, available: 0, reason: 'no longer listed' }); return l; }
      const offer = itemOffer(raw);
      if (offer.price == null || offer.stock < l.qty) { conflicts.push({ id: l.id, available: offer.stock, reason: 'not enough in stock' }); return l; }
      const cents = toCents(offer.price);
      const name = String(raw.name || l.name).trim().slice(0, 120) || l.name;
      return { ...l, name, cents, price: cents / 100, trusted: true, note: `tcg:${raw.id}${offer.cond ? ' ' + offer.cond : ''}` };
    }
    if (l.id && (m = SPOT_RE.exec(l.id))) {
      const spot = Number(m[1]);
      if (spot < 1 || spot > live.total) { conflicts.push({ id: l.id, available: 0, reason: 'no such spot' }); return l; }
      if (live.price == null) {
        if (strict) { conflicts.push({ id: l.id, available: 0, reason: 'spot price is not set' }); return l; }
        return { ...l, qty: 1, trusted: false };
      }
      const cents = toCents(live.price);
      return { ...l, name: `Break spot #${spot}${live.title ? ' · ' + live.title : ''}`.slice(0, 120), cents, price: cents / 100, qty: 1, trusted: true, note: `live-spot:${spot}` };
    }
    return untrusted(l, i, 'is not something the shop sells online');
  });
  const trusted = out.filter(l => l.trusted).length;
  const priced = trusted === out.length ? 'inventory' : (trusted ? 'mixed' : 'client');
  return { lines: out, conflicts, priced };
}

const publicLines = (lines) => lines.map(l => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, trusted: !!l.trusted }));

export function register(r) {
  r.post('/checkout', async ({ env, req, ip }) => {
    await rateLimit(env, `checkout:${ip}`, { limit: 20, windowSec: 600 });
    const body = await readJson(req, 64 * 1024);
    if (typeof body.website === 'string' && body.website.trim()) throw new HttpError(400, 'spam check failed');

    const fulfillment = v.oneOf(body.fulfillment || 'pickup', ['pickup', 'ship'], { name: 'fulfillment' });
    const email = body.email ? v.email(body.email) : null;
    const note = body.note ? v.str(body.note, { max: 500, name: 'note' }) : null;
    const mock = !squareConfigured(env);
    let lines = validateLines(body.lines);

    const rec = await reconcile(env, lines, { strict: !mock });
    if (rec.conflicts.length) {
      throw new HttpError(409, 'some items are no longer available in that quantity', { items: rec.conflicts });
    }
    lines = rec.lines;

    const subtotalCents = lines.reduce((s, l) => s + l.cents * l.qty, 0);
    const shipCents = fulfillment === 'ship' ? shippingCents(env, subtotalCents) : 0;
    const totalCents = subtotalCents + shipCents;
    const id = orderId();
    const order = {
      id, at: new Date().toISOString(), status: 'pending', mock,
      fulfillment, email, note, ip,
      lines: lines.map(l => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, game: l.game, trusted: !!l.trusted })),
      subtotalCents, shippingCents: shipCents, totalCents, total: totalCents / 100,
      priced: rec.priced, square: null, error: null,
    };
    const summary = { orderId: id, total: order.total, totalCents, subtotalCents, shippingCents: shipCents, lines: publicLines(lines) };

    if (mock) {
      order.status = 'mock';
      await putJSON(env.KV, `order:${id}`, order, { expirationTtl: ORDER_TTL });
      return { url: null, ...summary, mock: true, reason: env.SQUARE_ENV ? 'Square is not configured' : 'SQUARE_ENV not set' };
    }

    const site = String(env.SITE_URL || '').replace(/\/?$/, '/');
    const redirectUrl = `${site}#/shop?order=${encodeURIComponent(id)}`;
    // Same cart within the same minute → same Square link (a double click cannot create two).
    const minute = Math.floor(Date.now() / 60000);
    const idempotencyKey = (await sha256hex(JSON.stringify({ lines: order.lines, fulfillment, email, minute }))).slice(0, 45);
    try {
      const pl = await createPaymentLink(env, { lines, fulfillment, email, note, redirectUrl, ref: id, idempotencyKey, shippingCents: shipCents });
      order.square = { paymentLinkId: pl.id, orderId: pl.orderId, url: pl.url, createdAt: pl.createdAt };
      await putJSON(env.KV, `order:${id}`, order, { expirationTtl: ORDER_TTL });
      if (pl.orderId) await putJSON(env.KV, `order:sq:${pl.orderId}`, { id }, { expirationTtl: ORDER_TTL });
      return { url: pl.url, ...summary, mock: false };
    } catch (e) {
      order.status = 'failed';
      order.error = e && e.message ? e.message : String(e);
      await putJSON(env.KV, `order:${id}`, order, { expirationTtl: ORDER_TTL });
      if (e instanceof HttpError) { e.extra = { ...(e.extra || {}), orderId: id }; throw e; }
      throw new HttpError(502, 'Square checkout failed', { orderId: id });
    }
  });

  r.get('/checkout/orders', requireRole('staff'), async ({ env, url }) => {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const rows = await listJSON(env.KV, 'order:', { limit: 400 });
    const orders = rows.map(x => x.value).filter(o => o && o.id && o.at)
      .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit)
      .map(o => { const { ip, ...rest } = o; return rest; });
    return { orders, count: orders.length };
  });

  // Status only: the id is the only credential, so nothing the buyer typed (note, email),
  // no cart contents and no Square link/receipt come back here.
  r.get('/checkout/orders/:id', async ({ env, params }) => {
    const o = await getJSON(env.KV, `order:${params.id}`, null);
    if (!o) throw new HttpError(404, 'order not found');
    return { order: { id: o.id, status: o.status, total: o.total, at: o.at, fulfillment: o.fulfillment } };
  });
}
