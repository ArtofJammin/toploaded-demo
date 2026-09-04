import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';

async function setup() {
  const env = makeEnv();
  const c = client(env);
  const staff = await c.login('staff');
  const admin = await c.login('admin');
  return { env, c, staff, admin };
}

test('credit: staff only for everything but the public lookup', async () => {
  const { c } = await setup();
  assert.equal((await c.get('/credit?q=al')).status, 401);
  assert.equal((await c.post('/credit', { name: 'Alex Rivera', phone: '8595550142' })).status, 401);
  assert.equal((await c.get('/credit/abc')).status, 401);
  assert.equal((await c.post('/credit/abc/add', { cash: 10 })).status, 401);
  assert.equal((await c.get('/credit/lookup?phone=8595550142')).status, 200, 'lookup is public');
});

test('credit: create customers, normalize phones, reject duplicates, search', async () => {
  const { c, staff } = await setup();
  const a = await c.post('/credit', { name: ' <b>Alex</b> Rivera ', phone: '+1 (859) 555-0142', email: 'Alex@Example.com' }, { token: staff });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.ok, true);
  const alex = a.data.customer;
  assert.equal(alex.name, 'Alex Rivera');
  assert.equal(alex.phone, '8595550142', 'digits only, country code dropped');
  assert.equal(alex.phoneDisplay, '(859) 555-0142');
  assert.equal(alex.email, 'alex@example.com');
  assert.equal(alex.balance, 0);
  assert.ok(alex.id && alex.createdAt);

  const dupe = await c.post('/credit', { name: 'Alexander R', phone: '859.555.0142' }, { token: staff });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.data.id, alex.id, 'conflict names the existing customer');
  assert.equal((await c.post('/credit', { name: 'A', phone: '8595550199' }, { token: staff })).status, 400);
  assert.equal((await c.post('/credit', { name: 'Ann Lee', phone: '12345' }, { token: staff })).status, 400);
  assert.equal((await c.post('/credit', { name: 'Ann Lee', phone: '8595550199', email: 'nope' }, { token: staff })).status, 400);

  const d = await c.post('/credit', { name: 'Dana Kim', phone: '(513) 555-0177' }, { token: staff });
  assert.equal(d.status, 200);
  const byName = await c.get('/credit?q=dan', { token: staff });
  assert.deepEqual(byName.data.customers.map(x => x.name), ['Dana Kim']);
  const byLast4 = await c.get('/credit?q=0142', { token: staff });
  assert.deepEqual(byLast4.data.customers.map(x => x.name), ['Alex Rivera']);
  const byFormatted = await c.get('/credit?q=' + encodeURIComponent('(513) 555'), { token: staff });
  assert.deepEqual(byFormatted.data.customers.map(x => x.name), ['Dana Kim']);
  const all = await c.get('/credit', { token: staff });
  assert.equal(all.data.customers.length, 2);
  assert.ok('balance' in all.data.customers[0] && 'updatedAt' in all.data.customers[0]);
  assert.equal(all.data.customers[0].phoneDisplay, '(513) 555-0177');
  assert.equal((await c.get('/credit?q=zzz', { token: staff })).data.customers.length, 0);
});

