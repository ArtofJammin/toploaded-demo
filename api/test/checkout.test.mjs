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

const squareEnv = (extra = {}) => makeEnv({ SQUARE_ACCESS_TOKEN: 'sq-token', SQUARE_LOCATION_ID: 'LOC1', ...extra });
const squareCalls = (s) => s.calls.filter(x => x.url.includes('squareup')).length;

const lines = [
  { id: 'tcg-712122', name: 'Monkey.D.Luffy (ST31-004) (SP)', price: 1046.01, qty: 1, game: 'op' },
  { id: 'demo-3', name: 'Charizard ex 199/165', price: 85, qty: 2, game: 'pk' },
];
const sleeves = (extra = {}) => ({ id: 'tcg-614504', name: 'Sleeves', price: 7.81, qty: 1, ...extra });

test.beforeEach(() => resetInventoryCache());

test('mock mode: server total, unknown ids accepted but flagged trusted:false, order stored 7 days', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const r = await c.post('/checkout', { lines, fulfillment: 'pickup', email: 'Buyer@Example.com', note: 'ring when ready' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.mock, true);
    assert.equal(r.data.url, null);
    assert.ok(/^TL-[A-Z0-9]+-[A-F0-9]{10}$/.test(r.data.orderId), r.data.orderId);
    assert.equal(r.data.totalCents, 104601 + 17000);
    assert.equal(r.data.total, 1216.01);
    assert.equal(r.data.shippingCents, 0);
    assert.deepEqual(r.data.lines.map(l => [l.id, l.trusted]), [['tcg-712122', true], ['demo-3', false]]);
    const stored = await env.KV.get('order:' + r.data.orderId, 'json');
    assert.equal(stored.status, 'mock');
    assert.equal(stored.email, 'buyer@example.com');
    assert.equal(stored.priced, 'mixed', 'one line from inventory, one on the client\'s word');
    assert.deepEqual(stored.lines.map(l => l.trusted), [true, false]);
    assert.equal(stored.lines.length, 2);
    assert.ok(env.KV.exp.get('order:' + r.data.orderId) > Date.now() + 6 * 24 * 3600 * 1000, 'expires in ~7 days');
    assert.equal(squareCalls(s), 0, 'Square never called');
    // a cart of nothing but verified lines is priced:"inventory"; nothing verified is priced:"client"
    const inv = await c.post('/checkout', { lines: [sleeves()] });
    assert.equal((await env.KV.get('order:' + inv.data.orderId, 'json')).priced, 'inventory');
    const cli = await c.post('/checkout', { lines: [{ id: 'demo-3', name: 'Charizard ex', price: 85, qty: 1 }] });
    assert.equal((await env.KV.get('order:' + cli.data.orderId, 'json')).priced, 'client');
  } finally { s.restore(); }
});

test('mock mode reports SQUARE_ENV missing and degrades (flagged) without inventory.json', async () => {
  const env = makeEnv({ SQUARE_ENV: '' });
  const c = client(env);
  const s = stubFetch({ inventoryStatus: 404 });
  try {
    const r = await c.post('/checkout', { lines: [{ name: 'Sleeves', price: 7.81, qty: 1 }], fulfillment: 'ship' });
    assert.equal(r.status, 200);
    assert.equal(r.data.mock, true);
    assert.equal(r.data.reason, 'SQUARE_ENV not set');
    assert.equal(r.data.shippingCents, 499, 'flat shipping under the free threshold');
    assert.equal(r.data.totalCents, 781 + 499);
    assert.deepEqual(r.data.lines.map(l => l.trusted), [false]);
    // inventory unreachable: a tcg- line falls back to the client's price, but says so
    const t = await c.post('/checkout', { lines: [sleeves({ price: 5 })] });
    assert.equal(t.status, 200);
    assert.equal(t.data.totalCents, 500);
    assert.equal(t.data.lines[0].trusted, false);
    assert.equal((await env.KV.get('order:' + t.data.orderId, 'json')).priced, 'client');
  } finally { s.restore(); }
});

