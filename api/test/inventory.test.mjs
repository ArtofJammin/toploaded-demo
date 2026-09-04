import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';
import { scheduledMaintenance } from '../src/routes/inventory.js';

const SUMMARY = { generated: '2026-09-04T04:23:03-0400', products: 6003, listings: 7000, units: 49567, games: { pk: 1, op: 2 }, top: [], wall: [] };

function stubFetch({ summary = SUMMARY, summaryStatus = 200, github } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith('inventory-summary.json')) {
      if (summaryStatus === 'throw') throw new TypeError('fetch failed');
      return new Response(summaryStatus === 200 ? JSON.stringify(summary) : 'x', { status: summaryStatus });
    }
    if (u.startsWith('https://api.github.com/')) {
      if (!github) throw new Error('unexpected GitHub call');
      return github(u, init);
    }
    throw new Error('unexpected fetch ' + u);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test('GET /inventory/status reads the site summary, caches it 5 min, merges lastRun and integrations', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const r = await c.get('/inventory/status');
    assert.equal(r.status, 200);
    assert.equal(r.data.generated, SUMMARY.generated);
    assert.equal(r.data.products, 6003);
    assert.equal(r.data.units, 49567);
    assert.equal(r.data.listings, 7000);
    assert.equal(r.data.cached, false);
    assert.equal(r.data.syncing, false);
    assert.equal(r.data.lastRun.at, null);
    assert.equal(r.data.square.configured, false);
    assert.equal(r.data.github.configured, false);
    assert.deepEqual(r.data.hooks, {});
    assert.equal(s.calls[0].url, 'https://artofjammin.github.io/toploaded-demo/inventory-summary.json');
    const again = await c.get('/inventory/status');
    assert.equal(again.data.cached, true);
    assert.equal(s.calls.length, 1, 'second call served from KV');
    assert.ok(env.KV.exp.get('inventory:status') <= Date.now() + 5 * 60 * 1000 + 50);
    await env.KV.put('inventory:lastRun', JSON.stringify({ at: new Date().toISOString(), ok: true, message: 'sync requested', dispatched: true }));
    await env.KV.put('square:hooks:last', JSON.stringify({ 'payment.updated': { at: 'x', ok: true } }));
    const syncing = await c.get('/inventory/status');
    assert.equal(syncing.data.syncing, true, 'dispatched in the last 10 min and no newer summary');
    assert.equal(syncing.data.hooks['payment.updated'].ok, true);
  } finally { s.restore(); }
});

test('GET /inventory/status tolerates an unreachable site (stale cache or zeros)', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch({ summaryStatus: 'throw' });
  try {
    const r = await c.get('/inventory/status');
    assert.equal(r.status, 200);
    assert.equal(r.data.generated, null);
    assert.equal(r.data.unreachable, true);
    await env.KV.put('inventory:status', JSON.stringify({ generated: 'old', products: 1, listings: 1, units: 1, fetchedAt: 'x' }));
    await env.KV.delete('inventory:status');
  } finally { s.restore(); }
});

test('POST /inventory/sync: admin only, honest without a token, dispatches the workflow, 10 min cooldown', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch({ github: (u, init) => {
    assert.equal(u, 'https://api.github.com/repos/ArtofJammin/toploaded-demo/actions/workflows/inventory.yml/dispatches');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, 'Bearer ghp_test');
    assert.equal(init.headers.accept, 'application/vnd.github+json');
    assert.ok(init.headers['user-agent']);
    assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
    return new Response(null, { status: 204 });
  } });
  try {
    assert.equal((await c.post('/inventory/sync', {})).status, 401);
    const staff = await c.login('staff');
    assert.equal((await c.post('/inventory/sync', {}, { token: staff })).status, 403);
    const admin = await c.login('admin');
    const none = await c.post('/inventory/sync', {}, { token: admin });
    assert.equal(none.status, 200);
    assert.deepEqual({ ok: none.data.ok, dispatched: none.data.dispatched, reason: none.data.reason }, { ok: false, dispatched: false, reason: 'GITHUB_TOKEN not set' });
    assert.equal(s.calls.length, 0);

    env.GITHUB_TOKEN = 'ghp_test';
    env.GITHUB_REPO = 'ArtofJammin/toploaded-demo';
    env.GITHUB_WORKFLOW = 'inventory.yml';
    await env.KV.put('inventory:status', JSON.stringify({ generated: 'old', fetchedAt: 'x' }));
    const ok = await c.post('/inventory/sync', {}, { token: admin });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.ok, true);
    assert.equal(ok.data.dispatched, true);
    assert.match(ok.data.runsUrl, /actions\/workflows\/inventory\.yml$/);
    const last = await env.KV.get('inventory:lastRun', 'json');
    assert.equal(last.ok, true);
    assert.equal(last.dispatched, true);
    assert.equal(await env.KV.get('inventory:status'), null, 'status cache invalidated');
    const twice = await c.post('/inventory/sync', {}, { token: admin });
    assert.equal(twice.status, 429);
    assert.equal(twice.data.ok, false);
    assert.equal(s.calls.filter(x => x.url.includes('github')).length, 1);
  } finally { s.restore(); }
});

