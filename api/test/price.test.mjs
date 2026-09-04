import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client } from './helpers.mjs';
import { resetInventoryCache, mapScryfall, mapPokemon } from '../src/routes/price.js';

const INVENTORY = {
  generated: '2026-09-04T04:23:03-0400',
  items: [
    { id: 712122, name: 'Monkey.D.Luffy (ST31-004) (SP)', set: "The World's Strongest Warriors", line: 'One Piece Card Game', game: 'op', rarity: 'Super Rare', market: 945.36, listings: [{ price: 1046.01, qty: 1, cond: 'Near Mint', printing: 'Foil' }] },
    { id: 647710, name: 'A.O. (Parallel)', set: 'Starter Deck 22', line: 'One Piece Card Game', game: 'op', rarity: 'Common', market: 0.42, listings: [{ price: 0.41, qty: 1, cond: 'Near Mint', printing: 'Foil' }] },
    { id: 500001, name: 'Charizard ex - 199/165', set: 'SV: Scarlet & Violet 151', line: 'Pokemon', game: 'pk', rarity: 'Special Illustration Rare', market: 88.12, listings: [{ price: 89.99, qty: 2, cond: 'Near Mint', printing: 'Holofoil' }] },
    { id: 500002, name: 'Ragavan, Nimble Pilferer', set: 'Modern Horizons 2', line: 'Magic', game: 'mtg', rarity: 'Mythic', market: 41.5, listings: [{ price: 42, qty: 1, cond: 'Near Mint', printing: 'Normal' }] },
  ],
};

const SCRYFALL = { data: [
  { name: 'Ragavan, Nimble Pilferer', set_name: 'Modern Horizons 2', collector_number: '138', rarity: 'mythic', prices: { usd: '39.50', usd_foil: '55.00' }, image_uris: { small: 'https://cards.scryfall.io/small/ragavan.jpg' }, scryfall_uri: 'https://scryfall.com/card/mh2/138' },
  { name: 'Ragavan, Nimble Pilferer', set_name: 'Modern Horizons 2 Extended', collector_number: '138e', rarity: 'mythic', prices: { usd: null, usd_foil: '70.00' }, card_faces: [{ image_uris: { small: 'https://cards.scryfall.io/small/ragavan-e.jpg' } }], scryfall_uri: 'https://scryfall.com/card/mh2/138e' },
] };
const POKEMON = { data: [
  { name: 'Charizard ex', number: '199', rarity: 'Special Illustration Rare', set: { name: '151' }, images: { small: 'https://images.pokemontcg.io/sv3pt5/199.png' },
    tcgplayer: { url: 'https://prices.pokemontcg.io/tcgplayer/sv3pt5-199', prices: { holofoil: { market: 91.2, low: 80 } } } },
  { name: 'Charizard ex', number: '6', set: { name: 'Obsidian Flames' }, images: { small: 'https://images.pokemontcg.io/sv3/6.png' }, tcgplayer: { prices: { normal: { market: 3.1 } } } },
] };

function stubFetch({ scryfall = 200, pokemon = 200, inventory = 200 } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  const reply = (mode, body) => {
    if (mode === 'throw') throw new TypeError('fetch failed');
    return new Response(mode === 200 ? JSON.stringify(body) : '{"object":"error"}', { status: mode });
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith('inventory.json')) return reply(inventory, INVENTORY);
    if (u.startsWith('https://api.scryfall.com/')) return reply(scryfall, SCRYFALL);
    if (u.startsWith('https://api.pokemontcg.io/')) return reply(pokemon, POKEMON);
    throw new Error('unexpected fetch ' + u);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test.beforeEach(() => resetInventoryCache());

test('mappers pull market, images and links from Scryfall / pokemontcg payloads', () => {
  const s = mapScryfall(SCRYFALL);
  assert.equal(s[0].market, 39.5);
  assert.equal(s[0].foil, 55);
  assert.equal(s[0].img, 'https://cards.scryfall.io/small/ragavan.jpg');
  assert.equal(s[0].source, 'scryfall');
  assert.equal(s[1].market, 70, 'foil-only printing falls back to usd_foil');
  assert.equal(s[1].printing, 'Foil');
  assert.equal(s[1].img, 'https://cards.scryfall.io/small/ragavan-e.jpg', 'double-faced image');
  const p = mapPokemon(POKEMON);
  assert.equal(p[0].market, 91.2);
  assert.equal(p[0].printing, 'holofoil');
  assert.equal(p[0].set, '151');
  assert.equal(p[0].url, 'https://prices.pokemontcg.io/tcgplayer/sv3pt5-199');
  assert.equal(p[1].market, 3.1);
  assert.equal(p[1].url, null);
  assert.deepEqual(mapScryfall(null), []);
  assert.deepEqual(mapPokemon({}), []);
});

test('mtg lookups hit Scryfall with the right query, merge inventory first, cache 6 h', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch();
  try {
    const r = await c.get('/price?game=mtg&q=ragavan');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.cached, false);
    assert.deepEqual(r.data.sources, { scryfall: 'ok', inventory: 'ok' });
    const sc = s.calls.find(x => x.url.startsWith('https://api.scryfall.com/'));
    assert.equal(sc.url, 'https://api.scryfall.com/cards/search?q=ragavan&unique=prints&order=usd');
    assert.match(sc.init.headers['user-agent'], /ToploadedTCG/);
    assert.equal(sc.init.headers.accept, 'application/json');
    assert.equal(r.data.results.length, 3);
    assert.equal(r.data.results[0].source, 'inventory', 'the shop\'s own listing comes first');
    assert.equal(r.data.results[0].market, 41.5);
    assert.equal(r.data.results[0].price, 42);
    assert.equal(r.data.results[0].img, 'https://tcgplayer-cdn.tcgplayer.com/product/500002_in_200x200.jpg');
    assert.equal(r.data.results[1].source, 'scryfall');
    assert.equal(r.data.results[1].market, 39.5);
    const again = await c.get('/price?game=mtg&q=RAGAVAN%20');
    assert.equal(again.data.cached, true, 'case/whitespace-insensitive cache hit');
    assert.equal(s.calls.filter(x => x.url.includes('scryfall')).length, 1);
    const keys = await env.KV.list({ prefix: 'price:mtg:' });
    assert.equal(keys.keys.length, 1);
    assert.ok(env.KV.exp.get(keys.keys[0].name) > Date.now() + 5.9 * 3600 * 1000);
  } finally { s.restore(); }
});