test('validation: line count, qty, price, name length, id length, fulfillment, honeypot', async () => {
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
    await bad({ lines: [{ name: 'a', qty: 1 }] }, /price/);
    await bad({ lines: [{ name: 'x'.repeat(121), price: 1, qty: 1 }] }, /too long/);
    await bad({ lines: [{ name: '', price: 1, qty: 1 }] }, /required/);
    await bad({ lines: [{ id: 'x'.repeat(81), name: 'a', price: 1, qty: 1 }] }, /id too long/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 1 }], fulfillment: 'drone' }, /fulfillment/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 1 }], email: 'nope' }, /email/);
    await bad({ lines: [{ name: 'a', price: 1, qty: 1 }], website: 'http://spam' }, /spam/);
  } finally { s.restore(); }
});

test('tcg- lines: stock-checked (409 with available), always priced from inventory, ids normalised', async () => {
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
    const cheap = await c.post('/checkout', { lines: [sleeves({ price: 0.01, qty: 5 })] });
    assert.equal(cheap.status, 200);
    assert.equal(cheap.data.totalCents, 781 * 5, 'server price wins over a tampered client price');
    const dear = await c.post('/checkout', { lines: [sleeves({ price: 99, qty: 1 })] });
    assert.equal(dear.data.totalCents, 781, 'the listing price is used even when the client says more');
    // upper case / padding in the id cannot dodge the inventory lookup; the shop's name is billed
    const up = await c.post('/checkout', { lines: [{ id: '  TCG-614504 ', name: 'Totally a Charizard', price: 0.01, qty: 1 }] });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.totalCents, 781);
    assert.deepEqual(up.data.lines[0], { id: 'tcg-614504', name: 'Prismatic Evolutions ETB Sleeves', price: 7.81, qty: 1, trusted: true });
    const noPrice = await c.post('/checkout', { lines: [{ id: 'tcg-614504', name: 'Sleeves', qty: 2 }] });
    assert.equal(noPrice.status, 200, 'server-priced lines may omit the client price');
    assert.equal(noPrice.data.totalCents, 1562);
    assert.equal(s.calls.filter(x => x.url.endsWith('inventory.json')).length, 1, 'inventory.json fetched once per isolate');
  } finally { s.restore(); }
});

test('live-spot- lines: priced from config.live.spotPrice, qty capped at 1, spot must exist', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const r = await c.post('/checkout', { lines: [{ id: 'live-spot-3', name: 'Spot', price: 0.01, qty: 5 }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.totalCents, 2499, 'default spotPrice 24.99');
    assert.deepEqual(r.data.lines[0], { id: 'live-spot-3', name: 'Break spot #3 · Prismatic Evolutions booster box break', price: 24.99, qty: 1, trusted: true });
    assert.equal((await env.KV.get('order:' + r.data.orderId, 'json')).priced, 'inventory');

    await env.KV.put('config', JSON.stringify({ live: { spotPrice: 30, spots: 4, title: 'Friday break' } }));
    const cfg = await c.post('/checkout', { lines: [{ id: 'LIVE-SPOT-4', name: 'Spot', price: 1, qty: 1 }] });
    assert.equal(cfg.data.totalCents, 3000, 'admin-set spot price');
    assert.equal(cfg.data.lines[0].name, 'Break spot #4 · Friday break');
    const none = await c.post('/checkout', { lines: [{ id: 'live-spot-9', name: 'Spot', price: 1, qty: 1 }] });
    assert.equal(none.status, 409);
    assert.deepEqual(none.data.items, [{ id: 'live-spot-9', available: 0, reason: 'no such spot' }]);

    // no usable spot price: mock mode keeps the client's figure but flags it
    await env.KV.put('config', JSON.stringify({ live: { spotPrice: 0 } }));
    const free = await c.post('/checkout', { lines: [{ id: 'live-spot-1', name: 'Spot', price: 5, qty: 3 }] });
    assert.equal(free.status, 200);
    assert.equal(free.data.totalCents, 500);
    assert.deepEqual([free.data.lines[0].qty, free.data.lines[0].trusted], [1, false]);
    assert.equal(s.calls.filter(x => x.url.endsWith('inventory.json')).length, 0, 'spot-only carts never fetch inventory');
  } finally { s.restore(); }
});

