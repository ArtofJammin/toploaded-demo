import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/js/58-packrip.js', import.meta.url), 'utf8');
function simulator() {
  const nodes = new Map(), saved = new Map(), shares = [], cart = [];
  for (const id of ['ripApp', 'ripLive', 'ripPack', 'ripCards', 'ripGrid', 'ripResults']) {
    nodes.set('#' + id, {innerHTML: '', textContent: '', dataset: {}, hidden: true,
      addEventListener() {}, focus() {}, classList: {add() {}}});
  }
  const items = Array.from({length: 12}, (_, i) => ({id: 'sample-' + i, game: 'pk',
    type: 'single', set: 'Test set', name: 'Example card ' + i, rarity: 'Common', price: 10, stock: 2}));
  const context = {ITEMS: items, reduceMotion: true, Image: class {},
    $: id => nodes.get(id), $$: () => [],
    esc: value => String(value), fmtInt: String, money: n => '$' + Number(n).toFixed(2),
    cardArt: () => '<svg></svg>', setTimeout: () => 0, clearTimeout() {},
    location: {origin: 'https://example.com', pathname: '/preview/'},
    navigator: {share: data => { shares.push(data); return Promise.resolve(); }},
    TL: {on() {}, go() {}, config: {},
      store: {get: (key, fallback) => saved.get(key) ?? fallback, set: (key, value) => saved.set(key, value)},
      cart: {add: (...args) => cart.push(args)}}};
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../../src/js/06-game-icons.js', import.meta.url), 'utf8'), context);
  vm.runInContext(source, context);
  context.ripItems = items;
  return {context, nodes, saved, shares, cart, items};
}

test('catalog outage does not quietly substitute cards from inventory',async()=>{
  const {context:c}=simulator();
  c.TL.cards={catalogued:()=>true,fromSet:async()=>{throw new Error('catalog offline');}};
  await assert.rejects(c.ripBuildPool('pk','external-set'),/catalog offline/);
});

test('TCGplayer rarity abbreviations map to the intended simulation tiers',()=>{
  const {context:c}=simulator();
  assert.equal(c.ripTier('pk','C'),'C');assert.equal(c.ripTier('pk','U'),'U');
  assert.equal(c.ripTier('op','UC'),'UC');assert.equal(c.ripTier('op','SR'),'SR');assert.equal(c.ripTier('op','SEC'),'SEC');
  assert.equal(c.ripTier('mtg','M'),'M');
});

test('simulation is explicit on entry, setup, pack and card reveal', () => {
  const markup = readFileSync(new URL('../../src/html/19-packrip.html', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../../src/html/10-home.html', import.meta.url), 'utf8');
  assert.match(markup, /Simulation only\. No real pack is opened\./);
  assert.match(markup, /No cards or prizes are awarded, owned, or reserved/);
  assert.match(home, /Free simulation\. No real pack is opened, no cards are awarded/);
  const {context: c, nodes} = simulator();
  c.ripRenderSetup();
  assert.match(nodes.get('#ripApp').innerHTML, /Start free simulation/);
  assert.match(nodes.get('#ripApp').innerHTML, /These are not real booster-pack odds/);
  assert.doesNotMatch(nodes.get('#ripApp').innerHTML, /Pack price|<dt>Spent|<dt>Pulled/);
  c.ripStartPack();
  assert.match(nodes.get('#ripApp').innerHTML, /Open simulated pack/);
  assert.match(nodes.get('#ripApp').innerHTML, /no real pack or card prizes/);
  c.ripDeal(0, 0);
  assert.match(nodes.get('#ripCards').innerHTML, /these cards are not awarded to you/);
});

test('results and sharing never imply winnings; shopping requires a separate action', () => {
  const {context: c, nodes, shares, saved, cart, items} = simulator();
  c.ripStartPack();
  c.ripShowResults();
  const result = nodes.get('#ripResults').innerHTML;
  assert.match(result, /No real pack was opened\. No cards or prizes were awarded\./);
  assert.match(result, /Reference singles total/);
  assert.match(result, /not winnings, profit, or a balance/);
  assert.match(result, /sold separately and require a separate checkout/);
  assert.doesNotMatch(result, /You pulled|from a \$|x the pack price/);
  assert.equal(cart.length, 0);
  assert.ok(items.every(item => item.stock === 2));
  assert.deepEqual([...saved.keys()].sort(), ['rip', 'ripStats']);
  c.ripShare();
  assert.match(shares[0].title, /free pack simulator/);
  assert.match(shares[0].text, /No real pack was opened and no cards or prizes were awarded/);
  assert.match(shares[0].text, /not winnings or store credit/);
  assert.doesNotMatch(shares[0].text, /I pulled|from a \$/);
  c.ripAddToCart(0, null);
  assert.equal(cart.length, 1, 'only the explicit shopping action adds a physical single');
});
