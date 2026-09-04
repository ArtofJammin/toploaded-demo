import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeEnv, client } from './helpers.mjs';
import { verifyWebhookSignature, signWebhook, squareBase, squareConfigured } from '../src/lib/square.js';

const KEY = 'test-webhook-signature-key';
const URL = 'https://toploaded-api.example.workers.dev/square/webhook';
const sign = (body, key = KEY, url = URL) => createHmac('sha256', key).update(url + body).digest('base64');

function hookEnv(extra = {}) {
  return makeEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_URL: URL, ...extra });
}
async function post(c, event, { key = KEY, sig } = {}) {
  const raw = JSON.stringify(event);
  return c.call('POST', '/square/webhook', undefined, { raw, headers: { 'x-square-hmacsha256-signature': sig !== undefined ? sig : sign(raw, key) } });
}
const alerts = (env) => env.KV.get('alerts', 'json').then(a => a || []);

test('signature helper matches a known HMAC and rejects everything else', async () => {
  const body = '{"type":"payment.updated","event_id":"e1"}';
  const expected = sign(body);
  assert.equal(await signWebhook(KEY, URL, body), expected);
  const env = { SQUARE_WEBHOOK_SIGNATURE_KEY: KEY };
  assert.equal(await verifyWebhookSignature(env, URL, body, expected), true);
  assert.equal(await verifyWebhookSignature(env, URL, body, expected.slice(0, -2) + 'AA'), false);
  assert.equal(await verifyWebhookSignature(env, URL, body + ' ', expected), false, 'body tampered');
  assert.equal(await verifyWebhookSignature(env, URL + '2', body, expected), false, 'url differs');
  assert.equal(await verifyWebhookSignature({ SQUARE_WEBHOOK_SIGNATURE_KEY: 'other' }, URL, body, expected), false, 'wrong key');
  assert.equal(await verifyWebhookSignature(env, URL, body, ''), false);
  assert.equal(await verifyWebhookSignature({}, URL, body, expected), false, 'no key configured');
  assert.equal(squareBase({ SQUARE_ENV: 'sandbox' }), 'https://connect.squareupsandbox.com');
  assert.equal(squareBase({ SQUARE_ENV: 'production' }), 'https://connect.squareup.com');
  assert.equal(squareConfigured({ SQUARE_ENV: 'sandbox' }), false);
  assert.equal(squareConfigured({ SQUARE_ENV: 'sandbox', SQUARE_ACCESS_TOKEN: 'x', SQUARE_LOCATION_ID: 'L' }), true);
});

test('webhook rejects unsigned, wrong-key and unconfigured requests with 401', async () => {
  const env = hookEnv();
  const c = client(env);
  const event = { type: 'payment.updated', event_id: 'ev-1', data: { object: { payment: { status: 'COMPLETED' } } } };
  assert.equal((await post(c, event, { sig: '' })).status, 401);
  assert.equal((await post(c, event, { key: 'wrong-key' })).status, 401);
  const r = await c.call('POST', '/square/webhook', undefined, { raw: JSON.stringify(event) });
  assert.equal(r.status, 401);
  assert.equal((await alerts(env)).length, 0, 'nothing stored for rejected events');
  const none = client(makeEnv());
  assert.equal((await post(none, event)).status, 401, 'no signature key configured');
});

test('inventory.count.updated → TCGplayer alert, coalesced per object per hour, deduped by event id', async () => {
  const env = hookEnv();
  const c = client(env);
  const event = {
    merchant_id: 'M1', type: 'inventory.count.updated', event_id: 'ev-inv-1', created_at: '2026-09-04T12:00:00Z',
    data: { type: 'inventory', id: 'x', object: { inventory_counts: [
      { catalog_object_id: 'OBJ-CHAR', catalog_object_type: 'ITEM_VARIATION', state: 'IN_STOCK', location_id: 'L1', quantity: '0' },
      { catalog_object_id: 'OBJ-RING', catalog_object_type: 'ITEM_VARIATION', state: 'IN_STOCK', location_id: 'L1', quantity: '3' },
    ] } },
  };
  const r = await post(c, event);
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.handled, true);
  assert.equal(r.data.alerts, 2);
  let list = await alerts(env);
  assert.equal(list.length, 2);
  const a = list.find(x => x.msg.includes('OBJ-CHAR'));
  assert.equal(a.ch, 'TCGplayer');
  assert.equal(a.ack, false);
  assert.equal(a.source, 'square:inventory.count.updated');
  assert.match(a.msg, /Sold out in Square/);
  assert.ok(a.id && a.at);
  assert.ok(await env.KV.get('square:event:ev-inv-1'), 'raw event kept');

  const dup = await post(c, event);
  assert.equal(dup.status, 200);
  assert.equal(dup.data.duplicate, true);
  assert.equal((await alerts(env)).length, 2, 'duplicate event id creates nothing');

  const again = await post(c, { ...event, event_id: 'ev-inv-2' });
  assert.equal(again.data.alerts, 0, 'same catalog objects within the hour are coalesced');
  list = await alerts(env);
  assert.equal(list.length, 2);
  const hooks = await env.KV.get('square:hooks:last', 'json');
  assert.equal(hooks['inventory.count.updated'].ok, true);
});

