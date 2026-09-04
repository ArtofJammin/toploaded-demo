import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';
import { resetInventoryCache } from '../src/routes/price.js';

const INVENTORY = {
  generated: '2026-09-04T04:23:03-0400',
  items: [
    { id: 712122, name: 'Monkey.D.Luffy (ST31-004) (SP)', set: "The World's Strongest Warriors", line: 'One Piece Card Game', game: 'op', rarity: 'Super Rare', market: 945.36, listings: [{ price: 1046.01, qty: 1, cond: 'Near Mint', printing: 'Foil' }] },
    { id: 614504, name: 'Prismatic Evolutions ETB Sleeves', set: 'Card Sleeves', line: 'Card Sleeves', game: 'other', rarity: null, market: 4.85, listings: [{ price: 7.81, qty: 3, cond: 'Unopened', printing: 'Normal' }, { price: 9.5, qty: 2, cond: 'Unopened', printing: 'Normal' }] },
  ],
};

// Stubs fetch: the site's inventory.json plus a Square handler. Returns the call log.
function stubFetch({ square, inventory = INVENTORY, inventoryStatus = 200 } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
    if (u.endsWith('inventory.json')) {
      return new Response(inventoryStatus === 200 ? JSON.stringify(inventory) : 'nope', { status: inventoryStatus, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('squareup')) {
      if (!square) throw new Error('unexpected Square call');
      return square(u, init, calls[calls.length - 1].body);
    }
    throw new Error('unexpected fetch ' + u);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const squareOk = (url, init, body) => new Response(JSON.stringify({
  payment_link: { id: 'PL1', url: 'https://sandbox.square.link/u/abc', long_url: 'https://sandbox.square.link/u/abc?src=x', order_id: 'SQO-1', created_at: '2026-09-04T12:00:00Z' },
}), { status: 200, headers: { 'content-type': 'application/json' } });

const lines = [
  { id: 'tcg-712122', name: 'Monkey.D.Luffy (ST31-004) (SP)', price: 1046.01, qty: 1, game: 'op' },
  { id: 'demo-3', name: 'Charizard ex 199/165', price: 85, qty: 2, game: 'pk' },
];

test.beforeEach(() => resetInventoryCache());

test('mock mode when Square is not configured: total computed server-side, order stored 7 days', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const r = await c.post('/checkout', { lines, fulfillment: 'pickup', email: 'Buyer@Example.com', note: 'ring when ready' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.mock, true);
    assert.equal(r.data.url, null);
    assert.ok(/^TL-/.test(r.data.orderId));
    assert.equal(r.data.totalCents, 104601 + 17000);
    assert.equal(r.data.total, 1216.01);
    assert.equal(r.data.shippingCents, 0);
    const stored = await env.KV.get('order:' + r.data.orderId, 'json');
    assert.equal(stored.status, 'mock');
    assert.equal(stored.email, 'buyer@example.com');
    assert.equal(stored.priced, 'inventory');
    assert.equal(stored.lines.length, 2);
    assert.ok(env.KV.exp.get('order:' + r.data.orderId) > Date.now() + 6 * 24 * 3600 * 1000, 'expires in ~7 days');
    assert.equal(s.calls.filter(x => x.url.includes('squareup')).length, 0, 'Square never called');
  } finally { s.restore(); }
});

test('mock mode reports SQUARE_ENV missing and works without inventory.json', async () => {
  const c = client(makeEnv({ SQUARE_ENV: '' }));
  const s = stubFetch({ inventoryStatus: 404 });
  try {
    const r = await c.post('/checkout', { lines: [{ name: 'Sleeves', price: 7.81, qty: 1 }], fulfillment: 'ship' });
    assert.equal(r.status, 200);
    assert.equal(r.data.mock, true);
    assert.equal(r.data.reason, 'SQUARE_ENV not set');
    assert.equal(r.data.shippingCents, 499, 'flat shipping under the free threshold');
    assert.equal(r.data.totalCents, 781 + 499);
  } finally { s.restore(); }
});

test('validation: line count, qty, price, name length, fulfillment, honeypot', async () => {
  const c = client(makeEnv());
  const s = stubFetch();
  try {
    const bad = async (body, re) => { const r = await c.post('/checkout', body); assert.equal(r.status, 400, JSON.stringify(r.data)); if (re) assert.match(r.data.error, re); };
    await bad({ lines: [] }, /empty/);
    await bad({ lines: 'x' }, /empty/);
    await bad({ lines: Array.from({ length: 41 }, () => ({ name: 'a', price: 1, qty: 1 })) }, /too many/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 0 }] }, /qty/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 21 }] }, /qty/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 1.5 }] }, /whole number/);
    await bad({ lines: [{ name: 'a', price: 0, qty: 1 }] }, /price/);
    await bad({ lines: [{ name: 'a', price: 10000.01, qty: 1 }] }, /price/);
    await bad({ lines: [{ name: 'x'.repeat(121), price: 1, qty: 1 }] }, /too long/);
    await bad({ lines: [{ name: '', price: 1, qty: 1 }] }, /required/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 1 }], fulfillment: 'drone' }, /fulfillment/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 1 }], email: 'nope' }, /email/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 1 }], website: 'http://spam' }, /spam/);
  } finally { s.restore(); }
});

