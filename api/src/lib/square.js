// Square helpers: Payment Links (checkout) and webhook signature verification.
// Nothing here touches KV; routes/checkout.js and routes/square.js do the storing.
//   SQUARE_ENV                     "sandbox" | "production" (picks the API host)
//   SQUARE_ACCESS_TOKEN            bearer token from the Square Developer Dashboard
//   SQUARE_LOCATION_ID             the shop's location
//   SQUARE_WEBHOOK_SIGNATURE_KEY   from the webhook subscription in the dashboard
//   SQUARE_WEBHOOK_URL             the exact notification URL registered with Square
import { HttpError } from './http.js';

export const SQUARE_VERSION = '2025-07-16';
const enc = new TextEncoder();

export function squareBase(env) {
  return env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

// True when a real Payment Link can be created.
export function squareConfigured(env) {
  return !!(env.SQUARE_ENV && env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

export function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

function squareHeaders(env) {
  return {
    'authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    'square-version': SQUARE_VERSION,
    'content-type': 'application/json',
    'accept': 'application/json',
  };
}

// Turns a Square error body into a readable message ("INVALID_REQUEST_ERROR: detail").
export function squareErrorMessage(status, body) {
  const errs = body && Array.isArray(body.errors) ? body.errors : [];
  if (errs.length) {
    const e = errs[0];
    return [e.code || e.category, e.detail].filter(Boolean).join(': ') || `Square ${status}`;
  }
  return `Square ${status}`;
}

// Low-level call with a timeout; resolves {status, ok, body}. Never throws on HTTP
// errors — callers map them. Throws HttpError(502) when Square is unreachable.
export async function squareRequest(env, method, path, body, { timeoutMs = 8000 } = {}) {
  const init = { method, headers: squareHeaders(env) };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetch(squareBase(env) + path, init);
  } catch (e) {
    throw new HttpError(502, 'Square is unreachable right now — try again in a minute');
  }
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, body: data };
}

// Creates a Payment Link for an ad-hoc order.
//   lines        [{name, qty, cents, note?}]  (already validated; cents is the unit price)
//   fulfillment  "pickup" | "ship"
//   shippingCents  optional flat shipping added as its own line item
//   email, note, redirectUrl, ref (our order id), idempotencyKey
// Returns {id, url, longUrl, orderId, createdAt}.
export async function createPaymentLink(env, { lines, fulfillment, email, note, redirectUrl, ref, idempotencyKey, shippingCents = 0 }) {
  if (!squareConfigured(env)) throw new HttpError(503, 'Square is not configured');
  const lineItems = lines.map((l) => ({
    name: String(l.name).slice(0, 120),
    quantity: String(l.qty),
    base_price_money: { amount: l.cents, currency: 'USD' },
    ...(l.note ? { note: String(l.note).slice(0, 200) } : {}),
  }));
  if (fulfillment === 'ship' && shippingCents > 0) {
    lineItems.push({ name: 'Shipping', quantity: '1', base_price_money: { amount: shippingCents, currency: 'USD' } });
  }
  const order = {
    location_id: env.SQUARE_LOCATION_ID,
    reference_id: ref,
    line_items: lineItems,
  };
  if (fulfillment === 'pickup') {
    order.fulfillments = [{
      type: 'PICKUP',
      state: 'PROPOSED',
      pickup_details: { note: 'Pick up at Top Loaded Trading Cards', ...(email ? { recipient: { email_address: email } } : {}) },
    }];
  }
  const payload = {
    idempotency_key: idempotencyKey || crypto.randomUUID(),
    order,
    checkout_options: {
      redirect_url: redirectUrl,
      ask_for_shipping_address: fulfillment === 'ship',
      accepted_payment_methods: { apple_pay: true, google_pay: true, cash_app_pay: true },
    },
  };
  if (note) payload.description = String(note).slice(0, 500);
  if (email) payload.pre_populated_data = { buyer_email: email };

  const r = await squareRequest(env, 'POST', '/v2/online-checkout/payment-links', payload);
  if (!r.ok) {
    const msg = squareErrorMessage(r.status, r.body);
    // Square 4xx means our request (or their config) is wrong; surface it as a bad gateway
    // so the UI can show a clear message without pretending the customer did something wrong.
    throw new HttpError(r.status >= 500 ? 502 : 502, `Square rejected the checkout (${msg})`, { square: r.status });
  }
  const pl = (r.body && r.body.payment_link) || {};
  if (!pl.url) throw new HttpError(502, 'Square returned no payment link');
  return { id: pl.id || null, url: pl.url, longUrl: pl.long_url || pl.url, orderId: pl.order_id || null, createdAt: pl.created_at || null };
}

// GET /v2/orders/{id} → order object or null (never throws; used by the webhook to
// enrich POS alerts with line items when a token is configured).
export async function retrieveOrder(env, orderId) {
  if (!squareConfigured(env) || !orderId) return null;
  try {
    const r = await squareRequest(env, 'GET', `/v2/orders/${encodeURIComponent(orderId)}`, undefined, { timeoutMs: 5000 });
    return r.ok && r.body && r.body.order ? r.body.order : null;
  } catch { return null; }
}

// ---- webhook signatures ----
// Square signs base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)).
export async function signWebhook(key, url, body) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(url + body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = enc.encode(a), bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let r = 0;
  for (let i = 0; i < bufA.length; i++) r |= bufA[i] ^ bufB[i];
  return r === 0;
}

// Returns true only when the header matches. Missing key/header/signature → false.
export async function verifyWebhookSignature(env, url, body, signatureHeader) {
  const key = env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !url || typeof body !== 'string' || !signatureHeader) return false;
  const expected = await signWebhook(key, url, body);
  return timingSafeEqual(expected, String(signatureHeader).trim());
}
