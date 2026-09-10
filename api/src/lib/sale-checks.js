// Read-only reconciliation. A completed Square payment schedules a durable check
// at least five minutes later. Never change TCGplayer listings or credit balances.
import { getJSON, putJSON } from './kv.js';
import { squareRequest } from './square.js';
import { appendAlert } from '../routes/alerts.js';

const TTL = 30 * 24 * 3600;
const SELLER = '5c356cdf';
const SEARCH = 'https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false&mpfev=5489';
const tcgId = value => /^(?:tcg[:-])(\d+)(?:\b|$)/i.exec(String(value || '').trim())?.[1] || null;

export async function scheduleSaleCheck(env, payment, ours) {
  if (!env.SALE_CHECK_QUEUE || !payment.id) return false;
  const key = `sale-check:queued:${payment.id}`;
  if (await env.KV.get(key)) return true;
  const job = { version: 1, paymentId: payment.id, orderId: payment.order_id || null,
    notBefore: Date.now() + 300000 };
  if (ours) job.lines = (ours.lines || []).map(l => ({ name: String(l.name || 'Item').slice(0, 80),
    qty: Number(l.qty) || 1, productId: tcgId(l.id) }));
  await env.SALE_CHECK_QUEUE.send(job, { delaySeconds: 300 });
  // Write only after the queue accepted it. KV is eventually consistent, so the
  // consumer also dedupes. Duplicate reads/alerts are safe; never promise exactly-once.
  await putJSON(env.KV, key, { at: new Date().toISOString(), notBefore: job.notBefore }, { expirationTtl: TTL });
  return true;
}

export async function sellerListing(productId) {
  if (!/^\d+$/.test(String(productId))) throw new Error('Missing TCGplayer product mapping');
  const response = await fetch(SEARCH, {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/json', origin: 'https://www.tcgplayer.com',
      referer: 'https://www.tcgplayer.com/', 'user-agent': 'TopLoaded inventory reconciliation' },
    body: JSON.stringify({ algorithm: 'sales_dismax', from: 0, size: 10,
      filters: { term: { productId: [Number(productId)] }, range: {}, match: {} },
      listingSearch: { context: { cart: {} }, filters: {
        term: { sellerStatus: 'Live', channelId: 0, sellerKey: [SELLER] },
        range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
      context: { cart: {}, shippingCountry: 'US', userProfile: {} },
      settings: { useFuzzySearch: false, didYouMean: {} },
      sort: { field: 'product-sorting-name', order: 'asc' } })
  });
  if (!response.ok) throw new Error(`TCGplayer HTTP ${response.status}`);
  const block = (await response.json())?.results?.[0];
  if (!block || !Array.isArray(block.results) || !Number.isInteger(block.totalResults)) {
    throw new Error('TCGplayer returned an unrecognized response');
  }
  if (block.totalResults === 0 && block.results.length === 0) return { listed: false, quantityShown: 0 };
  if (block.totalResults !== 1 || block.results.length !== 1 || String(block.results[0].productId) !== String(productId)) {
    throw new Error('TCGplayer product filter could not be verified');
  }
  const product = block.results[0], listings = product.listings;
  if (!Array.isArray(listings) || !listings.length || listings.some(l =>
    l.sellerKey !== SELLER || !Number.isInteger(l.quantity) || l.quantity < 1)) {
    throw new Error('TCGplayer seller or listing quantities could not be verified');
  }
  return { listed: true, quantityShown: listings.reduce((n, l) => n + l.quantity, 0) };
}

async function resolveLines(env, job) {
  if (Array.isArray(job.lines)) return job.lines;
  if (!job.orderId || !env.SQUARE_ACCESS_TOKEN) return [];
  const r = await squareRequest(env, 'GET', `/v2/orders/${encodeURIComponent(job.orderId)}`);
  if (!r.ok || !r.body?.order) throw new Error('Square order details unavailable');
  const order = r.body.order;
  // A completed tender can be just part of a split payment. Don't infer that the
  // whole POS order was sold until Square marks it completed.
  if (order.state !== 'COMPLETED') throw new Error('Square order is not completed; check payment status');
  const items = order.line_items || [];
  if (items.length > 40) throw new Error('Large Square order needs manual reconciliation');
  const lines = [];
  for (const li of items) {
    let productId = tcgId(li.note) || tcgId(li.sku);
    if (!productId && li.catalog_object_id) {
      const catalog = await squareRequest(env, 'GET', `/v2/catalog/object/${encodeURIComponent(li.catalog_object_id)}`);
      if (!catalog.ok) throw new Error('Square item mapping unavailable');
      productId = tcgId(catalog.body?.object?.item_variation_data?.sku);
    }
    lines.push({ name: String(li.name || 'Item').slice(0, 80), qty: Number(li.quantity) || 1, productId });
  }
  return lines;
}

export async function consumeSaleChecks(batch, env) {
  for (const message of batch.messages) {
    const job = message.body;
    if (!job || job.version !== 1 || !job.paymentId || !Number.isFinite(job.notBefore)) {
      console.error('[sale check] Invalid queue message'); message.ack(); continue;
    }
    if (Date.now() < job.notBefore) {
      message.retry({ delaySeconds: Math.ceil((job.notBefore - Date.now()) / 1000) }); continue;
    }
    const key = `sale-check:result:${job.paymentId}`;
    try {
      if (await env.KV.get(key)) { message.ack(); continue; }
      const lines = await resolveLines(env, job), results = [];
      if (!lines.length) lines.push({ name: 'Square sale', qty: 1, productId: null });
      for (const line of lines) {
        const name = String(line.name || 'Item').slice(0, 80);
        if (!line.productId) {
          await appendAlert(env, { ch: 'TCGplayer', source: 'sale-check',
            msg: `After-sale check: ${name} — no TCGplayer product mapping. Check the listing manually; add tcg:PRODUCT_ID to the Square variation SKU.` });
          results.push({ productId: null, status: 'needs-mapping' }); continue;
        }
        const observed = await sellerListing(line.productId);
        const outcome = observed.listed
          ? `still listed; ${observed.quantityShown} units shown. Confirm remaining physical stock and adjust TCGplayer if needed.`
          : 'no active listing returned for our seller. This is a listing check, not proof of a stock adjustment.';
        await appendAlert(env, { ch: 'TCGplayer', source: 'sale-check', sku: `tcg:${line.productId}`,
          msg: `After-sale check (${line.qty} sold): ${name} — ${outcome}`.slice(0, 240) });
        results.push({ productId: line.productId, ...observed });
      }
      await putJSON(env.KV, key, { at: new Date().toISOString(), results }, { expirationTtl: TTL });
      message.ack();
    } catch (error) {
      console.error('[sale check]', error.message);
      // Persist a staff-visible failure, never interpret a timeout/403 as sold out.
      if (message.attempts >= 4) {
        await appendAlert(env, { ch: 'TCGplayer', source: 'sale-check',
          msg: `After-sale check could not finish for Square payment ${String(job.paymentId).slice(0, 50)}. TCGplayer or item mapping is unavailable; check the sale manually.` });
        await putJSON(env.KV, key, { at: new Date().toISOString(), failed: true }, { expirationTtl: TTL });
        message.ack();
      } else message.retry({ delaySeconds: 300 });
    }
  }
}