test('tcg- lines are stock-checked (409 with available) and never priced below the listing', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const r = await c.post('/checkout', { lines: [{ id: 'tcg-712122', name: 'Luffy', price: 1046.01, qty: 2 }] });
    assert.equal(r.status, 409);
    assert.deepEqual(r.data.items, [{ id: 'tcg-712122', available: 1, reason: 'not enough in stock' }]);
    const gone = await c.post('/checkout', { lines: [{ id: 'tcg-1', name: 'Ghost', price: 1, qty: 1 }] });
    assert.equal(gone.status, 409);
    assert.equal(gone.data.items[0].available, 0);
    const cheap = await c.post('/checkout', { lines: [{ id: 'tcg-614504', name: 'Sleeves', price: 0.01, qty: 5 }] });
    assert.equal(cheap.status, 200);
    assert.equal(cheap.data.totalCents, 781 * 5, 'server price wins over a tampered client price');
    assert.equal(s.calls.filter(x => x.url.endsWith('inventory.json')).length, 1, 'inventory.json fetched once per isolate');
  } finally { s.restore(); }
});

test('real mode: builds a Square Payment Link request and stores the link', async () => {
  const env = makeEnv({ SQUARE_ACCESS_TOKEN: 'sq-token', SQUARE_LOCATION_ID: 'LOC1' });
  const c = client(env);
  const s = stubFetch({ square: squareOk });
  try {
    const r = await c.post('/checkout', { lines, fulfillment: 'ship', email: 'buyer@example.com', note: 'gift' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.mock, false);
    assert.equal(r.data.url, 'https://sandbox.square.link/u/abc');
    assert.equal(r.data.shippingCents, 0, 'free shipping over $100');
    const call = s.calls.find(x => x.url.includes('squareup'));
    assert.equal(call.url, 'https://connect.squareupsandbox.com/v2/online-checkout/payment-links');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.authorization, 'Bearer sq-token');
    assert.equal(call.init.headers['square-version'], '2025-07-16');
    const b = call.body;
    assert.ok(b.idempotency_key);
    assert.equal(b.order.location_id, 'LOC1');
    assert.equal(b.order.reference_id, r.data.orderId);
    assert.equal(b.order.line_items.length, 2, 'no shipping line when shipping is free');
    assert.deepEqual(b.order.line_items[0].base_price_money, { amount: 104601, currency: 'USD' });
    assert.equal(b.order.line_items[0].quantity, '1');
    assert.equal(b.order.line_items[0].note, 'tcg:712122 Near Mint');
    assert.equal(b.order.line_items[1].quantity, '2');
    assert.equal(b.order.fulfillments, undefined, 'ship orders let Square collect the address');
    assert.equal(b.checkout_options.ask_for_shipping_address, true);
    assert.equal(b.checkout_options.redirect_url, `https://artofjammin.github.io/toploaded-demo/#/shop?order=${r.data.orderId}`);
    assert.equal(b.pre_populated_data.buyer_email, 'buyer@example.com');
    assert.equal(b.description, 'gift');
    const stored = await env.KV.get('order:' + r.data.orderId, 'json');
    assert.equal(stored.status, 'pending');
    assert.deepEqual(stored.square, { paymentLinkId: 'PL1', orderId: 'SQO-1', url: 'https://sandbox.square.link/u/abc', createdAt: '2026-09-04T12:00:00Z' });
    assert.deepEqual(await env.KV.get('order:sq:SQO-1', 'json'), { id: r.data.orderId });

    // pickup + cheap cart → PICKUP fulfilment and a shipping-free total
    const p = await c.post('/checkout', { lines: [{ name: 'Sleeves', price: 7.81, qty: 1 }], fulfillment: 'pickup', email: 'a@b.co' });
    const pb = s.calls[s.calls.length - 1].body;
    assert.equal(pb.order.fulfillments[0].type, 'PICKUP');
    assert.equal(pb.order.fulfillments[0].pickup_details.recipient.email_address, 'a@b.co');
    assert.equal(pb.checkout_options.ask_for_shipping_address, false);
    assert.equal(p.data.totalCents, 781);
    // ship + cheap cart → shipping line item
    await c.post('/checkout', { lines: [{ name: 'Sleeves', price: 7.81, qty: 1 }], fulfillment: 'ship' });
    const sb = s.calls[s.calls.length - 1].body;
    assert.equal(sb.order.line_items[1].name, 'Shipping');
    assert.equal(sb.order.line_items[1].base_price_money.amount, 499);
  } finally { s.restore(); }
});

