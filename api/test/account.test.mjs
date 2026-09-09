import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, sha } from './helpers.mjs';

function setup(t) {
  const env = makeEnv({ RESEND_API_KEY:'test-only', EMAIL_FROM:'Shop <test@example.com>' });
  const c = client(env), mail = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    mail.push(JSON.parse(options.body));
    return Response.json({ id:'mock-mail' });
  });
  async function request(email='alex@example.com') {
    const r = await c.post('/account/code', { email });
    assert.equal(r.status, 200);
    assert.equal('code' in r.data, false);
    const code = mail.at(-1).text.match(/\b[a-f0-9]{32}\b/)[0];
    return { challenge:r.data.challenge, code };
  }
  async function login(email) { return (await c.post('/account/verify', await request(email))).data.token; }
  return {env,c,mail,request,login};
}

test('account: requires configured email service, never fakes authentication', async () => {
  const c = client(makeEnv());
  assert.equal((await c.get('/account/status')).data.enabled, false);
  assert.equal((await c.post('/account/code',{email:'a@example.com'})).status,503);
  assert.equal((await c.get('/account/me')).status,401);
});
test('account: sign-in, private read-only credit, staff isolation and logout', async t => {
  const {c,env,login} = setup(t), staff = await c.login('staff');
  const customer = (await c.post('/credit',{name:'Alex Rivera',phone:'8595550142',email:'alex@example.com'},{token:staff})).data.customer;
  await c.post('/credit/'+customer.id+'/add',{cash:50,note:'Private staff note'},{token:staff});
  const token = await login('ALEX@example.com'), me = await c.get('/account/me?customerId=somebody-else',{token});
  assert.equal(me.status,200); assert.equal(me.data.customer.balance,55);
  assert.equal(me.data.email,'alex@example.com'); assert.equal(me.data.entries[0].amount,55);
  assert.equal(JSON.stringify(me.data).includes('Private staff note'),false);
  assert.equal(JSON.stringify(me.data).includes('8595550142'),false);
  assert.match(me.headers.get('cache-control'),/no-store/);
  for (const path of ['/credit','/forms','/checkout/orders']) assert.equal((await c.get(path,{token})).status,401);
  assert.equal((await c.post('/credit/'+customer.id+'/add',{cash:100},{token})).status,401);
  assert.equal((await c.get('/account/me',{token:staff})).status,401);
  const session = await env.KV.get('account:session:'+sha(token),'json'); assert.ok(session.exp);
  assert.equal((await c.post('/account/logout',{}, {token})).status,200);
  assert.equal((await c.get('/account/me',{token})).status,401);
});
test('account: codes are hashed, expire, and cannot be reused', async t => {
  const {c,env,request} = setup(t), body = await request();
  const key = 'account:code:'+body.challenge, stored = await env.KV.get(key,'json');
  assert.equal(stored.hash,sha(body.code)); assert.equal(JSON.stringify(stored).includes(body.code),false);
  assert.equal((await c.post('/account/verify',body)).status,200);
  assert.equal((await c.post('/account/verify',body)).status,401);
  const expired = await request(), expiredKey = 'account:code:'+expired.challenge;
  await env.KV.put(expiredKey,JSON.stringify({...await env.KV.get(expiredKey,'json'),exp:Date.now()-1}));
  assert.equal((await c.post('/account/verify',expired)).status,401);
});
test('account: wrong-code limit and malformed inputs fail closed', async t => {
  const {c,request} = setup(t), body = await request();
  for(let i=0;i<5;i++) assert.equal((await c.post('/account/verify',{...body,code:'wrong'})).status,401);
  assert.equal((await c.post('/account/verify',body)).status,401);
  assert.equal((await c.post('/account/code',{email:'invalid'})).status,400);
  assert.equal((await c.post('/account/verify',null,{raw:'null'})).status,400);
  assert.equal((await c.get('/account/me',{token:'a'.repeat(64)})).status,401);
});
test('account: unknown and ambiguous emails never receive another balance', async t => {
  const {c,login} = setup(t), staff = await c.login('staff');
  await c.post('/credit',{name:'Alex',phone:'8595550142',email:'shared@example.com'},{token:staff});
  await c.post('/credit',{name:'Dana',phone:'8595550143',email:'shared@example.com'},{token:staff});
  const unlinked = await c.get('/account/me',{token:await login('new@example.com')});
  assert.equal(unlinked.data.linked,false); assert.equal('customer' in unlinked.data,false);
  const ambiguous = await c.get('/account/me',{token:await login('shared@example.com')});
  assert.equal(ambiguous.data.needsReview,true); assert.equal('customer' in ambiguous.data,false);
});
test('account: email linking requires admin confirmation and duplicate check', async t => {
  const {c,login} = setup(t), staff=await c.login('staff'), admin=await c.login('admin');
  const a=(await c.post('/credit',{name:'Alex',phone:'8595550142'},{token:staff})).data.customer;
  const b=(await c.post('/credit',{name:'Dana',phone:'8595550143',email:'dana@example.com'},{token:staff})).data.customer;
  const path='/credit/'+a.id+'/email';
  assert.equal((await c.put(path,{email:'alex@example.com',confirmed:true},{token:staff})).status,403);
  assert.equal((await c.put(path,{email:'alex@example.com'},{token:admin})).status,400);
  assert.equal((await c.put(path,{email:'dana@example.com',confirmed:true},{token:admin})).status,409);
  const token=await login('alex@example.com');
  assert.equal((await c.get('/account/me',{token})).data.linked,false);
  assert.equal((await c.put(path,{email:'alex@example.com',confirmed:true},{token:admin})).status,200);
  assert.equal((await c.get('/account/me',{token})).data.customer.name,'Alex');
  assert.equal((await c.put(path,{email:'replacement@example.com',confirmed:true},{token:admin})).status,200);
  assert.equal((await c.get('/account/me',{token})).data.linked,false,'old email immediately loses ledger association');
  assert.ok(b.id);
});
test('account: sender failures clean up challenge and sending is rate limited', async t => {
  const {c,env,request} = setup(t);
  await request(); await request(); await request();
  assert.equal((await c.post('/account/code',{email:'alex@example.com'})).status,429);
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('simulated outage');});
  const result = await c.post('/account/code',{email:'other@example.com'});
  assert.equal(result.status,503);
  assert.equal((await env.KV.list({prefix:'account:code:'})).keys.length,3);
});
