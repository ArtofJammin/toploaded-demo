import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv,client} from './helpers.mjs';
import {StreamClaims} from '../src/lib/stream-claims.js';
import {memoryObject} from '../src/lib/memory-object.js';

test('floor plan persists and rejects overlap, invalid types and partial-grid shrink',async()=>{
  const c=client(makeEnv()),token=await c.login('admin'),opts={token};
  const booth={id:'a',label:'Vendor A',type:'tcg',r:2,c:2,w:1,h:1};
  assert.equal((await c.put('/config',{show:{floorplan:{rows:3,cols:3,booths:[booth]}}},opts)).status,200);
  assert.equal((await c.get('/config')).data.show.floorplan.booths[0].label,'Vendor A');
  assert.equal((await c.put('/config',{show:{floorplan:{rows:1}}},opts)).status,400);
  assert.equal((await c.put('/config',{show:{floorplan:{booths:[booth,{...booth,id:'b'}]}}},opts)).status,400);
  assert.equal((await c.put('/config',{show:{floorplan:{booths:[{...booth,type:'fake'}]}}},opts)).status,400);
  assert.equal((await c.get('/config')).data.show.floorplan.rows,3);
});
test('attributed review settings persist, filters positive highlights, rejects malformed input',async()=>{
  const c=client(makeEnv()),token=await c.login('admin'),opts={token};
  const review={quote:'Test-only review fixture',who:'Test Author',rating:5,source:'tcgplayer',url:'https://www.tcgplayer.com/'};
  assert.equal((await c.put('/config',{reviews:{items:[review]}},opts)).status,200);
  assert.equal((await c.get('/reviews')).data.items[0].who,'Test Author');
  assert.equal((await c.put('/config',{reviews:{items:[{...review,rating:0}]}},opts)).status,400);
  assert.equal((await c.put('/config',{reviews:{items:[{...review,url:'javascript:alert(1)'}]}},opts)).status,400);
  assert.equal((await c.put('/config',{reviews:{source:'google'}},opts)).status,200);
  assert.equal((await c.get('/reviews')).data.mode,'setup-required');
});
test('shared claims require staff, retain simultaneous posts, and publish status updates',async()=>{
  const c=client(makeEnv({LIVE_CLAIMS:memoryObject(StreamClaims)}));
  const payload={card:'Test Card / printing',handle:'QA-handle',price:12.5};
  assert.equal((await c.post('/live/claims',payload)).status,401);
  const token=await c.login('staff'),opts={token};
  const posted=await Promise.all([c.post('/live/claims',payload,opts),c.post('/live/claims',{...payload,card:'Second card'},opts)]);
  assert.ok(posted.every(x=>x.status===200));
  const rows=(await c.get('/live/claims')).data.claims;assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);
  assert.equal((await c.put('/live/claims/'+rows[0].id,{status:'shipped'},opts)).status,200);
  assert.equal((await c.get('/live/claims')).data.claims[0].status,'shipped');
  assert.equal((await c.post('/live/claims',{...payload,handle:'private@example.com'},opts)).status,400);
  assert.equal((await c.post('/live/claims',{...payload,price:null},opts)).status,400);
  assert.equal((await c.put('/live/claims/'+rows[0].id,{status:'bad'},opts)).status,400);
});
test('undeployed claims service returns an explicit setup error, not fake purchases',async()=>{
  assert.equal((await client(makeEnv()).get('/live/claims')).status,503);
});

test('Google feed keeps source attribution, filters ratings and never exposes the API key',async()=>{
  const env=makeEnv({GOOGLE_PLACES_API_KEY:'test-only-secret',GOOGLE_REVIEWS_TERMS_URL:'https://shop.test/terms',GOOGLE_REVIEWS_PRIVACY_URL:'https://shop.test/privacy'});
  await env.KV.put('config',JSON.stringify({reviews:{source:'google',googlePlaceId:'test-place',minRating:4,items:[]}}));
  const original=globalThis.fetch;let requested;
  globalThis.fetch=async(url,opts)=>{requested={url,opts};return new Response(JSON.stringify({googleMapsUri:'https://maps.google.com/place',reviews:[
    {rating:5,text:{text:'Test-only positive fixture'},googleMapsUri:'https://maps.google.com/review/1',authorAttribution:{displayName:'Test Author',uri:'https://maps.google.com/profile/1',photoUri:'https://example.com/avatar.png'}},
    {rating:2,text:{text:'Test-only lower rating'}}]}));};
  try{
    const result=await client(env).get('/reviews');assert.equal(result.status,200);assert.equal(result.data.items.length,1);
    assert.equal(result.data.items[0].authorUrl,'https://maps.google.com/profile/1');assert.equal(result.data.items[0].url,'https://maps.google.com/review/1');
    assert.equal(requested.opts.headers['X-Goog-Api-Key'],'test-only-secret');assert.ok(!JSON.stringify(result.data).includes('test-only-secret'));
    globalThis.fetch=async()=>new Response('',{status:503});assert.equal((await client(env).get('/reviews')).status,502);
  }finally{globalThis.fetch=original;}
});