test('POST /inventory/sync maps GitHub errors to 502 and records the failure', async () => {
  const env = makeEnv({ GITHUB_TOKEN: 'bad' });
  const c = client(env);
  const s = stubFetch({ github: () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }) });
  try {
    const admin = await c.login('admin');
    const r = await c.post('/inventory/sync', {}, { token: admin });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /GitHub 401: Bad credentials/);
    const last = await env.KV.get('inventory:lastRun', 'json');
    assert.equal(last.ok, false);
    assert.equal(last.dispatched, false);
    const retry = await c.post('/inventory/sync', {}, { token: admin });
    assert.equal(retry.status, 502, 'a failed dispatch does not start the cooldown');
  } finally { s.restore(); }
});

test('scheduledMaintenance prunes expired spot claims, trims chat to 60, refreshes the status cache', async () => {
  const env = makeEnv();
  const now = Date.now();
  const old = new Date(now - 7 * 3600 * 1000).toISOString();
  const fresh = new Date(now - 60 * 1000).toISOString();
  await env.KV.put('live:spots', JSON.stringify([
    { spot: 1, name: 'old', at: old },
    { spot: 2, name: 'kept', at: old, confirmed: true },
    { spot: 3, name: 'new', at: fresh },
    { spot: 4, name: 'explicit', expires: new Date(now - 1000).toISOString() },
  ]));
  await env.KV.put('live:chat', JSON.stringify(Array.from({ length: 75 }, (_, i) => ({ id: i, text: 'm' + i }))));
  await env.KV.put('inventory:status', JSON.stringify({ generated: 'stale', fetchedAt: 'x' }));
  const s = stubFetch();
  try {
    const report = await scheduledMaintenance(env);
    assert.equal(report.spotsPruned, 2);
    assert.deepEqual((await env.KV.get('live:spots', 'json')).map(c => c.spot), [2, 3]);
    const chat = await env.KV.get('live:chat', 'json');
    assert.equal(chat.length, 60);
    assert.equal(chat[59].id, 74, 'newest (last) messages kept');
    assert.equal(report.chatTrimmed, 15);
    assert.equal(report.statusRefreshed, true);
    assert.equal((await env.KV.get('inventory:status', 'json')).generated, SUMMARY.generated);
    // object-shaped spots (map by number) are handled too
    await env.KV.put('live:spots', JSON.stringify({ 5: { name: 'x', at: old }, 6: { name: 'y', at: fresh } }));
    const r2 = await scheduledMaintenance(env);
    assert.equal(r2.spotsPruned, 1);
    assert.deepEqual(Object.keys(await env.KV.get('live:spots', 'json')), ['6']);
  } finally { s.restore(); }
});

test('scheduledMaintenance never throws when the site is down or KV is empty', async () => {
  const env = makeEnv();
  const s = stubFetch({ summaryStatus: 'throw' });
  try {
    const report = await scheduledMaintenance(env);
    assert.equal(report.spotsPruned, 0);
    assert.equal(report.statusRefreshed, false);
  } finally { s.restore(); }
});
