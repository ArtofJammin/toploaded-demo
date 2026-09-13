// TCGCSV has no browser CORS: publish complete checklists on our own origin.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)), games={pk:3,op:68,mtg:1,gundam:86,lorcana:71};
const path=resolve(root,'catalog-index.json');
const prior=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
if(!process.argv.includes('--force') && prior && Date.now()-Date.parse(prior.generated)<86400000){console.log('Catalog refreshed within 24 hours.');process.exit(0);}
const inventory=JSON.parse(readFileSync(resolve(root,'inventory.json'),'utf8'));
const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
let last=0;
async function get(path){
  await new Promise(r=>setTimeout(r,Math.max(0,125-(Date.now()-last))));last=Date.now();
  const r=await fetch('https://tcgcsv.com/tcgplayer/'+path,{headers:{'User-Agent':'TopLoadedCatalog/1.0'},signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw new Error(path+': HTTP '+r.status);
  const d=await r.json();
  if(!d.success || !Array.isArray(d.results) || (d.totalItems!==undefined && d.totalItems!==d.results.length))throw new Error('Incomplete catalog '+path);
  return d.results;
}
const generated=new Date().toISOString(),sets=[],outputs=[];
for(const [game,category] of Object.entries(games)){
  const groups=await get(category+'/groups');
  const stocked=new Set(inventory.items.filter(i=>i.game===game).map(i=>norm(i.set)));
  const chosen=groups.filter(g=>stocked.has(norm(g.name)));
  for(const g of groups.slice().sort((a,b)=>b.groupId-a.groupId).slice(0,6))if(!chosen.some(x=>x.groupId===g.groupId))chosen.push(g);
  for(const g of chosen){
    const products=await get(category+'/'+g.groupId+'/products');
    const cards=products.filter(p=>(p.extendedData||[]).some(x=>/^(rarity|number|cardtype|card type)$/i.test(x.name)&&x.value) && !/code card|booster (box|pack|bundle)|elite trainer|sleeves|playmat|sealed|starter deck|display box/i.test(p.name));
    if(cards.length<10)continue;
    const prices=await get(category+'/'+g.groupId+'/prices'),market=new Map();
    for(const p of prices)if(p.marketPrice>0 && (!market.has(p.productId)||p.marketPrice<market.get(p.productId)))market.set(p.productId,p.marketPrice);
    const data=cards.map(p=>{
      const ex=Object.fromEntries((p.extendedData||[]).map(x=>[x.name.toLowerCase(),x.value]));
      return {id:String(p.productId),name:p.name,set:g.name,game,rarity:ex.rarity||'',num:ex.number||'',price:market.get(p.productId)||null,img:p.imageCount>0?'https://tcgplayer-cdn.tcgplayer.com/product/'+p.productId+'_in_400x400.jpg':null,url:'https://www.tcgplayer.com/product/'+p.productId,source:'tcgcsv'};
    });
    const file='catalog-'+g.groupId+'.json';outputs.push([file,JSON.stringify({generated,game,set:g.name,cards:data})]);
    sets.push({game,name:g.name,code:String(g.groupId),count:data.length,file});console.log(game,g.name,data.length);
  }
  if(!sets.some(s=>s.game===game))throw new Error('No complete sets for '+game);
}
// Fetch everything before replacing last-good public data. No card images copied.
for(const [file,data] of outputs)writeFileSync(resolve(root,file),data);
writeFileSync(path,JSON.stringify({generated,source:'https://tcgcsv.com/',sets}));
console.log('Published',sets.length,'whole-set checklists.');
