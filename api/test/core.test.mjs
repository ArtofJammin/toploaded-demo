import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';

test('health reports integrations without leaking secrets', async () => {
  const c = client(makeEnv());
  const r = await c.get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.integrations.auth, true);
  assert.equal(r.data.integrations.square, false);
  assert.equal(JSON.stringify(r.data).includes('test-secret'), false);
});

test('CORS only for allowed origins', async () => {
  const c = client(makeEnv());
  const ok = await c.get('/health');
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://artofjammin.github.io');
  const bad = await c.get('/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await c.call('OPTIONS', '/config');
  assert.equal(pre.status, 204);
});

test('login issues role tokens and rejects wrong pins', async () => {
  const c = client(makeEnv());
  const admin = await c.post('/auth/login', { pin: 'admin' });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.role, 'admin');
  const staff = await c.post('/auth/login', { pin: 'staff' });
  assert.equal(staff.data.role, 'staff');
  const bad = await c.post('/auth/login', { pin: 'nope' });
  assert.equal(bad.status, 401);
  const me = await c.get('/auth/me', { token: admin.data.token });
  assert.equal(me.data.role, 'admin');
  const tampered = await c.get('/auth/me', { token: admin.data.token.slice(0, -2) + 'xx' });
  assert.equal(tampered.status, 401);
});

test('login is rate limited', async () => {
  const c = client(makeEnv());
  let last;
  for (let i = 0; i < 9; i++) last = await c.post('/auth/login', { pin: 'wrong' });
  assert.equal(last.status, 429);
});

test('config merges defaults, admin-only writes, rejects unknown keys', async () => {
  const c = client(makeEnv());
  const pub = await c.get('/config');
  assert.equal(pub.status, 200);
  assert.equal(pub.data.title, 'Top Loaded');
  assert.equal(pub.data.hours.mon, null);
  const staff = await c.login('staff');
  assert.equal((await c.put('/config', { banner: { on: true } }, { token: staff })).status, 403);
  assert.equal((await c.put('/config', { banner: { on: true } })).status, 401);
  const admin = await c.login('admin');
  const w = await c.put('/config', { banner: { on: true, text: 'Restock Friday' } }, { token: admin });
  assert.equal(w.status, 200);
  assert.deepEqual(w.data.banner, { on: true, text: 'Restock Friday' });
  assert.equal(w.data.hours.tue[0], '11:00', 'defaults survive a partial patch');
  assert.equal((await c.put('/config', { nope: 1 }, { token: admin })).status, 400);
  assert.equal((await c.put('/config', { logo: 'javascript:alert(1)' }, { token: admin })).status, 400);
  const again = await c.get('/config');
  assert.equal(again.data.banner.text, 'Restock Friday');
  assert.ok(again.data.updatedAt);
  assert.equal((await c.del('/config', { token: admin })).status, 200);
  assert.equal((await c.get('/config')).data.banner.on, false);
});

test('unknown routes 404, wrong method 405, bad JSON 400', async () => {
  const c = client(makeEnv());
  assert.equal((await c.get('/nope')).status, 404);
  assert.equal((await c.del('/health')).status, 405);
  const admin = await c.login('admin');
  assert.equal((await c.call('PUT', '/config', undefined, { token: admin, raw: '{bad' })).status, 400);
});
