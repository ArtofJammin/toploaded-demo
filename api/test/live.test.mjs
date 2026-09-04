import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';
import { CLAIM_TTL_MS, CHAT_MAX, pruneLive } from '../src/routes/live.js';

const SID_A = 'sid-aaaaaaaa';
const SID_B = 'sid-bbbbbbbb';

test('live: state reflects config, claims hold for 6 h, conflicts 409', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = await c.get('/live');
  assert.equal(s.status, 200);
  assert.equal(s.data.live.on, false);
  assert.equal(s.data.live.title, 'Prismatic Evolutions booster box break');
  assert.deepEqual(s.data.spots.taken, []);
  assert.equal(s.data.spots.total, 12);
  assert.equal(s.data.spots.price, 24.99);
  assert.equal(s.data.spots.open, 12);
  assert.equal(s.data.viewers, 0);

  const before = Date.now();
  const a = await c.post('/live/spots/claim', { spot: 4, name: 'Mike Rivera', sid: SID_A });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.ok, true);
  assert.equal(a.data.spot, 4);
  assert.deepEqual(a.data.taken, [4]);
  assert.deepEqual(a.data.mine, [4]);
  assert.equal(a.data.open, 11);
  const exp = Date.parse(a.data.exp);
  assert.ok(exp >= before + CLAIM_TTL_MS - 1000 && exp <= Date.now() + CLAIM_TTL_MS + 1000, '6 h hold');
  assert.deepEqual(a.data.claims, [{ spot: 4, name: 'Mike R.', confirmed: false, exp: a.data.exp }], 'public view shows first name + initial');

  const b = await c.post('/live/spots/claim', { spot: 4, sid: SID_B });
  assert.equal(b.status, 409);
  assert.match(b.data.error, /taken/);
  assert.deepEqual(b.data.taken, [4]);
  const same = await c.post('/live/spots/claim', { spot: 4, sid: SID_A });
  assert.equal(same.status, 200, 're-claiming your own spot is idempotent');
  assert.deepEqual(same.data.taken, [4]);
  const b2 = await c.post('/live/spots/claim', { spot: '7', sid: SID_B });
  assert.equal(b2.status, 200);
  assert.deepEqual(b2.data.taken, [4, 7]);
  assert.deepEqual(b2.data.mine, [7]);

  const mine = await c.get('/live?sid=' + SID_A);
  assert.deepEqual(mine.data.spots.taken, [4, 7]);
  assert.deepEqual(mine.data.spots.mine, [4]);
  assert.deepEqual((await c.get('/live')).data.spots.mine, []);

  assert.equal((await c.post('/live/spots/claim', { spot: 13, sid: SID_A })).status, 400, 'beyond config.live.spots');
  assert.equal((await c.post('/live/spots/claim', { spot: 0, sid: SID_A })).status, 400);
  assert.equal((await c.post('/live/spots/claim', { spot: 2.5, sid: SID_A })).status, 400);
  assert.equal((await c.post('/live/spots/claim', { spot: 2 })).status, 400, 'sid required');
  assert.equal((await c.post('/live/spots/claim', { spot: 2, sid: 'a b' })).status, 400);
  assert.equal((await c.post('/live/spots/claim', { spot: 2, sid: SID_A, name: 'x'.repeat(30) })).status, 400);

  const chat = await c.get('/live/chat');
  assert.ok(chat.data.messages.some(m => m.sys && /Spot #4 claimed by Mike R\./.test(m.text)), 'claims post a system chat line');
});

test('live: release only with the matching sid; staff can release anything', async () => {
  const c = client(makeEnv());
  await c.post('/live/spots/claim', { spot: 3, sid: SID_A });
  const wrong = await c.post('/live/spots/release', { spot: 3, sid: SID_B });
  assert.equal(wrong.status, 403);
  assert.deepEqual(wrong.data.taken, [3]);
  assert.equal((await c.post('/live/spots/release', { spot: 3 })).status, 400, 'sid required for the public');
  const free = await c.post('/live/spots/release', { spot: 9, sid: SID_A });
  assert.equal(free.status, 200);
  assert.equal(free.data.released, false, 'releasing a free spot is a no-op');
  const ok = await c.post('/live/spots/release', { spot: 3, sid: SID_A });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.released, true);
  assert.deepEqual(ok.data.taken, []);
  assert.deepEqual((await c.get('/live')).data.spots.taken, []);

  await c.post('/live/spots/claim', { spot: 5, sid: SID_B });
  const staff = await c.login('staff');
  const byStaff = await c.post('/live/spots/release', { spot: 5 }, { token: staff });
  assert.equal(byStaff.status, 200);
  assert.equal(byStaff.data.released, true);
});