test('pk lookups use pokemontcg.io (with X-Api-Key when set) and the shop inventory', async () => {
  const env = makeEnv({ POKEMONTCG_API_KEY: 'pk-key' });
  const c = client(env);
  const s = stubFetch();
  try {
    const r = await c.get('/price?game=pk&q=charizard%20ex');
    assert.equal(r.status, 200);
    const pc = s.calls.find(x => x.url.startsWith('https://api.pokemontcg.io/'));
    assert.equal(pc.url, 'https://api.pokemontcg.io/v2/cards?q=name%3A%22charizard%20ex%22&pageSize=10');
    assert.equal(pc.init.headers['x-api-key'], 'pk-key');
    assert.equal(r.data.results[0].source, 'inventory');
    assert.match(r.data.results[0].name, /Charizard ex/);
    assert.equal(r.data.results.filter(x => x.source === 'pokemontcg').length, 2);
    assert.equal(r.data.results.find(x => x.source === 'pokemontcg').market, 91.2);
  } finally { s.restore(); }
  const s2 = stubFetch();
  try {
    resetInventoryCache();
    const c2 = client(makeEnv());
    await c2.get('/price?game=pk&q=pikachu');
    const pc = s2.calls.find(x => x.url.startsWith('https://api.pokemontcg.io/'));
    assert.equal(pc.init.headers['x-api-key'], undefined);
  } finally { s2.restore(); }
});

test('op / other lookups search only the shop inventory (market field) and respect the game filter', async () => {
  const c = client(makeEnv());
  const s = stubFetch();
  try {
    const r = await c.get('/price?game=op&q=luffy');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.sources, { inventory: 'ok' });
    assert.equal(r.data.results.length, 1);
    assert.equal(r.data.results[0].market, 945.36);
    assert.equal(r.data.results[0].productId, 712122);
    assert.equal(r.data.results[0].url, 'https://www.tcgplayer.com/product/712122?seller=5c356cdf');
    assert.equal(s.calls.length, 1, 'only inventory.json was fetched');
    const none = await c.get('/price?game=op&q=charizard');
    assert.equal(none.data.results.length, 0, 'pk card not returned under op');
    const any = await c.get('/price?q=charizard');
    assert.equal(any.data.game, 'other');
    assert.equal(any.data.results.length, 1, 'game=other searches every game');
    const multi = await c.get('/price?game=other&q=parallel%20a.o.');
    assert.equal(multi.data.results.length, 1, 'all words must match, any order');
  } finally { s.restore(); }
});

test('upstream failures are tolerated: partial results, not cached when nothing worked', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = stubFetch({ scryfall: 'throw' });
  try {
    const r = await c.get('/price?game=mtg&q=ragavan');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.sources, { scryfall: 'error', inventory: 'ok' });
    assert.equal(r.data.results.length, 1);
    assert.equal(r.data.results[0].source, 'inventory');
  } finally { s.restore(); }
  resetInventoryCache();
  const s2 = stubFetch({ scryfall: 503, inventory: 'throw' });
  try {
    const c2 = client(makeEnv());
    const r = await c2.get('/price?game=mtg&q=ragavan');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results, []);
    assert.deepEqual(r.data.sources, { scryfall: 'error', inventory: 'error' });
    const keys = await env.KV.list({ prefix: 'price:' });
    assert.equal(keys.keys.filter(k => k.name.includes('ragavan')).length, 0);
    const r2 = await c2.get('/price?game=mtg&q=ragavan');
    assert.equal(r2.data.cached, false, 'an all-failed lookup is not cached');
  } finally { s2.restore(); }
});

test('validation and rate limit', async () => {
  const c = client(makeEnv());
  const s = stubFetch();
  try {
    assert.equal((await c.get('/price?game=mtg&q=a')).status, 400);
    assert.equal((await c.get('/price?game=mtg')).status, 400);
    assert.equal((await c.get('/price?game=mtg&q=' + 'x'.repeat(81))).status, 400);
    const weird = await c.get('/price?game=yugioh&q=blue%20eyes');
    assert.equal(weird.status, 200);
    assert.equal(weird.data.game, 'other');
    let last;
    for (let i = 0; i < 30; i++) last = await c.get('/price?game=op&q=card' + i);
    assert.equal(last.status, 429);
  } finally { s.restore(); }
});
