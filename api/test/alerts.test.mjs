import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';
import { appendAlert, MAX_ALERTS } from '../src/routes/alerts.js';

test('alerts: staff only', async () => {
  const c = client(makeEnv());
  assert.equal((await c.get('/alerts')).status, 401);
  assert.equal((await c.post('/alerts', { msg: 'x', ch: 'Square' })).status, 401);
  assert.equal((await c.post('/alerts/abc/ack')).status, 401);
  const staff = await c.login('staff');
  const r = await c.get('/alerts', { token: staff });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { alerts: [], open: 0 });
});

test('alerts: create, list open-first, ack, filters', async () => {
  const c = client(makeEnv());
  const staff = await c.login('staff');
  const a = await c.post('/alerts', { msg: 'Sold in-store (Square): <b>Charizard ex</b> — update the TCGplayer listing', ch: 'TCGplayer' }, { token: staff });
  assert.equal(a.status, 200);
  assert.equal(a.data.ok, true);
  assert.equal(a.data.open, 1);
  assert.equal(a.data.alert.msg, 'Sold in-store (Square): Charizard ex — update the TCGplayer listing', 'html stripped');
  assert.equal(a.data.alert.ch, 'TCGplayer');
  assert.equal(a.data.alert.ack, false);
  assert.equal(a.data.alert.source, 'staff');
  assert.ok(a.data.alert.id && a.data.alert.at);

  assert.equal((await c.post('/alerts', { msg: 'x', ch: 'TCGplayer' }, { token: staff })).status, 400, 'msg too short');
  assert.equal((await c.post('/alerts', { msg: 'Sold something', ch: 'eBay' }, { token: staff })).status, 400, 'bad channel');
  assert.equal((await c.post('/alerts', { msg: 'x'.repeat(300), ch: 'Square' }, { token: staff })).status, 400, 'msg capped');

  const b = await c.post('/alerts', { msg: 'Sold on TCGplayer: The One Ring — pull it from the case', ch: 'Square', source: 'inventory-diff' }, { token: staff });
  assert.equal(b.data.alert.source, 'inventory-diff');
  const list = await c.get('/alerts', { token: staff });
  assert.equal(list.data.open, 2);
  assert.deepEqual(list.data.alerts.map(x => x.id), [b.data.alert.id, a.data.alert.id], 'newest first');

  const ack = await c.post(`/alerts/${b.data.alert.id}/ack`, undefined, { token: staff });
  assert.equal(ack.status, 200);
  assert.equal(ack.data.open, 1);
  assert.equal(ack.data.alert.ack, true);
  assert.equal(ack.data.alert.ackedBy, 'staff');
  assert.ok(ack.data.alert.ackedAt);
  const again = await c.post(`/alerts/${b.data.alert.id}/ack`, undefined, { token: staff });
  assert.equal(again.status, 200, 'ack is idempotent');
  assert.equal(again.data.alert.ackedAt, ack.data.alert.ackedAt);
  assert.equal((await c.post('/alerts/nope/ack', undefined, { token: staff })).status, 404);

  const after = await c.get('/alerts', { token: staff });
  assert.deepEqual(after.data.alerts.map(x => [x.id, x.ack]), [[a.data.alert.id, false], [b.data.alert.id, true]], 'open first, then acked');
  assert.equal(after.data.open, 1);
  const open = await c.get('/alerts?status=open', { token: staff });
  assert.deepEqual(open.data.alerts.map(x => x.id), [a.data.alert.id]);
  const acked = await c.get('/alerts?status=acked', { token: staff });
  assert.deepEqual(acked.data.alerts.map(x => x.id), [b.data.alert.id]);
  assert.equal((await c.get('/alerts?status=maybe', { token: staff })).status, 400);
  assert.equal((await c.get('/alerts?limit=1', { token: staff })).data.alerts.length, 1);
  const admin = await c.login('admin');
  assert.equal((await c.get('/alerts', { token: admin })).status, 200, 'admin passes staff checks');
});

test('alerts: appendAlert dedupes open twins and keeps the list bounded', async () => {
  const env = makeEnv();
  const one = await appendAlert(env, { msg: 'Sold in-store: Umbreon VMAX', ch: 'TCGplayer', source: 'square-webhook', sku: 'tcg:12345', qty: 0 });
  const two = await appendAlert(env, { msg: 'Sold in-store: Umbreon VMAX', ch: 'TCGplayer', source: 'square-webhook' });
  assert.equal(two.id, one.id, 'same open message on the same channel is coalesced');
  assert.equal(two.count, 2);
  assert.equal(one.sku, 'tcg:12345');
  assert.equal(one.qty, 0);
  await assert.rejects(() => appendAlert(env, { msg: 'ok message', ch: 'Amazon' }), /ch must be one of/);

  const c = client(env);
  const staff = await c.login('staff');
  const first = await c.get('/alerts', { token: staff });
  assert.equal(first.data.alerts.length, 1);
  await c.post(`/alerts/${one.id}/ack`, undefined, { token: staff });
  for (let i = 0; i < MAX_ALERTS + 5; i++) await appendAlert(env, { msg: `Sold on TCGplayer: card ${i}`, ch: 'Square' });
  const full = await c.get('/alerts', { token: staff });
  assert.equal(full.data.alerts.length, MAX_ALERTS);
  assert.equal(full.data.open, MAX_ALERTS, 'acked alerts are dropped before open ones');
  assert.equal(full.data.alerts[0].msg, `Sold on TCGplayer: card ${MAX_ALERTS + 4}`);
});
