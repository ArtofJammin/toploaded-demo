// Checkout → Square Payment Link.
//   POST /checkout {lines:[{id, name, price, qty, game?}], fulfillment:"pickup"|"ship", email?, note?}
//     → {url, orderId, total, totalCents, mock:false}            (Square configured)
//     → {url:null, orderId, total, totalCents, mock:true}        (no Square: demo confirmation)
//   GET  /checkout/orders?limit=   staff → {orders:[...newest first]} (every attempt, 7 days)
//   GET  /checkout/orders/:id      public → the order record (status only; no PII beyond what the buyer typed)
// The total is always computed here. tcg-<productId> lines are re-priced from
// inventory.json when it is reachable (price never below the shop's listing, qty
// never above stock → 409 with what is available).
import { HttpError, readJson, v } from '../lib/http.js';
import { getJSON, putJSON, listJSON } from '../lib/kv.js';
import { rateLimit } from '../lib/ratelimit.js';
import { requireRole, sha256hex } from '../lib/auth.js';
import { squareConfigured, createPaymentLink, toCents } from '../lib/square.js';
import { loadInventory, itemOffer } from './price.js';

const ORDER_TTL = 7 * 24 * 3600;
const MAX_LINES = 40;

function orderId() {
  const t = Date.now().toString(36);
  const rnd = crypto.randomUUID().replace(/-/g, '').slice(0, 6);
  return `TL-${t}-${rnd}`.toUpperCase();
}

function shippingCents(env, subtotalCents) {
  const flat = Number(env.SHIPPING_CENTS != null ? env.SHIPPING_CENTS : 499);
  const freeOver = Number(env.FREE_SHIPPING_CENTS != null ? env.FREE_SHIPPING_CENTS : 10000);
  if (!Number.isFinite(flat) || flat <= 0) return 0;
  return subtotalCents >= freeOver ? 0 : Math.round(flat);
}

function validateLines(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'cart is empty');
  if (raw.length > MAX_LINES) throw new HttpError(400, `too many lines (max ${MAX_LINES})`);
  return raw.map((l, i) => {
    if (!l || typeof l !== 'object') throw new HttpError(400, `line ${i + 1} is invalid`);
    const name = v.str(l.name, { min: 1, max: 120, name: `line ${i + 1} name` });
    const price = v.num(l.price, { min: 0.01, max: 10000, name: `line ${i + 1} price` });
    const qty = v.num(l.qty == null ? 1 : l.qty, { min: 1, max: 20, name: `line ${i + 1} qty` });
    if (!Number.isInteger(qty)) throw new HttpError(400, `line ${i + 1} qty must be a whole number`);
    const id = l.id == null ? null : v.str(String(l.id), { max: 80, name: `line ${i + 1} id` });
    const game = typeof l.game === 'string' ? l.game.slice(0, 12) : null;
    return { id, name, price: Math.round(price * 100) / 100, cents: toCents(price), qty, game };
  });
}

// Re-price / stock-check tcg- lines against inventory.json. Returns {lines, conflicts, priced}.
async function reconcile(env, lines) {
  const needs = lines.filter(l => l.id && /^tcg-\d+$/.test(l.id));
  if (!needs.length) return { lines, conflicts: [], priced: 'client' };
  const inv = await loadInventory(env);
  if (!inv) return { lines, conflicts: [], priced: 'client' };
  const conflicts = [];
  const out = lines.map((l) => {
    if (!l.id || !/^tcg-\d+$/.test(l.id)) return l;
    const raw = inv.byId.get(l.id.slice(4));
    if (!raw) { conflicts.push({ id: l.id, available: 0, reason: 'no longer listed' }); return l; }
    const offer = itemOffer(raw);
    if (offer.stock < l.qty) conflicts.push({ id: l.id, available: offer.stock, reason: 'not enough in stock' });
    const cents = offer.price != null ? Math.max(l.cents, toCents(offer.price)) : l.cents;
    return { ...l, cents, price: cents / 100, note: `tcg:${raw.id}${offer.cond ? ' ' + offer.cond : ''}` };
  });
  return { lines: out, conflicts, priced: 'inventory' };
}

export function register(r) {
  r.post('/checkout', async ({ env, req, ip, exec }) => {
    await rateLimit(env, `checkout:${ip}`, { limit: 20, windowSec: 600 });
    const body = await readJson(req, 64 * 1024);
    if (typeof body.website === 'string' && body.website.trim()) throw new HttpError(400, 'spam check failed');

    const fulfillment = v.oneOf(body.fulfillment || 'pickup', ['pickup', 'ship'], { name: 'fulfillment' });
    const email = body.email ? v.email(body.email) : null;
    const note = body.note ? v.str(body.note, { max: 500, name: 'note' }) : null;
    let lines = validateLines(body.lines);

    const rec = await reconcile(env, lines);
    if (rec.conflicts.length) {
      throw new HttpError(409, 'some items are no longer available in that quantity', { items: rec.conflicts });
    }
    lines = rec.lines;

    const subtotalCents = lines.reduce((s, l) => s + l.cents * l.qty, 0);
    const shipCents = fulfillment === 'ship' ? shippingCents(env, subtotalCents) : 0;
    const totalCents = subtotalCents + shipCents;
    const id = orderId();
    const order = {
      id, at: new Date().toISOString(), status: 'pending', mock: !squareConfigured(env),
      fulfillment, email, note, ip,
      lines: lines.map(l => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, game: l.game })),
      subtotalCents, shippingCents: shipCents, totalCents, total: totalCents / 100,
      priced: rec.priced, square: null, error: null,
    };

    if (order.mock) {
      order.status = 'mock';
      await putJSON(env.KV, `order:${id}`, order, { expirationTtl: ORDER_TTL });
      return { url: null, orderId: id, total: order.total, totalCents, subtotalCents, shippingCents: shipCents, mock: true,
        reason: env.SQUARE_ENV ? 'Square is not configured' : 'SQUARE_ENV not set' };
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
      return { url: pl.url, orderId: id, total: order.total, totalCents, subtotalCents, shippingCents: shipCents, mock: false };
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

  r.get('/checkout/orders/:id', async ({ env, params }) => {
    const o = await getJSON(env.KV, `order:${params.id}`, null);
    if (!o) throw new HttpError(404, 'order not found');
    const { ip, email, ...rest } = o;
    return { order: rest };
  });
}
