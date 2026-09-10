import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';
import { signWebhook } from '../src/lib/square.js';
import { scheduleSaleCheck, sellerListing, consumeSaleChecks } from '../src/lib/sale-checks.js';

const listingResponse = (extra = {}) => new Response(JSON.stringify({ results: [{ totalResults: 1,
  results: [{ productId: 123, listings: [{ sellerKey: '5c356cdf', quantity: 2 }], ...extra }] }] }));
function message(extra = {}) {
  const m = { body: { version: 1, paymentId: 'P1', notBefore: Date.now() - 1,
    lines: [{ productId: '123', name: 'Test card', qty: 1 }] }, attempts: 1, ...extra };
  m.ack = () => { m.acked = true; };
  m.retry = options => { m.retryOptions = options; };
  return m;
}

test('sale check producer delays five minutes, dedupes payments, and fails closed without queue', async () => {
  const sent = [], env = makeEnv({ SALE_CHECK_QUEUE: { send: async (...args) => sent.push(args) } });
  const payment = { id: 'P1', order_id: 'O1' }, start = Date.now();
  await scheduleSaleCheck(env, payment, { lines: [{ id: 'tcg-123', name: 'Card', qty: 1 }] });
  await scheduleSaleCheck(env, payment);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][1], { delaySeconds: 300 });
  assert.ok(sent[0][0].notBefore >= start + 300000);
  assert.equal(sent[0][0].lines[0].productId, '123');
  assert.equal(await scheduleSaleCheck(makeEnv(), payment), false);
});

test('listing lookup validates seller and product, rejects malformed/errors instead of declaring sold out', async t => {
  let response = listingResponse();
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.filters.term.productId, [123]);
    assert.deepEqual(body.listingSearch.filters.term.sellerKey, ['5c356cdf']);
    return response;
  });
  assert.deepEqual(await sellerListing('123'), { listed: true, quantityShown: 2 });
  response = listingResponse({ productId: 456 });
  await assert.rejects(sellerListing('123'), /filter/);
  response = listingResponse({ listings: [{ sellerKey: 'another-seller', quantity: 4 }] });
  await assert.rejects(sellerListing('123'), /seller/);
  response = new Response('{}');
  await assert.rejects(sellerListing('123'), /unrecognized/);
  response = new Response('', { status: 403 });
  await assert.rejects(sellerListing('123'), /403/);
  response = new Response(JSON.stringify({ results: [{ totalResults: 0, results: [] }] }));
  assert.deepEqual(await sellerListing('123'), { listed: false, quantityShown: 0 });
});

test('consumer never checks early, creates factual alerts, and dedupes redelivery', async t => {
  const env = makeEnv();
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return listingResponse(); });
  const early = message(); early.body.notBefore = Date.now() + 300000;
  await consumeSaleChecks({ messages: [early] }, env);
  assert.equal(fetches, 0); assert.ok(early.retryOptions.delaySeconds >= 299);
  const due = message();
  await consumeSaleChecks({ messages: [due] }, env);
  assert.equal(due.acked, true); assert.equal(fetches, 1);
  const alerts = await env.KV.get('alerts', 'json');
  assert.match(alerts[0].msg, /still listed; 2 units shown/);
  assert.match(alerts[0].msg, /Confirm remaining physical stock/);
  await consumeSaleChecks({ messages: [message()] }, env);
  assert.equal(fetches, 1);
});

test('failed lookups retry, then leave a manual staff alert, not a successful stock result', async t => {
  const env = makeEnv();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  const first = message();
  await consumeSaleChecks({ messages: [first] }, env);
  assert.deepEqual(first.retryOptions, { delaySeconds: 300 });
  assert.equal(await env.KV.get('sale-check:result:P1'), null);
  const last = message({ attempts: 4 });
  await consumeSaleChecks({ messages: [last] }, env);
  assert.equal(last.acked, true);
  assert.equal((await env.KV.get('sale-check:result:P1', 'json')).failed, true);
  assert.match((await env.KV.get('alerts', 'json'))[0].msg, /could not finish/);
});

test('POS mapping resolves only explicit TCG SKU; unmatched items stay manual', async t => {
  const env = makeEnv({ SQUARE_ACCESS_TOKEN: 'test' });
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/v2/orders/')) return new Response(JSON.stringify({ order: { state: 'COMPLETED',
      line_items: [{ name: 'Card', quantity: '1', catalog_object_id: 'VAR1' }, { name: 'Unmapped', quantity: '1' }] } }));
    if (String(url).includes('/v2/catalog/object/')) return new Response(JSON.stringify({ object: { item_variation_data: { sku: 'tcg:123' } } }));
    return listingResponse();
  });
  const msg = message({ body: { version: 1, paymentId: 'POS1', orderId: 'O1', notBefore: 1 } });
  await consumeSaleChecks({ messages: [msg] }, env);
  assert.equal(msg.acked, true);
  const results = (await env.KV.get('sale-check:result:POS1', 'json')).results;
  assert.equal(results[0].listed, true);
  assert.equal(results[1].status, 'needs-mapping');
});

test('only verified completed payments enqueue; failed queue writes leave webhook retryable', async () => {
  let fail = true, sent = 0;
  const env = makeEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: 'key', SQUARE_WEBHOOK_URL: 'https://api.test/square/webhook',
    SALE_CHECK_QUEUE: { send: async () => { if (fail) throw new Error('queue unavailable'); sent++; } } });
  const c = client(env);
  async function post(status, eventId, unsigned = false) {
    const raw = JSON.stringify({ event_id: eventId, type: 'payment.updated', data: { object: { payment: { id: 'P1', status } } } });
    return c.call('POST', '/square/webhook', undefined, { raw, headers: { 'x-square-hmacsha256-signature': unsigned ? 'bad' : await signWebhook('key', env.SQUARE_WEBHOOK_URL, raw) } });
  }
  assert.equal((await post('COMPLETED', 'bad', true)).status, 401);
  assert.equal((await post('PENDING', 'pending')).status, 200);
  assert.equal(sent, 0);
  assert.equal((await post('COMPLETED', 'retry')).status, 503);
  assert.equal(await env.KV.get('square:event:retry'), null);
  fail = false;
  assert.equal((await post('COMPLETED', 'retry')).status, 200);
  assert.equal(sent, 1);
  assert.equal((await post('COMPLETED', 'retry')).data.duplicate, true);
  assert.equal(sent, 1);
});
