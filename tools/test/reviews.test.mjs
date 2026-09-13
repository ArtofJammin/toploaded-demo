import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {highlights,refreshReviews,SELLER} from '../update-reviews.mjs';
const now=new Date('2026-09-13T12:00:00Z');
const row={active:true,sellerKey:SELLER,feedbackRating:5,comment:'Short test feedback.',createdDate:'2026-09-12T12:00:00Z',userNickname:'A********Z',sellerOrderID:'PRIVATE',userKey:'PRIVATE',createdByUserKey:'PRIVATE'};
test('public highlights strip order/account identifiers and keep masked attribution',()=>{
  const out=highlights({result:[row]},now);assert.equal(out.items[0].who,'A****Z');
  assert.equal(out.items[0].quote,row.comment);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
  assert.deepEqual(Object.keys(out.items[0]),['quote','who','rating','source','url','at']);
});
test('review selection skips inactive, wrong-seller, old, duplicate and lower-rated feedback',()=>{
  const bad=[{active:false},{sellerKey:'other'},{feedbackRating:1},{createdDate:'2025-01-01'},{createdDate:'bad'},{createdDate:'2030-01-01'},{comment:'No Comment Provided.'}];
  assert.equal(highlights({result:[...bad.map(x=>({...row,...x})),row,row]},now).items.length,1);
  assert.throws(()=>highlights({errors:[]},now),/Unrecognized/);
});
test('only complete short comments fit the three-review, 25-word budget',()=>{
  const result=Array.from({length:5},(_,i)=>({...row,comment:'This is a complete test comment with eight words '+i}));
  const out=highlights({result},now);
  assert.ok(out.items.length<=3);assert.ok(out.items.reduce((s,r)=>s+r.quote.split(/\s+/).length,0)<=25);
  assert.ok(out.items.every(r=>result.some(x=>x.comment===r.quote)));
});
test('failed provider refresh preserves last-good file; successful empty feed clears old reviews',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tl-review-test-')),file=join(dir,'reviews.json');writeFileSync(file,'{"items":["old"]}');
  try{
    await assert.rejects(refreshReviews({file,force:true,fetcher:async()=>new Response('',{status:503})}),/503/);
    assert.equal(readFileSync(file,'utf8'),'{"items":["old"]}');
    await refreshReviews({file,force:true,fetcher:async()=>Response.json({result:[]})});
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).items,[]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