test('order.created from the POS → one alert per line item (fetched from Square when a token is set)', async () => {
  const env = hookEnv({ SQUARE_ACCESS_TOKEN: 'tok', SQUARE_LOCATION_ID: 'L1' });
  const c = client(env);
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers['square-version'], '2025-07-16');
    assert.match(String(url), /^https:\/\/connect\.squareupsandbox\.com\/v2\/orders\/SQO-1$/);
    return new Response(JSON.stringify({ order: { id: 'SQO-1', source: { name: 'Square Point of Sale' }, line_items: [
      { name: 'Charizard ex 199/165', quantity: '1', note: 'tcg:614504 NM' },
      { name: 'Prismatic ETB', quantity: '2' },
    ] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await post(c, { type: 'order.created', event_id: 'ev-ord-1', data: { type: 'order_created', id: 'SQO-1', object: { order_created: { order_id: 'SQO-1', state: 'OPEN', location_id: 'L1' } } } });
    assert.equal(r.status, 200);
    assert.equal(r.data.alerts, 2);
    assert.equal(calls.length, 1);
    const list = await alerts(env);
    assert.equal(list.length, 2);
    const ch = list.find(x => x.msg.includes('Charizard'));
    assert.match(ch.msg, /Sold in-store \(Square\)/);
    assert.equal(ch.sku, 'tcg:614504');
    assert.match(list.find(x => x.msg.includes('ETB')).msg, /x2/);
  } finally { globalThis.fetch = realFetch; }
});

test('order.created without a token still produces a generic alert; Payment Link orders are skipped', async () => {
  const env = hookEnv();
  const c = client(env);
  const r = await post(c, { type: 'order.created', event_id: 'ev-ord-2', data: { object: { order_created: { order_id: 'SQO-2' } } } });
  assert.equal(r.data.alerts, 1);
  assert.match((await alerts(env))[0].msg, /check the case/);
  // our own checkout order → announced by payment.updated, not order.created
  await env.KV.put('order:sq:SQO-3', JSON.stringify({ id: 'TL-1' }));
  const r2 = await post(c, { type: 'order.created', event_id: 'ev-ord-3', data: { object: { order_created: { order_id: 'SQO-3' } } } });
  assert.equal(r2.data.alerts, 0);
});

test('payment.updated COMPLETED marks our order paid and alerts per line; FAILED marks it failed', async () => {
  const env = hookEnv();
  const c = client(env);
  const order = { id: 'TL-ABC', at: '2026-09-04T10:00:00Z', status: 'pending', lines: [{ id: 'tcg-712122', name: 'Luffy SP', qty: 1, price: 1046.01 }], square: { orderId: 'SQO-9' } };
  await env.KV.put('order:TL-ABC', JSON.stringify(order));
  await env.KV.put('order:sq:SQO-9', JSON.stringify({ id: 'TL-ABC' }));
  const r = await post(c, { type: 'payment.updated', event_id: 'ev-pay-1', data: { object: { payment: { id: 'PAY-1', status: 'COMPLETED', order_id: 'SQO-9', receipt_url: 'https://squareup.com/receipt/1', amount_money: { amount: 104601, currency: 'USD' } } } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.alerts, 1);
  const stored = await env.KV.get('order:TL-ABC', 'json');
  assert.equal(stored.status, 'paid');
  assert.equal(stored.receiptUrl, 'https://squareup.com/receipt/1');
  const a = (await alerts(env))[0];
  assert.match(a.msg, /Paid online \(TL-ABC\): Luffy SP/);
  assert.equal(a.sku, 'tcg:712122');
  const pub = await c.get('/checkout/orders/TL-ABC');
  assert.equal(pub.data.order.status, 'paid');

  await env.KV.put('order:TL-DEF', JSON.stringify({ ...order, id: 'TL-DEF', square: { orderId: 'SQO-10' } }));
  await env.KV.put('order:sq:SQO-10', JSON.stringify({ id: 'TL-DEF' }));
  const f = await post(c, { type: 'payment.updated', event_id: 'ev-pay-2', data: { object: { payment: { status: 'FAILED', order_id: 'SQO-10' } } } });
  assert.equal(f.data.alerts, 0);
  assert.equal((await env.KV.get('order:TL-DEF', 'json')).status, 'failed');

  // unknown order → generic alert with the amount
  const u = await post(c, { type: 'payment.updated', event_id: 'ev-pay-3', data: { object: { payment: { status: 'COMPLETED', order_id: 'SQO-77', amount_money: { amount: 1250 } } } } });
  assert.equal(u.data.alerts, 1);
  assert.match((await alerts(env))[0].msg, /\$12\.50/);
});

test('unknown event types and junk bodies still return 200 once verified', async () => {
  const env = hookEnv();
  const c = client(env);
  const r = await post(c, { type: 'customer.created', event_id: 'ev-cust-1', data: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.handled, false);
  const raw = 'not json';
  const j = await c.call('POST', '/square/webhook', undefined, { raw, headers: { 'x-square-hmacsha256-signature': sign(raw) } });
  assert.equal(j.status, 200);
  assert.equal(j.data.ignored, 'invalid JSON');
  const hooks = await env.KV.get('square:hooks:last', 'json');
  assert.equal(hooks['customer.created'].note, 'unhandled type');
});