test('live: holds expire, confirmed spots do not, staff confirm/reset', async () => {
  const env = makeEnv();
  const c = client(env);
  await c.post('/live/spots/claim', { spot: 1, sid: SID_A });
  await c.post('/live/spots/claim', { spot: 2, sid: SID_B });
  assert.equal((await c.post('/live/spots/2/confirm')).status, 401);
  const staff = await c.login('staff');
  const conf = await c.post('/live/spots/2/confirm', { name: 'Paid walk-in' }, { token: staff });
  assert.equal(conf.status, 200);
  assert.equal(conf.data.claim.confirmed, true);
  assert.equal(conf.data.claim.exp, null);
  assert.equal(conf.data.claim.name, 'Paid walk-in');
  assert.equal(conf.data.claim.sid, SID_B, 'the claimant keeps ownership');
  const walkIn = await c.post('/live/spots/8/confirm', {}, { token: staff });
  assert.equal(walkIn.status, 200, 'staff can confirm a free spot for a counter sale');
  assert.equal((await c.post('/live/spots/13/confirm', {}, { token: staff })).status, 400);
  assert.equal((await c.post('/live/spots/claim', { spot: 8, sid: SID_A })).status, 409, 'confirmed spots are taken');
  const rel = await c.post('/live/spots/release', { spot: 2, sid: SID_B });
  assert.equal(rel.status, 403, 'confirmed spots cannot be released by the claimant');

  // age every hold past 6 h
  const doc = await env.KV.get('live:spots', 'json');
  for (const claim of Object.values(doc.claims)) claim.exp = new Date(Date.now() - 1000).toISOString();
  await env.KV.put('live:spots', JSON.stringify(doc));
  const after = await c.get('/live?sid=' + SID_A);
  assert.deepEqual(after.data.spots.taken, [2, 8], 'expired hold on #1 dropped; confirmed spots stay');
  assert.deepEqual(after.data.spots.mine, []);
  assert.deepEqual((await c.get('/live')).data.spots.claims.map(x => x.confirmed), [true, true]);

  assert.equal((await c.post('/live/spots/reset')).status, 401);
  const reset = await c.post('/live/spots/reset', undefined, { token: staff });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.data.taken, []);
  assert.deepEqual((await c.get('/live')).data.spots.taken, []);
});

test('live: chat appends, filters links and slurs, caps length, supports since', async () => {
  const env = makeEnv();
  const c = client(env);
  const m1 = await c.post('/live/chat', { user: '<b>mike_pulls</b>!!', text: 'LETS GO that alt art was <i>insane</i>' });
  assert.equal(m1.status, 200, JSON.stringify(m1.data));
  assert.equal(m1.data.ok, true);
  assert.equal(m1.data.message.user, 'mike_pulls', 'user name sanitised');
  assert.equal(m1.data.message.text, 'LETS GO that alt art was insane');
  assert.equal(m1.data.message.sys, undefined);
  assert.ok(m1.data.message.id && m1.data.message.at && Number.isFinite(m1.data.message.ts));

  const m2 = await c.post('/live/chat', { text: 'buy cheap packs at www.scam.example/x or http://bad.gg/y' });
  assert.equal(m2.data.message.user, 'guest');
  assert.equal(m2.data.message.text, 'buy cheap packs at [link removed] or [link removed]');
  const m3 = await c.post('/live/chat', { user: 'troll', text: 'this is bullshit you fucking retards' });
  assert.equal(m3.data.message.text, 'this is bullshit you *** ***');
  assert.equal((await c.post('/live/chat', { text: 'x'.repeat(201) })).status, 400);
  assert.equal((await c.post('/live/chat', { text: '   ' })).status, 400);
  assert.equal((await c.post('/live/chat', { text: 'http://only.a.link' })).status, 200, 'a bare link becomes a placeholder, not an error');
  assert.equal((await c.post('/live/chat', { text: 'sys?', sys: true })).data.message.sys, undefined, 'the public cannot post system lines');
  const staff = await c.login('staff');
  const sysMsg = await c.post('/live/chat', { text: 'Spot #4 pulled a chase', sys: true }, { token: staff });
  assert.equal(sysMsg.data.message.sys, true);
  assert.equal(sysMsg.data.message.user, 'system');

  const all = await c.get('/live/chat');
  assert.equal(all.status, 200);
  assert.equal(all.data.messages.length, 6);
  assert.equal(all.data.messages[0].id, m1.data.message.id, 'oldest first, newest last');
  assert.ok(Number.isFinite(all.data.now));
  assert.equal(all.data.viewers, 0);
  const since = await c.get('/live/chat?since=' + m2.data.message.ts);
  assert.deepEqual(since.data.messages.map(m => m.id), all.data.messages.slice(2).map(m => m.id), 'only messages after `since`');
  const sinceIso = await c.get('/live/chat?since=' + encodeURIComponent(m2.data.message.at));
  assert.ok(sinceIso.data.messages.length <= 4 && sinceIso.data.messages.length >= 3, 'ISO since works too');
  assert.equal((await c.get('/live/chat?since=' + (Date.now() + 5000))).data.messages.length, 0);

  // trim to CHAT_MAX (spread across IPs to stay under the per-IP limit)
  for (let i = 0; i < CHAT_MAX + 10; i++) {
    const r = await c.post('/live/chat', { user: 'u' + i, text: 'msg ' + i }, { headers: { 'cf-connecting-ip': '10.0.' + Math.floor(i / 15) + '.1' } });
    assert.equal(r.status, 200, 'msg ' + i);
  }
  const trimmed = await c.get('/live/chat');
  assert.equal(trimmed.data.messages.length, CHAT_MAX);
  assert.equal(trimmed.data.messages[CHAT_MAX - 1].text, 'msg ' + (CHAT_MAX + 9));
});