test('credit: trades add the config bonus, redeems cannot overdraw, ledger is newest first', async () => {
  const { c, staff, admin } = await setup();
  const alex = (await c.post('/credit', { name: 'Alex Rivera', phone: '8595550142' }, { token: staff })).data.customer;
  const t = await c.post(`/credit/${alex.id}/add`, { cash: 50, note: 'Binder of <i>holos</i>' }, { token: staff });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(t.data.bonus, 0.1);
  assert.equal(t.data.customer.balance, 55);
  assert.equal(t.data.entry.kind, 'trade');
  assert.equal(t.data.entry.cash, 50);
  assert.equal(t.data.entry.credited, 55);
  assert.equal(t.data.entry.balanceAfter, 55);
  assert.equal(t.data.entry.note, 'Binder of holos');
  assert.equal(t.data.entry.by, 'staff');
  assert.ok(t.data.entry.id && t.data.entry.at);

  assert.equal((await c.post(`/credit/${alex.id}/add`, { cash: 0 }, { token: staff })).status, 400);
  assert.equal((await c.post(`/credit/${alex.id}/add`, { cash: 'lots' }, { token: staff })).status, 400);
  assert.equal((await c.post(`/credit/${alex.id}/add`, { cash: 20000 }, { token: staff })).status, 400);
  assert.equal((await c.post(`/credit/nope/add`, { cash: 5 }, { token: staff })).status, 404);

  // bonus follows config
  assert.equal((await c.put('/config', { buy: { creditBonus: 0.2 } }, { token: admin })).status, 200);
  const t2 = await c.post(`/credit/${alex.id}/add`, { cash: 10.10 }, { token: staff });
  assert.equal(t2.data.bonus, 0.2);
  assert.equal(t2.data.entry.credited, 12.12);
  assert.equal(t2.data.customer.balance, 67.12);

  const over = await c.post(`/credit/${alex.id}/add`, { redeem: true, amount: 70 }, { token: staff });
  assert.equal(over.status, 409);
  assert.equal(over.data.balance, 67.12);
  assert.equal((await c.get(`/credit/${alex.id}`, { token: staff })).data.customer.balance, 67.12, 'balance untouched');
  const red = await c.post(`/credit/${alex.id}/add`, { redeem: true, amount: 17.12, note: 'ETB' }, { token: staff });
  assert.equal(red.status, 200);
  assert.equal(red.data.entry.kind, 'redeem');
  assert.equal(red.data.entry.credited, -17.12);
  assert.equal(red.data.customer.balance, 50);
  assert.equal((await c.post(`/credit/${alex.id}/add`, { redeem: true, amount: -5 }, { token: staff })).status, 400);

  // adjustments are admin-only and need a note
  assert.equal((await c.post(`/credit/${alex.id}/add`, { adjust: true, amount: 5, note: 'fix' }, { token: staff })).status, 403);
  assert.equal((await c.post(`/credit/${alex.id}/add`, { adjust: true, amount: 5 }, { token: admin })).status, 400);
  assert.equal((await c.post(`/credit/${alex.id}/add`, { adjust: true, amount: -60, note: 'typo' }, { token: admin })).status, 409);
  const adj = await c.post(`/credit/${alex.id}/add`, { adjust: true, amount: -10, note: 'typo on the trade' }, { token: admin });
  assert.equal(adj.status, 200);
  assert.equal(adj.data.entry.kind, 'adjust');
  assert.equal(adj.data.entry.by, 'admin');
  assert.equal(adj.data.customer.balance, 40);

  const detail = await c.get(`/credit/${alex.id}`, { token: staff });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.customer.balance, 40);
  assert.deepEqual(detail.data.entries.map(e => e.kind), ['adjust', 'redeem', 'trade', 'trade'], 'newest first');
  assert.deepEqual(detail.data.entries.map(e => e.balanceAfter), [40, 50, 67.12, 55]);
  assert.equal((await c.get('/credit/nope', { token: staff })).status, 404);
  const search = await c.get('/credit?q=alex', { token: staff });
  assert.equal(search.data.customers[0].balance, 40, 'index balance stays in sync');
});

test('credit: public lookup masks the name, matches the exact phone, and is rate limited', async () => {
  const { c, staff } = await setup();
  const alex = (await c.post('/credit', { name: 'alex rivera', phone: '8595550142' }, { token: staff })).data.customer;
  await c.post(`/credit/${alex.id}/add`, { cash: 20 }, { token: staff });
  const hit = await c.get('/credit/lookup?phone=' + encodeURIComponent('(859) 555-0142'));
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.data, { found: true, balance: 22, name: 'A••• R.' });
  assert.equal(JSON.stringify(hit.data).includes(alex.id), false, 'no id leaks');
  const miss = await c.get('/credit/lookup?phone=8595550143');
  assert.deepEqual(miss.data, { found: false });
  const partial = await c.get('/credit/lookup?phone=5550142');
  assert.deepEqual(partial.data, { found: false }, 'exact match only');
  assert.equal((await c.get('/credit/lookup?phone=12')).status, 400);
  assert.equal((await c.get('/credit/lookup')).status, 400);
  let last;
  for (let i = 0; i < 7; i++) last = await c.get('/credit/lookup?phone=8595550142');
  assert.equal(last.status, 429, '10 per 10 min per IP');
  assert.equal((await c.get('/credit/lookup?phone=8595550142', { headers: { 'cf-connecting-ip': '9.9.9.9' } })).status, 200);
});