test('real mode: never bills client prices — unknown ids 400, inventory down 503, unpriced spots 409', async () => {
  const env = squareEnv();
  const c = client(env);
  const s = stubFetch({ square: squareOk });
  try {
    const demo = await c.post('/checkout', { lines: [{ id: 'x-1', name: 'Charizard ex', price: 0.01, qty: 1 }] });
    assert.equal(demo.status, 400);
    assert.match(demo.data.error, /line 1 \(Charizard ex\) is not something the shop sells online/);
    const noId = await c.post('/checkout', { lines: [{ name: 'Sleeves', price: 7.81, qty: 1 }] });
    assert.equal(noId.status, 400);
    const mixed = await c.post('/checkout', { lines, fulfillment: 'ship' });
    assert.equal(mixed.status, 400, 'one bad line fails the whole cart');
    assert.match(mixed.data.error, /line 2/);
    assert.equal(squareCalls(s), 0, 'no Payment Link for anything the server could not price');
    assert.equal((await env.KV.list({ prefix: 'order:' })).keys.length, 0, 'nothing recorded');

    await env.KV.put('config', JSON.stringify({ live: { spotPrice: 0 } }));
    const spot = await c.post('/checkout', { lines: [{ id: 'live-spot-2', name: 'Spot', price: 24.99, qty: 1 }] });
    assert.equal(spot.status, 409);
    assert.equal(spot.data.items[0].reason, 'spot price is not set');
    assert.equal(squareCalls(s), 0);
  } finally { s.restore(); }

  resetInventoryCache();
  const down = stubFetch({ square: squareOk, inventoryStatus: 500 });
  try {
    const r = await c.post('/checkout', { lines: [sleeves()] });
    assert.equal(r.status, 503);
    assert.match(r.data.error, /pricing is unavailable/);
    assert.equal(squareCalls(down), 0);
  } finally { down.restore(); }
});

test('real mode: builds a Square Payment Link request from server prices and stores the link', async () => {
  const env = squareEnv();
  const c = client(env);
  const s = stubFetch({ square: squareOk });
  try {
    const cart = [{ id: 'TCG-712122', name: 'Luffy', price: 0.01, qty: 1, game: 'op' }, sleeves({ price: 0.01, qty: 2 })];
    const r = await c.post('/checkout', { lines: cart, fulfillment: 'ship', email: 'buyer@example.com', note: 'gift' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.mock, false);
    assert.equal(r.data.url, 'https://sandbox.square.link/u/abc');
    assert.equal(r.data.totalCents, 104601 + 1562);
    assert.equal(r.data.shippingCents, 0, 'free shipping over $100');
    assert.deepEqual(r.data.lines.map(l => l.trusted), [true, true]);
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
    assert.equal(b.order.line_items[0].name, 'Monkey.D.Luffy (ST31-004) (SP)', 'inventory name, not the client\'s');
    assert.deepEqual(b.order.line_items[0].base_price_money, { amount: 104601, currency: 'USD' });
    assert.equal(b.order.line_items[0].quantity, '1');
    assert.equal(b.order.line_items[0].note, 'tcg:712122 Near Mint');
    assert.equal(b.order.line_items[1].quantity, '2');
    assert.deepEqual(b.order.line_items[1].base_price_money, { amount: 781, currency: 'USD' });
    assert.equal(b.order.fulfillments, undefined, 'ship orders let Square collect the address');
    assert.equal(b.checkout_options.ask_for_shipping_address, true);
    assert.equal(b.checkout_options.redirect_url, `https://artofjammin.github.io/toploaded-demo/#/shop?order=${r.data.orderId}`);
    assert.equal(b.pre_populated_data.buyer_email, 'buyer@example.com');
    assert.equal(b.description, 'gift');
    const stored = await env.KV.get('order:' + r.data.orderId, 'json');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.priced, 'inventory');
    assert.deepEqual(stored.square, { paymentLinkId: 'PL1', orderId: 'SQO-1', url: 'https://sandbox.square.link/u/abc', createdAt: '2026-09-04T12:00:00Z' });
    assert.deepEqual(await env.KV.get('order:sq:SQO-1', 'json'), { id: r.data.orderId });

    // pickup + cheap cart → PICKUP fulfilment and a shipping-free total
    const p = await c.post('/checkout', { lines: [sleeves()], fulfillment: 'pickup', email: 'a@b.co' });
    const pb = s.calls[s.calls.length - 1].body;
    assert.equal(pb.order.fulfillments[0].type, 'PICKUP');
    assert.equal(pb.order.fulfillments[0].pickup_details.recipient.email_address, 'a@b.co');
    assert.equal(pb.checkout_options.ask_for_shipping_address, false);
    assert.equal(p.data.totalCents, 781);
    // ship + cheap cart → shipping line item
    await c.post('/checkout', { lines: [sleeves()], fulfillment: 'ship' });
    const sb = s.calls[s.calls.length - 1].body;
    assert.equal(sb.order.line_items[1].name, 'Shipping');
    assert.equal(sb.order.line_items[1].base_price_money.amount, 499);
    // live spot → priced from config, one per line, tagged for the webhook
    const spot = await c.post('/checkout', { lines: [{ id: 'live-spot-2', name: 'Spot', price: 0.01, qty: 4 }] });
    assert.equal(spot.status, 200, JSON.stringify(spot.data));
    assert.equal(spot.data.totalCents, 2499);
    const lb = s.calls[s.calls.length - 1].body;
    assert.deepEqual(lb.order.line_items, [{ name: 'Break spot #2 · Prismatic Evolutions booster box break', quantity: '1', base_price_money: { amount: 2499, currency: 'USD' }, note: 'live-spot:2' }]);
  } finally { s.restore(); }
});

