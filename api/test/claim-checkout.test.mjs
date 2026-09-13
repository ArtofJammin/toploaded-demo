import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {makeEnv,client} from './helpers.mjs';
import {StreamClaims} from '../src/lib/stream-claims.js';
import {memoryObject} from '../src/lib/memory-object.js';
const webhook='https://api.test/square/webhook',key='test-signature-key';
async function fixture({available=1,tracked=true,enabled=true}={}){
  const env=makeEnv({LIVE_CLAIMS:memoryObject(StreamClaims),CLAIM_CHECKOUT_ENABLED:String(enabled),SQUARE_ACCESS_TOKEN:'test',SQUARE_LOCATION_ID:'LOC',SQUARE_WEBHOOK_URL:webhook,SQUARE_WEBHOOK_SIGNATURE_KEY:key});
  const c=client(env),token=await c.login('staff'),opts={token},original=globalThis.fetch,calls=[],orders=new Map();let omitDue=false,cancelFails=false;
  globalThis.fetch=async(url,init={})=>{
    url=String(url);const body=init.body?JSON.parse(init.body):null;calls.push({url,method:init.method||'GET',body});
    if(url.includes('/catalog/object/'))return Response.json({object:{id:'VAR',type:'ITEM_VARIATION',item_variation_data:{track_inventory:tracked,price_money:{currency:'USD'}}}});
    if(url.includes('/inventory/'))return Response.json({counts:[{catalog_object_id:'VAR',location_id:'LOC',state:'IN_STOCK',quantity:String(available)}]});
    if(url.endsWith('/payment-links')){const id=body.idempotency_key;orders.set('SQ-'+id,{id:'SQ-'+id,...body.order,state:'OPEN',total_money:{amount:1250,currency:'USD'},net_amount_due_money:{amount:0,currency:'USD'}});return Response.json({payment_link:{id:'PL-'+id,order_id:'SQ-'+id,url:'https://sandbox.square.link/u/'+id}});}
    if(url.includes('/orders/')){const order=structuredClone(orders.get(url.split('/').pop()));if(omitDue)delete order.net_amount_due_money;return Response.json({order});}
    if(init.method==='DELETE')return cancelFails?Response.json({errors:[]},{status:409}):Response.json({cancelled_order_id:'SQ-'+url.split('PL-')[1]});
    throw new Error('Unexpected test request');
  };
  async function add(){const r=await c.post('/live/claims',{card:'Test card · NM foil',handle:'Test-handle',price:12.5,squareVariationId:'VAR',tcgProductId:'123',fulfillment:'pickup'},opts);assert.equal(r.status,200);return r.data.claim.id;}
  async function pay(id,{status='COMPLETED',location='LOC',eventId=crypto.randomUUID()}={}){const raw=JSON.stringify({type:'payment.updated',event_id:eventId,data:{object:{payment:{id:'PAY-'+id,order_id:'SQ-'+id,location_id:location,status}}}});return c.call('POST','/square/webhook',undefined,{raw,headers:{'x-square-hmacsha256-signature':createHmac('sha256',key).update(webhook+raw).digest('base64')}});}
  return {env,c,opts,calls,add,pay,orders,setOmitDue:v=>omitDue=v,setCancelFails:v=>cancelFails=v,restore:()=>globalThis.fetch=original};
}
test('checkout is explicitly off until configured; only staff can create links',async()=>{
  const f=await fixture({enabled:false});try{const id=await f.add();assert.equal((await f.c.get('/live/checkout/status')).data.ready,false);assert.equal((await f.c.post('/live/claims/'+id+'/checkout',{})).status,401);assert.equal((await f.c.post('/live/claims/'+id+'/checkout',{},f.opts)).status,503);assert.equal(f.calls.length,0);}finally{f.restore();}
});
test('catalog-linked checkout checks stock, applies catalog taxes, retries one link and hides private fields',async()=>{
  const f=await fixture();try{const id=await f.add(),path='/live/claims/'+id+'/checkout';const first=await f.c.post(path,{},f.opts);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal((await f.c.post(path,{},f.opts)).data.url,first.data.url);
    const calls=f.calls.filter(c=>c.method==='POST');assert.equal(calls.length,1);assert.equal(calls[0].body.order.line_items[0].catalog_object_id,'VAR');assert.equal(calls[0].body.order.pricing_options.auto_apply_taxes,true);assert.equal(calls[0].body.order.line_items[0].base_price_money.amount,1250);
    const board=(await f.c.get('/live/claims')).data;assert.equal(board.claims[0].paymentManaged,true);assert.ok(!JSON.stringify(board).includes('square.link'));assert.ok(!JSON.stringify(board).includes('VAR'));assert.equal((await f.c.put('/live/claims/'+id,{status:'paid'},f.opts)).status,409);
  }finally{f.restore();}
});
test('untracked or sold-out Square items cannot create a payment link',async()=>{
  for(const config of [{available:0},{tracked:false}]){const f=await fixture(config);try{const id=await f.add();assert.equal((await f.c.post('/live/claims/'+id+'/checkout',{},f.opts)).status,409);assert.ok(!f.calls.some(c=>c.method==='POST'));}finally{f.restore();}}
});
test('two concurrent claims cannot reserve the same last unit',async()=>{
  const f=await fixture();try{const ids=[await f.add(),await f.add()];const result=await Promise.all(ids.map(id=>f.c.post('/live/claims/'+id+'/checkout',{},f.opts)));assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);}finally{f.restore();}
});
test('only matching, fully paid signed Square orders mark claims paid; failures never undo paid status',async()=>{
  const f=await fixture();try{const id=await f.add();await f.c.post('/live/claims/'+id+'/checkout',{},f.opts);
    assert.equal((await f.pay(id,{status:'PENDING'})).status,200);assert.equal((await f.c.get('/live/claims')).data.claims[0].status,'claimed');
    f.setOmitDue(true);assert.equal((await f.pay(id)).status,503);f.setOmitDue(false);assert.equal((await f.pay(id,{location:'OTHER'})).status,503);
    assert.equal((await f.pay(id)).status,200);assert.equal((await f.pay(id)).status,200);assert.equal((await f.c.get('/live/claims')).data.claims[0].status,'paid');
    await f.pay(id,{status:'FAILED'});assert.equal((await f.c.get('/live/claims')).data.claims[0].status,'paid');
    assert.ok(!f.calls.some(c=>c.url.includes('/inventory/')&&c.method!=='GET'),'Square alone adjusts catalog stock—no double decrement');
    assert.equal((await f.c.put('/live/claims/'+id,{status:'shipped'},f.opts)).status,200);assert.equal((await f.c.post('/live/claims/'+id+'/cancel-checkout',{},f.opts)).status,409);
  }finally{f.restore();}
});
test('cancellation requires Square acknowledgement before releasing the reservation',async()=>{
  const f=await fixture();try{const id=await f.add();await f.c.post('/live/claims/'+id+'/checkout',{},f.opts);f.setCancelFails(true);assert.equal((await f.c.post('/live/claims/'+id+'/cancel-checkout',{},f.opts)).status,409);assert.equal((await f.c.get('/live/claims')).data.claims[0].status,'claimed');f.setCancelFails(false);assert.equal((await f.c.post('/live/claims/'+id+'/cancel-checkout',{},f.opts)).status,200);assert.equal((await f.c.get('/live/claims')).data.claims[0].status,'cancelled');}finally{f.restore();}
});

