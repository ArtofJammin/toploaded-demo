import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';

const vendor = { name: 'Jane Doe', email: 'Jane@Example.com', tables: 2, game: 'op', phone: '859-555-0101' };

test('forms: vendor submission is stored, cleaned, and listed newest first for staff', async () => {
  const c = client(makeEnv());
  const r = await c.post('/forms/vendor', { ...vendor, name: '<b>Jane</b> Doe<script>x</script>', message: 'Bringing  singles\n\n\n\nand sealed' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.ok(r.data.id);
  assert.equal(r.data.emailed, false, 'no NOTIFY_EMAIL → nothing emailed');

  assert.equal((await c.get('/forms')).status, 401, 'inbox needs a login');
  const staff = await c.login('staff');
  const inbox = await c.get('/forms', { token: staff });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.data.count, 1);
  assert.equal(inbox.data.open, 1);
  const f = inbox.data.forms[0];
  assert.equal(f.id, r.data.id);
  assert.equal(f.kind, 'vendor');
  assert.equal(f.status, 'new');
  assert.equal(f.name, 'Jane Doe x', 'tags stripped');
  assert.equal(f.email, 'jane@example.com', 'email lower-cased');
  assert.equal(f.tables, 2);
  assert.equal(f.message, 'Bringing singles\n\nand sealed', 'whitespace collapsed, blank lines capped');
  assert.equal(f.ip, '1.2.3.4');
  assert.ok(f.at);

  // a second one lands first
  const r2 = await c.post('/forms/contact', { name: 'Sam', email: 's@x.io', message: 'Do you buy Lorcana?' });
  assert.equal(r2.status, 200);
  const all = await c.get('/forms', { token: staff });
  assert.deepEqual(all.data.forms.map(x => x.kind), ['contact', 'vendor']);
  const only = await c.get('/forms?kind=contact', { token: staff });
  assert.equal(only.data.count, 1);
  assert.equal(only.data.forms[0].message, 'Do you buy Lorcana?');
  const lim = await c.get('/forms?limit=1', { token: staff });
  assert.equal(lim.data.forms.length, 1);
  assert.equal(lim.data.open, 2, 'open count ignores the limit');
});

test('forms: every kind validates its fields', async () => {
  const c = client(makeEnv());
  // each rejected POST still counts toward the 5 / 10 min limit, so spread them across addresses
  let n = 0;
  const bad = async (kind, body) => (await c.post('/forms/' + kind, body, { headers: { 'cf-connecting-ip': '10.9.0.' + (++n) } })).status;
  assert.equal(await bad('vendor', { ...vendor, email: 'nope' }), 400);
  assert.equal(await bad('vendor', { ...vendor, tables: 4 }), 400);
  assert.equal(await bad('vendor', { ...vendor, tables: 1.5 }), 400);
  assert.equal(await bad('vendor', { ...vendor, game: '' }), 400);
  assert.equal(await bad('vendor', { ...vendor, phone: '12' }), 400);
  assert.equal(await bad('buylist', { name: 'Al', contact: 'al@x.io', games: ['pk'] }), 400);
  assert.equal(await bad('buylist', { name: 'Al', contact: 'al@x.io', games: [], desc: 'binder' }), 400);
  assert.equal(await bad('signup', { name: 'Al', seats: 5, eventId: 'pk-sun', email: 'al@x.io' }), 400);
  assert.equal(await bad('signup', { name: 'Al', seats: 2, eventId: 'bad id!', email: 'al@x.io' }), 400);
  assert.equal(await bad('signup', { name: 'Al', seats: 2, eventId: 'pk-sun', date: '2026-13-99', email: 'al@x.io' }), 400);
  assert.equal(await bad('signup', { name: 'Al', seats: 2, eventId: 'pk-sun' }), 400, 'a signup needs a way to reach the player');
  assert.equal(await bad('signup', { name: 'Al', seats: 2, eventId: 'pk-sun', contact: '' }), 400);
  assert.equal(await bad('signup', { name: 'Al', seats: 2, eventId: 'pk-sun', email: 'nope' }), 400);
  assert.equal(await bad('signup', { name: 'Al', seats: 2, eventId: 'pk-sun', phone: '12' }), 400);
  assert.equal(await bad('newsletter', { email: 'x' }), 400);
  assert.equal(await bad('restock', { email: 'a@b.co', productId: '', productName: 'ETB' }), 400);
  assert.equal(await bad('contact', { name: 'A', email: 'a@b.co', message: 'hi' }), 400);
  assert.equal(await bad('wishlist', { name: 'A' }), 400, 'unknown kind');
  assert.equal(await bad('contact', { name: 'Ann', email: 'a@b.co', message: 'x'.repeat(2001) }), 400);
  const big = await c.call('POST', '/forms/contact', undefined, { raw: JSON.stringify({ name: 'Ann', email: 'a@b.co', message: 'x'.repeat(20000) }) });
  assert.equal(big.status, 413);

  const ok = async (kind, body) => { const r = await c.post('/forms/' + kind, body); assert.equal(r.status, 200, kind + ' ' + JSON.stringify(r.data)); return r.data; };
  await ok('buylist', { name: 'Al Pine', contact: '(513) 555-0100', games: ['pk', 'mtg'], desc: 'Two binders of holos' });
  await ok('signup', { name: 'Al Pine', seats: '2', eventId: 'pk-sun', date: '2026-09-06', email: 'Al@Example.com' });
  await ok('newsletter', { email: 'al@x.io' });
  await ok('restock', { email: 'al@x.io', productId: '614504', productName: 'Charizard ex' });
  await ok('contact', { name: 'Al Pine', email: 'al@x.io', message: 'Open Labor Day?' });
  const staff = await c.login('staff');
  const inbox = await c.get('/forms', { token: staff });
  assert.equal(inbox.data.count, 5);
  const signup = inbox.data.forms.find(f => f.kind === 'signup');
  assert.equal(signup.seats, 2, 'numeric strings coerce');
  assert.equal(signup.eventName, 'Pokemon League', 'event name resolved from config');
  assert.equal(signup.date, '2026-09-06');
  assert.equal(signup.email, 'al@example.com', 'the email the player typed is stored (lower-cased)');
  assert.equal(signup.contact, 'al@example.com', 'contact is never empty when an email or phone was given');
  assert.equal(signup.phone, '');
  const buy = inbox.data.forms.find(f => f.kind === 'buylist');
  assert.equal(buy.games, 'pk, mtg');
});

test('forms: signup keeps whichever contact the player typed and folds it into contact', async () => {
  const c = client(makeEnv());
  const base = { name: 'Al Pine', seats: 1, eventId: 'pk-sun' };
  let n = 0;
  const ok = async (body) => { const r = await c.post('/forms/signup', body, { headers: { 'cf-connecting-ip': '10.8.0.' + (++n) } }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.id; };
  const byPhone = await ok({ ...base, phone: '(859) 555-0100' });
  const byContactEmail = await ok({ ...base, contact: 'Al@Example.com' });
  const byContactPhone = await ok({ ...base, contact: '513-555-0199' });
  const byContactText = await ok({ ...base, contact: 'DM @alpine on Instagram' });
  const both = await ok({ ...base, contact: 'text me first', email: 'al@x.io', phone: '8595550100' });
  const staff = await c.login('staff');
  const rows = (await c.get('/forms?kind=signup', { token: staff })).data.forms;
  const rec = (id) => rows.find(f => f.id === id);
  assert.deepEqual([rec(byPhone).contact, rec(byPhone).phone, rec(byPhone).email], ['(859) 555-0100', '(859) 555-0100', ''], 'phone only → contact is the phone');
  assert.deepEqual([rec(byContactEmail).contact, rec(byContactEmail).email, rec(byContactEmail).phone], ['Al@Example.com', 'al@example.com', ''], 'an email typed as contact is recognised');
  assert.deepEqual([rec(byContactPhone).contact, rec(byContactPhone).phone, rec(byContactPhone).email], ['513-555-0199', '513-555-0199', ''], 'a phone typed as contact is recognised');
  assert.deepEqual([rec(byContactText).contact, rec(byContactText).email, rec(byContactText).phone], ['DM @alpine on Instagram', '', ''], 'free text stays as contact');
  assert.deepEqual([rec(both).contact, rec(both).email, rec(both).phone], ['text me first', 'al@x.io', '8595550100'], 'all three are kept when all three are sent');
});

test('forms: honeypot returns ok but stores nothing', async () => {
  const c = client(makeEnv());
  const r = await c.post('/forms/newsletter', { email: 'bot@spam.io', website: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  const staff = await c.login('staff');
  const inbox = await c.get('/forms', { token: staff });
  assert.equal(inbox.data.count, 0);
  assert.equal(Object.keys(inbox.data.forms).length, 0);
});

test('forms: status updates, filters, and 404s', async () => {
  const c = client(makeEnv());
  const a = (await c.post('/forms/newsletter', { email: 'a@x.io' })).data.id;
  const b = (await c.post('/forms/newsletter', { email: 'b@x.io' })).data.id;
  assert.equal((await c.put(`/forms/newsletter/${a}`, { status: 'done' })).status, 401);
  const staff = await c.login('staff');
  const up = await c.put(`/forms/newsletter/${a}`, { status: 'done', note: 'Added to <i>Mailchimp</i>' }, { token: staff });
  assert.equal(up.status, 200);
  assert.equal(up.data.form.status, 'done');
  assert.equal(up.data.form.note, 'Added to Mailchimp');
  assert.equal(up.data.form.by, 'staff');
  assert.equal((await c.put(`/forms/newsletter/${a}`, { status: 'lost' }, { token: staff })).status, 400);
  assert.equal((await c.put(`/forms/newsletter/nope`, { status: 'done' }, { token: staff })).status, 404);
  assert.equal((await c.put(`/forms/vendor/${a}`, { status: 'done' }, { token: staff })).status, 404, 'kind must match');
  const fresh = await c.get('/forms?status=new', { token: staff });
  assert.deepEqual(fresh.data.forms.map(f => f.id), [b]);
  assert.equal(fresh.data.open, 1);
  const done = await c.get('/forms?status=done', { token: staff });
  assert.deepEqual(done.data.forms.map(f => f.id), [a]);
  assert.equal((await c.get('/forms?status=weird', { token: staff })).status, 400);
  assert.equal((await c.get('/forms?kind=weird', { token: staff })).status, 400);
});

test('forms: 5 per 10 minutes per IP per kind', async () => {
  const c = client(makeEnv());
  let last;
  for (let i = 0; i < 6; i++) last = await c.post('/forms/newsletter', { email: `n${i}@x.io` });
  assert.equal(last.status, 429);
  assert.equal((await c.post('/forms/contact', { name: 'Ann', email: 'a@b.co', message: 'still fine' })).status, 200, 'other kinds have their own bucket');
  assert.equal((await c.post('/forms/newsletter', { email: 'z@x.io' }, { headers: { 'cf-connecting-ip': '5.6.7.8' } })).status, 200, 'other IPs too');
});

test('forms: emails NOTIFY_EMAIL with a readable subject when Resend is configured', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'em_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const c = client(makeEnv({ NOTIFY_EMAIL: 'owner@toploaded.test', RESEND_API_KEY: 're_test' }));
    const r = await c.post('/forms/vendor', { ...vendor, name: 'Jane' });
    assert.equal(r.status, 200);
    assert.equal(r.data.emailed, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /resend\.com/);
    assert.equal(calls[0].body.subject, '[Top Loaded] Vendor table request from Jane');
    assert.deepEqual(calls[0].body.to, ['owner@toploaded.test']);
    assert.equal(calls[0].body.reply_to, 'jane@example.com');
    assert.match(calls[0].body.text, /Tables: 2/);
    const s = await c.post('/forms/signup', { name: 'Al Pine', seats: 2, eventId: 'pk-sun', phone: '(859) 555-0100' });
    assert.equal(s.data.emailed, true);
    assert.equal(calls[1].body.subject, '[Top Loaded] Pokemon League signup from Al Pine (2 seats)');
    assert.match(calls[1].body.text, /Phone: \(859\) 555-0100/, 'the notification carries the phone the player typed');
    assert.doesNotMatch(calls[1].body.text, /Contact:/, 'no duplicate Contact line when it is just the phone');
    assert.equal(calls[1].body.reply_to, undefined);
    const s2 = await c.post('/forms/signup', { name: 'Bea Lee', seats: 1, eventId: 'pk-sun', email: 'Bea@Example.com' });
    assert.equal(s2.status, 200);
    assert.match(calls[2].body.text, /Email: bea@example\.com/);
    assert.equal(calls[2].body.reply_to, 'bea@example.com', 'the shop can hit reply');
    const s3 = await c.post('/forms/signup', { name: 'Cy Dee', seats: 1, eventId: 'pk-sun', contact: 'DM @cy on IG', email: 'cy@x.io' });
    assert.equal(s3.status, 200);
    assert.match(calls[3].body.text, /Email: cy@x\.io\nContact: DM @cy on IG/, 'a distinct contact note is listed as well');
    const staff = await c.login('staff');
    const inbox = await c.get('/forms?kind=vendor', { token: staff });
    assert.equal(inbox.data.forms[0].emailed, true);
  } finally { globalThis.fetch = realFetch; }

  // NOTIFY_EMAIL without a Resend key: dry run, still stored, emailed:false
  const c2 = client(makeEnv({ NOTIFY_EMAIL: 'owner@toploaded.test' }));
  const r2 = await c2.post('/forms/newsletter', { email: 'dry@x.io' });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.emailed, false);
  const staff2 = await c2.login('staff');
  assert.equal((await c2.get('/forms', { token: staff2 })).data.count, 1);
});