test('real mode: Square 4xx → 502 with the Square message; attempt recorded as failed', async () => {
  const env = squareEnv();
  const c = client(env);
  const s = stubFetch({ square: () => new Response(JSON.stringify({ errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'INVALID_VALUE', detail: 'location_id is invalid' }] }), { status: 400 }) });
  try {
    const r = await c.post('/checkout', { lines: [sleeves()] });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /INVALID_VALUE: location_id is invalid/);
    assert.ok(r.data.orderId);
    const stored = await env.KV.get('order:' + r.data.orderId, 'json');
    assert.equal(stored.status, 'failed');
    assert.match(stored.error, /location_id/);
  } finally { s.restore(); }
  const down = stubFetch({ square: () => { throw new TypeError('fetch failed'); } });
  try {
    const r = await c.post('/checkout', { lines: [sleeves()] });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /unreachable/);
  } finally { down.restore(); }
});

test('staff list keeps everything but IPs; public lookup is status only', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const a = await c.post('/checkout', { lines: [{ id: 'x-2', name: 'A', price: 1, qty: 1 }], email: 'x@y.co', note: 'leave it at the back door, code 4421' });
    await new Promise(r => setTimeout(r, 5));
    const b = await c.post('/checkout', { lines: [{ name: 'B', price: 2, qty: 1 }], fulfillment: 'ship' });
    assert.equal((await c.get('/checkout/orders')).status, 401);
    const staff = await c.login('staff');
    const l = await c.get('/checkout/orders', { token: staff });
    assert.equal(l.status, 200);
    assert.deepEqual(l.data.orders.map(o => o.id), [b.data.orderId, a.data.orderId]);
    assert.equal(l.data.orders[1].ip, undefined);
    assert.equal(l.data.orders[1].email, 'x@y.co');
    assert.equal(l.data.orders[1].note, 'leave it at the back door, code 4421');
    assert.equal(l.data.orders[1].lines[0].trusted, false);

    const pub = await c.get('/checkout/orders/' + a.data.orderId);
    assert.equal(pub.status, 200);
    assert.deepEqual(Object.keys(pub.data.order).sort(), ['at', 'fulfillment', 'id', 'status', 'total']);
    assert.deepEqual(pub.data.order, { id: a.data.orderId, status: 'mock', total: 1, at: l.data.orders[1].at, fulfillment: 'pickup' });
    assert.equal((await c.get('/checkout/orders/' + b.data.orderId)).data.order.fulfillment, 'ship');
    // a paid order exposes no receipt, payment id or Square link either
    await env.KV.put('order:TL-PAID', JSON.stringify({ id: 'TL-PAID', at: '2026-09-04T10:00:00Z', status: 'paid', total: 12.5, fulfillment: 'pickup', paidAt: '2026-09-04T10:05:00Z',
      receiptUrl: 'https://squareup.com/receipt/1', paymentId: 'PAY-1', square: { url: 'https://sandbox.square.link/u/abc' }, lines: [{ id: 'tcg-1', name: 'x', price: 12.5, qty: 1 }], email: 'p@q.co', note: 'secret' }));
    const paid = await c.get('/checkout/orders/TL-PAID');
    assert.deepEqual(paid.data.order, { id: 'TL-PAID', status: 'paid', total: 12.5, at: '2026-09-04T10:00:00Z', fulfillment: 'pickup' });
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
