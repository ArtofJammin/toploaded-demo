// Card price lookup for the buylist estimator.
//   GET /price?game=pk|op|mtg|other&q=<name>  → {results:[{name, set, number?, img?, market, source, url?, printing?}], sources, cached}
// MTG → Scryfall, Pokemon → pokemontcg.io, every game → the shop's own inventory.json
// (TCGplayer "market" field). Upstream failures are tolerated: you get what worked.
// Results are cached in KV for 6 h per game + lowercased query; 30 lookups / 10 min per IP.
// Also exports loadInventory(env) — inventory.json parsed once per isolate (10 min) —
// which checkout.js uses to price and stock-check tcg-<id> lines.
import { HttpError } from '../lib/http.js';
import { getJSON, putJSON } from '../lib/kv.js';
import { rateLimit } from '../lib/ratelimit.js';
import { sha256hex } from '../lib/auth.js';

const CACHE_SEC = 6 * 3600;
const INV_MEMORY_MS = 10 * 60 * 1000;
const MAX_RESULTS = 10;
const UA = 'ToploadedTCG/1.0 (toploadedtcg@gmail.com)';
const SCRYFALL = 'https://api.scryfall.com/cards/search';
const POKEMONTCG = 'https://api.pokemontcg.io/v2/cards';

export const cdnImage = (id) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_200x200.jpg`;
export const tcgUrl = (id) => `https://www.tcgplayer.com/product/${id}?seller=5c356cdf`;

function siteUrl(env, file) {
  const base = String(env.SITE_URL || '').replace(/\/?$/, '/');
  return base + file;
}

function fetchInit(headers = {}, timeoutMs = 4000) {
  const init = { headers: { 'accept': 'application/json', 'user-agent': UA, ...headers } };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(timeoutMs);
  return init;
}

