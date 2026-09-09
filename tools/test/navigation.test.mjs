import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot(native = true) {
  function node(id) {
    const classes = new Set(), attrs = {};
    return {id,attrs,classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle(k,on){if(on)classes.add(k);else classes.delete(k);}},querySelector:()=>null,setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k]};
  }
  const home=node('view-home'),shop=node('view-shop'),root=node('html'),bus={},events=[];
  const TL={storagePrefix:'test-',on:(ev,fn)=>(bus[ev]??=[]).push(fn),emit(ev,data){events.push(ev);for(const f of bus[ev]||[])f(data);}};
  root.setAttribute('data-boot-view','shop');
  const document={documentElement:root,title:'Test',hidden:false,addEventListener(){}};
  let finish;
  if(native)document.startViewTransition=fn=>{fn();return {ready:Promise.resolve(),updateCallbackDone:Promise.resolve(),finished:new Promise(resolve=>finish=resolve)}};
  const context={TL,document,location:{hash:'#/shop?game=op'},history:{replaceState(){}},sessionStorage:{getItem:()=>null},reduceMotion:false,
    $:s=>s==='#view-home'?home:s==='#view-shop'?shop:null,$$:s=>s.startsWith('section.view')?[home,shop]:[],scrollTo(){},addEventListener(){}};
  context.window=context;
  vm.runInNewContext(readFileSync(new URL('../../src/js/10-router.js',import.meta.url),'utf8'),context);
  TL.emit('init');
  return {TL,home,shop,root,events,finish:()=>finish?.()};
}
test('initial deep link selects requested view without an entry replay',()=>{
  const x=boot();assert.equal(x.TL.current,'shop');assert.equal(x.TL.route().params.game,'op');
  assert.equal(x.shop.classList.contains('active'),true);assert.equal(x.home.classList.contains('active'),false);
  assert.equal(x.shop.classList.contains('route-enter'),false);assert.equal('data-boot-view' in x.root.attrs,false);
  assert.equal(x.events.filter(e=>e==='view:change').length,1);
});
test('native transition completion cannot re-enable fallback animation',async()=>{
  const x=boot();x.TL.go('home',{}, {replace:true});assert.equal(x.root.classList.contains('vt'),true);
  x.finish();await Promise.resolve();assert.equal(x.root.classList.contains('vt'),false);
  assert.equal(x.home.classList.contains('route-enter'),false);
});
test('non-native navigation has one explicitly assigned fallback',()=>{
  const x=boot(false);x.TL.go('home',{}, {replace:true});
  assert.equal(x.home.classList.contains('route-enter'),true);assert.equal(x.shop.classList.contains('route-enter'),false);
});