test('real mode: Square 4xx → 502 with the Square message; attempt recorded as failed', async () => {
  const env = makeEnv({ SQUARE_ACCESS_TOKEN: 'sq-token', SQUARE_LOCATION_ID: 'LOC1' });
  const c = client(env);
  const s = stubFetch({ square: () => new Response(JSON.stringify({ errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'INVALID_VALUE', detail: 'location_id is invalid' }] }), { status: 400 }) });
  try {
    const r = await c.post('/checkout', { lines: [{ name: 'Sleeves', price: 7.81, qty: 1 }] });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /INVALID_VALUE: location_id is invalid/);
    assert.ok(r.data.orderId);
    const stored = await env.KV.get('order:' + r.data.orderId, 'json');
    assert.equal(stored.status, 'failed');
    assert.match(stored.error, /location_id/);
  } finally { s.restore(); }
  const down = stubFetch({ square: () => { throw new TypeError('fetch failed'); } });
  try {
    const r = await c.post('/checkout', { lines: [{ name: 'Sleeves', price: 7.81, qty: 1 }] });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /unreachable/);
  } finally { down.restore(); }
});

test('staff can list order attempts newest first (no IPs); public lookup hides email', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const a = await c.post('/checkout', { lines: [{ name: 'A', price: 1, qty: 1 }], email: 'x@y.co' });
    await new Promise(r => setTimeout(r, 5));
    const b = await c.post('/checkout', { lines: [{ name: 'B', price: 2, qty: 1 }] });
    assert.equal((await c.get('/checkout/orders')).status, 401);
    const staff = await c.login('staff');
    const l = await c.get('/checkout/orders', { token: staff });
    assert.equal(l.status, 200);
    assert.deepEqual(l.data.orders.map(o => o.id), [b.data.orderId, a.data.orderId]);
    assert.equal(l.data.orders[1].ip, undefined);
    assert.equal(l.data.orders[1].email, 'x@y.co');
    const pub = await c.get('/checkout/orders/' + a.data.orderId);
    assert.equal(pub.data.order.status, 'mock');
    assert.equal(pub.data.order.email, undefined);
    assert.equal((await c.get('/checkout/orders/TL-NOPE')).status, 404);
  } finally { s.restore(); }
});

test('checkout is rate limited per IP', async () => {
  const c = client(makeEnv());
  const s = stubFetch();
  try {
    let last;
    for (let i = 0; i < 21; i++) last = await c.post('/checkout', { lines: [{ name: 'A', price: 1, qty: 1 }] });
    assert.equal(last.status, 429);
  } finally { s.restore(); }
});