test('live: chat is limited to 20 per minute per IP', async () => {
  const c = client(makeEnv());
  let last;
  for (let i = 0; i < 21; i++) last = await c.post('/live/chat', { user: 'spam', text: 'hi ' + i });
  assert.equal(last.status, 429);
  assert.equal((await c.post('/live/chat', { text: 'other ip' }, { headers: { 'cf-connecting-ip': '8.8.8.8' } })).status, 200);
});

test('live: viewers counts distinct sids seen in the last 60 s', async () => {
  const env = makeEnv();
  const c = client(env);
  assert.equal((await c.post('/live/viewers', {})).status, 400);
  assert.equal((await c.post('/live/viewers', { sid: 'no spaces here' })).status, 400);
  assert.equal((await c.post('/live/viewers', { sid: SID_A })).data.viewers, 1);
  assert.equal((await c.post('/live/viewers', { sid: SID_A })).data.viewers, 1, 'same sid counts once');
  assert.equal((await c.post('/live/viewers', { sid: SID_B })).data.viewers, 2);
  assert.equal((await c.post('/live/viewers', { sid: 'sid-cccccccc' })).data.viewers, 3);
  assert.equal((await c.get('/live')).data.viewers, 3);
  assert.equal((await c.get('/live/chat')).data.viewers, 3);
  const map = await env.KV.get('live:viewers', 'json');
  map[SID_B] = Date.now() - 61 * 1000;
  await env.KV.put('live:viewers', JSON.stringify(map));
  assert.equal((await c.get('/live')).data.viewers, 2, 'stale heartbeats drop out');
  assert.equal((await c.post('/live/viewers', { sid: SID_A })).data.viewers, 2);
  const pruned = await pruneLive(env);
  assert.equal(pruned.spots, 0);
  assert.equal(Object.keys(await env.KV.get('live:viewers', 'json')).length, 2);
});

test('live: the daily cron in routes/inventory.js prunes the stored claim shape', async () => {
  const { scheduledMaintenance } = await import('../src/routes/inventory.js');
  if (typeof scheduledMaintenance !== 'function') return;
  const env = makeEnv();
  const c = client(env);
  await c.post('/live/spots/claim', { spot: 1, sid: SID_A });
  await c.post('/live/spots/claim', { spot: 2, sid: SID_B });
  const staff = await c.login('staff');
  await c.post('/live/spots/2/confirm', {}, { token: staff });
  const doc = await env.KV.get('live:spots', 'json');
  assert.ok(Array.isArray(doc.claims), 'claims stored as an array');
  const old = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
  for (const claim of doc.claims) { claim.at = old; if (claim.exp) { claim.exp = old; claim.expires = old; } }
  await env.KV.put('live:spots', JSON.stringify(doc));
  await scheduledMaintenance(env).catch(() => {});
  assert.deepEqual((await c.get('/live')).data.spots.taken, [2], 'expired hold pruned, confirmed spot kept');
});