test('Square catalog search is staff-only and returns only safe variation fields',async()=>{
  const env=makeEnv({SQUARE_ACCESS_TOKEN:'test',SQUARE_LOCATION_ID:'LOC'}),c=client(env),token=await c.login('staff'),orig=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{assert.ok(String(url).endsWith('/search-catalog-items'));assert.equal(JSON.parse(init.body).text_filter,'card');return Response.json({items:[{type:'ITEM',item_data:{name:'Test Card',variations:[{type:'ITEM_VARIATION',id:'VAR',item_variation_data:{name:'NM foil',sku:'tcg:123',track_inventory:true,price_money:{amount:1200,currency:'USD'},cost:'PRIVATE'}}]}}]});};
  try{assert.equal((await c.get('/live/catalog?q=card')).status,401);const r=await c.get('/live/catalog?q=card',{token});assert.equal(r.status,200);assert.equal(r.data.items[0].variationId,'VAR');assert.equal(r.data.items[0].tcgProductId,'123');assert.ok(!JSON.stringify(r.data).includes('PRIVATE'));}finally{globalThis.fetch=orig;}
});

test('signed order reference recovers a paid claim when the KV checkout index was not saved',async()=>{
  const f=await fixture();try{const id=await f.add(),r=await f.c.post('/live/claims/'+id+'/checkout',{},f.opts);await f.env.KV.delete('order:sq:SQ-'+id);await f.env.KV.delete('order:'+r.data.orderId);assert.equal((await f.pay(id)).status,200);assert.equal((await f.c.get('/checkout/orders/'+r.data.orderId)).data.order.status,'paid');assert.equal((await f.c.get('/live/claims')).data.claims[0].status,'paid');}finally{f.restore();}
});