async function getJSONFrom(url, headers, timeoutMs) {
  const r = await fetch(url, fetchInit(headers, timeoutMs));
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---- inventory.json (memory cache per isolate) ----
let invMemory = { at: 0, data: null, promise: null };

// Resolves {generated, items:[raw inventory items], byId:Map} or null when the site
// file cannot be fetched. Concurrent callers share one fetch.
export async function loadInventory(env, { maxAgeMs = INV_MEMORY_MS } = {}) {
  const now = Date.now();
  if (invMemory.data && now - invMemory.at < maxAgeMs) return invMemory.data;
  if (invMemory.promise) return invMemory.promise;
  invMemory.promise = (async () => {
    try {
      const raw = await getJSONFrom(siteUrl(env, 'inventory.json'), {}, 15000);
      const items = raw && Array.isArray(raw.items) ? raw.items : [];
      const byId = new Map();
      for (const it of items) byId.set(String(it.id), it);
      const data = { generated: raw.generated || null, items, byId };
      invMemory = { at: Date.now(), data, promise: null };
      return data;
    } catch {
      invMemory.promise = null;
      return invMemory.data; // stale copy if we have one, else null
    }
  })();
  return invMemory.promise;
}

// Tests and the scheduled maintenance can drop the isolate cache.
export function resetInventoryCache() { invMemory = { at: 0, data: null, promise: null }; }

// Lowest listing price + total stock for a raw inventory item (mirrors the site's liveToItem).
export function itemOffer(raw) {
  const ls = Array.isArray(raw.listings) ? raw.listings : [];
  let best = null, qty = 0;
  for (const l of ls) {
    qty += Number(l.qty) || 0;
    if (!best || Number(l.price) < Number(best.price)) best = l;
  }
  return { price: best ? Number(best.price) : null, stock: qty, cond: best ? best.cond : null, printing: best ? best.printing : null };
}

function searchInventory(inv, q, game) {
  if (!inv) return [];
  const needle = q.toLowerCase();
  const words = needle.split(/\s+/).filter(Boolean);
  const out = [];
  for (const it of inv.items) {
    if (game !== 'other' && it.game !== game) continue;
    const name = String(it.name || '').toLowerCase();
    if (!words.every(w => name.includes(w))) continue;
    const offer = itemOffer(it);
    out.push({
      name: it.name, set: it.set || '', rarity: it.rarity || null, game: it.game,
      img: cdnImage(it.id), market: it.market == null ? null : Number(it.market),
      price: offer.price, stock: offer.stock, printing: offer.printing || null,
      url: tcgUrl(it.id), productId: it.id, source: 'inventory',
    });
    if (out.length >= 50) break;
  }
  // Exact name first, then cheapest-to-priciest market so the chase card is obvious.
  out.sort((a, b) => (Number(b.name.toLowerCase() === needle) - Number(a.name.toLowerCase() === needle)) || ((b.market || 0) - (a.market || 0)));
  return out.slice(0, MAX_RESULTS);
}

// ---- upstream mappers (exported so tests can hit them with canned payloads) ----
export function mapScryfall(body) {
  const cards = body && Array.isArray(body.data) ? body.data : [];
  return cards.slice(0, MAX_RESULTS).map((c) => {
    const prices = c.prices || {};
    const usd = prices.usd != null ? Number(prices.usd) : null;
    const foil = prices.usd_foil != null ? Number(prices.usd_foil) : null;
    const imgs = c.image_uris || (Array.isArray(c.card_faces) && c.card_faces[0] && c.card_faces[0].image_uris) || {};
    return {
      name: c.name, set: c.set_name || c.set || '', number: c.collector_number || null,
      img: imgs.small || null, market: usd != null ? usd : foil, foil, printing: usd == null && foil != null ? 'Foil' : 'Normal',
      rarity: c.rarity || null, url: c.scryfall_uri || null, source: 'scryfall',
    };
  });
}

const PK_PRINTINGS = ['normal', 'holofoil', 'reverseHolofoil', '1stEditionHolofoil', 'unlimitedHolofoil', '1stEditionNormal', 'unlimitedNormal'];
export function mapPokemon(body) {
  const cards = body && Array.isArray(body.data) ? body.data : [];
  return cards.slice(0, MAX_RESULTS).map((c) => {
    const prices = (c.tcgplayer && c.tcgplayer.prices) || {};
    let market = null, printing = null;
    for (const k of PK_PRINTINGS) {
      if (prices[k] && prices[k].market != null) { market = Number(prices[k].market); printing = k; break; }
    }
    return {
      name: c.name, set: (c.set && c.set.name) || '', number: c.number || null,
      img: (c.images && c.images.small) || null, market, printing, rarity: c.rarity || null,
      url: (c.tcgplayer && c.tcgplayer.url) || null, source: 'pokemontcg',
    };
  });
}

async function fromScryfall(q) {
  const url = `${SCRYFALL}?q=${encodeURIComponent(q)}&unique=prints&order=usd`;
  return mapScryfall(await getJSONFrom(url));
}
async function fromPokemon(env, q) {
  const name = q.replace(/"/g, '');
  const url = `${POKEMONTCG}?q=${encodeURIComponent(`name:"${name}"`)}&pageSize=10`;
  const headers = env.POKEMONTCG_API_KEY ? { 'x-api-key': env.POKEMONTCG_API_KEY } : {};
  return mapPokemon(await getJSONFrom(url, headers));
}

function mergeResults(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const r of list) {
      const key = `${r.source}|${String(r.name).toLowerCase()}|${String(r.set).toLowerCase()}|${r.number || r.productId || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= MAX_RESULTS) return out;
    }
  }
  return out;
}

// Runs the lookups for one query; sources report ok/error so the UI can say
// "Scryfall is down, showing shop prices only".
export async function lookup(env, game, q) {
  const sources = {};
  const tasks = [];
  if (game === 'mtg') tasks.push(['scryfall', fromScryfall(q)]);
  if (game === 'pk') tasks.push(['pokemontcg', fromPokemon(env, q)]);
  tasks.push(['inventory', loadInventory(env).then(inv => { if (!inv) throw new Error('inventory unavailable'); return searchInventory(inv, q, game); })]);
  const settled = await Promise.allSettled(tasks.map(t => t[1]));
  let inv = [];
  const rest = [];
  settled.forEach((s, i) => {
    const name = tasks[i][0];
    if (s.status !== 'fulfilled') { sources[name] = 'error'; return; }
    sources[name] = 'ok';
    if (name === 'inventory') inv = s.value; else rest.push(s.value);
  });
  // Shop inventory first (it is the owner's real market data), then the public APIs.
  return { results: mergeResults([inv, ...rest]), sources };
}

export function register(r) {
  r.get('/price', async ({ env, url, ip }) => {
    await rateLimit(env, `price:${ip}`, { limit: 30, windowSec: 600 });
    const q = String(url.searchParams.get('q') || url.searchParams.get('name') || '').trim().replace(/\s+/g, ' ');
    if (q.length < 2) throw new HttpError(400, 'q must be at least 2 characters');
    if (q.length > 80) throw new HttpError(400, 'q too long');
    let game = String(url.searchParams.get('game') || 'other').toLowerCase();
    if (!['pk', 'op', 'mtg', 'other'].includes(game)) game = 'other';

    const key = `price:${game}:${await sha256hex(q.toLowerCase())}`;
    const cached = await getJSON(env.KV, key, null);
    if (cached && Array.isArray(cached.results)) return { ...cached, cached: true };

    const { results, sources } = await lookup(env, game, q);
    const payload = { game, q, results, sources, fetchedAt: new Date().toISOString(), cached: false };
    const anyOk = Object.values(sources).some(s => s === 'ok');
    if (anyOk) await putJSON(env.KV, key, payload, { expirationTtl: CACHE_SEC });
    return payload;
  });
}
