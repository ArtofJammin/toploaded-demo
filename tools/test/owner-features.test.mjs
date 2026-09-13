import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
function catalog(failed=false){
  const index={sets:[{code:'1',name:'Test set',game:'pk',count:3,file:'catalog-1.json'}]};
  const cards=[1,2,3].map(id=>({id:String(id),game:'pk',name:'Same name',set:'Test set',price:50}));
  const item={id:'tcg-2',game:'pk',type:'single',stock:1,price:20};
  const c={TL:{inventory:{loaded:true,failed,load:async()=>[],byId:id=>id==='tcg-2'?item:null}},fetch:async file=>({ok:true,json:async()=>file==='catalog-index.json'?index:{cards}})};
  vm.createContext(c);vm.runInContext(read('src/js/08-cardsource.js'),c);return {c,cards};
}
test('whole-set discovery includes unstocked cards and distinguishes identical-name printings',async()=>{
  const {c}=catalog(),all=await c.TL.cards.fromSet('pk','1');
  assert.equal(all.length,3);assert.equal(all[0].inStock,false);assert.equal(all[1].inStock,true);assert.equal(all[2].inStock,false);
  assert.equal(all[1].price,20);assert.equal(all[0].priceIsMarket,true);
  const affordable=await c.TL.cards.fromSet('pk','1',{maxPrice:25});assert.equal(affordable.length,1);
});
test('inventory failure cannot create stock badges and incomplete checklists are rejected',async()=>{
  const {c,cards}=catalog(true);let all=await c.TL.cards.fromSet('pk','1');assert.ok(all.every(x=>!x.inStock&&!x.stockKnown));
  cards.pop();await assert.rejects(c.TL.cards.fromSet('pk','1'),/complete set/);
});
test('vendor mix uses vendor booths, excludes amenities and totals 100 percent',()=>{
  const c={TL:{on(){}}};vm.createContext(c);vm.runInContext(read('src/js/56-floorplan.js'),c);
  const s=c.TL.floorplan.stats(['tcg','sports','mixed','food','entry'].map(type=>({type})));
  assert.equal(s.total,3);assert.equal(Object.values(s.pct).reduce((a,b)=>a+b,0),100);assert.equal(s.pct.tcg,33);
  assert.equal(c.TL.floorplan.stats([]).total,0);
});
test('shop-time clocks are stable and DST-aware instead of drifting on every tick',()=>{
  const c={TL:{config:{timezone:'America/New_York'}}};vm.createContext(c);
  const block=read('src/js/03-config.js').match(/  TL\.wallTime = function[\s\S]*?\n  };/)[0];vm.runInContext(block,c);
  assert.equal(c.TL.wallTime(2026,9,13,11,0).toISOString(),'2026-09-13T15:00:00.000Z');
  assert.equal(c.TL.wallTime(2026,11,1,11,0).toISOString(),'2026-11-01T16:00:00.000Z');
  assert.equal(c.TL.wallTime(2026,9,13,11,0).getTime(),c.TL.wallTime(2026,9,13,11,0).getTime());
});
test('requested removals, section ordering and public catalog are packaged',()=>{
  const home=read('src/html/10-home.html');
  assert.ok(home.indexOf('trade-band')<home.indexOf('id="playNow"'));assert.ok(home.indexOf('id="playNow"')<home.indexOf('FIND YOUR'));
  assert.doesNotMatch(home,/id="ticker"|id="featuredGrid"|id="nextUp"/);
  assert.doesNotMatch(read('src/html/14-buylist.html'),/worthEstimator|worthForm/);
  assert.doesNotMatch(read('src/html/12-show.html'),/Past shows/);
  const index=JSON.parse(read('catalog-index.json'));
  assert.ok(index.sets.length>0);
  for(const s of index.sets){const d=JSON.parse(read(s.file));assert.equal(d.cards.length,s.count);assert.ok(d.cards.every(c=>c.id&&c.name&&c.game===s.game));}
  assert.match(read('.github/workflows/pages.yml'),/cp catalog-\*\.json _site/);
});
