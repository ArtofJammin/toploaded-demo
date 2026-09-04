// Square webhooks → cross-channel alerts.
//   POST /square/webhook   (header x-square-hmacsha256-signature; 401 when it does not verify)
// Verified events are deduped by event_id (KV square:event:<id>, 7 days) and mapped:
//   inventory.count.updated → "stock changed in Square, update the TCGplayer listing" (one per object per hour)
//   order.created           → in-store / online sale alert (line items pulled from Square when a token is set)
//   payment.updated         → COMPLETED marks our order:<id> paid + alert; FAILED/CANCELED marks it failed
// Always 200 once the signature checks out, so Square never retries a handled event.
// Alerts go through routes/alerts.js appendAlert when it exists, else a local
// pushList to KV "alerts" with the same {id, at, ch, msg, source, ack:false} shape.
import { HttpError } from '../lib/http.js';
import { getJSON, putJSON, pushList } from '../lib/kv.js';
import { verifyWebhookSignature, retrieveOrder } from '../lib/square.js';
import * as alertsModule from './alerts.js';

const EVENT_TTL = 7 * 24 * 3600;
const COALESCE_SEC = 3600;

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

// {ch, msg, source, ...extra} → stored alert. Returns the alert object.
export async function appendAlert(env, alert) {
  const record = { id: newId('al'), at: new Date().toISOString(), ack: false, ...alert };
  if (typeof alertsModule.appendAlert === 'function') {
    try {
      const stored = await alertsModule.appendAlert(env, record);
      return stored || record;
    } catch (e) { console.error('[square] alerts.appendAlert failed, storing locally:', e && e.message); }
  }
  await pushList(env.KV, 'alerts', record, 200);
  return record;
}

const money = (m) => (m && Number.isFinite(Number(m.amount)) ? `$${(Number(m.amount) / 100).toFixed(2)}` : '');

function lineSummary(order) {
  const items = (order && Array.isArray(order.line_items)) ? order.line_items : [];
  return items.map(li => ({
    name: li.name || li.variation_name || 'item',
    qty: Number(li.quantity) || 1,
    note: li.note || '',
    sku: (li.note && /tcg:(\d+)/.exec(li.note) || [])[1] || null,
  }));
}

async function markHook(env, type, ok, note) {
  const last = (await getJSON(env.KV, 'square:hooks:last', {})) || {};
  last[type] = { at: new Date().toISOString(), ok: !!ok, ...(note ? { note } : {}) };
  await putJSON(env.KV, 'square:hooks:last', last);
}

async function onInventoryCount(env, event) {
  const counts = (event.data && event.data.object && event.data.object.inventory_counts) || [];
  let made = 0;
  for (const c of counts) {
    const obj = c.catalog_object_id || 'unknown';
    const key = `square:count:${obj}`;
    if (await env.KV.get(key)) continue; // one alert per catalog object per hour
    await env.KV.put(key, '1', { expirationTtl: COALESCE_SEC });
    const qty = c.quantity != null ? String(c.quantity) : '?';
    const msg = qty === '0'
      ? `Sold out in Square: catalog item ${obj} — pull the TCGplayer listing`
      : `Square stock changed: catalog item ${obj} now ${qty} (${c.state || 'IN_STOCK'}) — update the TCGplayer listing`;
    await appendAlert(env, { ch: 'TCGplayer', msg, source: 'square:inventory.count.updated', catalogObjectId: obj, quantity: qty });
    made++;
  }
  return made;
}

async function onOrderCreated(env, event) {
  const oc = (event.data && event.data.object && (event.data.object.order_created || event.data.object.order)) || {};
  const sqId = oc.order_id || oc.id || (event.data && event.data.id) || null;
  // Our own Payment Link orders are announced by payment.updated instead.
  if (sqId && await getJSON(env.KV, `order:sq:${sqId}`, null)) return 0;
  const order = await retrieveOrder(env, sqId);
  const src = order && order.source && order.source.name;
  if (src && /payment link/i.test(src)) return 0;
  const lines = lineSummary(order);
  if (!lines.length) {
    await appendAlert(env, { ch: 'TCGplayer', msg: `Sold in-store (Square): order ${sqId || '?'} — check the case against the TCGplayer listings`,
      source: 'square:order.created', squareOrderId: sqId });
    return 1;
  }
  for (const li of lines) {
    await appendAlert(env, { ch: 'TCGplayer', msg: `Sold in-store (Square): ${li.name}${li.qty > 1 ? ` x${li.qty}` : ''} — update the TCGplayer listing`,
      source: 'square:order.created', squareOrderId: sqId, sku: li.sku ? `tcg:${li.sku}` : null });
  }
  return lines.length;
}

async function onPaymentUpdated(env, event) {
  const p = (event.data && event.data.object && event.data.object.payment) || {};
  const status = String(p.status || '').toUpperCase();
  const sqOrderId = p.order_id || null;
  const ref = sqOrderId ? await getJSON(env.KV, `order:sq:${sqOrderId}`, null) : null;
  const ours = ref && ref.id ? await getJSON(env.KV, `order:${ref.id}`, null) : null;

  if (status === 'COMPLETED') {
    if (ours) {
      ours.status = 'paid';
      ours.paidAt = new Date().toISOString();
      ours.receiptUrl = p.receipt_url || null;
      ours.paymentId = p.id || null;
      await putJSON(env.KV, `order:${ours.id}`, ours, { expirationTtl: EVENT_TTL });
      for (const li of ours.lines || []) {
        await appendAlert(env, { ch: 'TCGplayer', msg: `Paid online (${ours.id}): ${li.name}${li.qty > 1 ? ` x${li.qty}` : ''} — pull from the case and reduce the TCGplayer listing`,
          source: 'square:payment.updated', orderId: ours.id, sku: li.id && li.id.startsWith('tcg-') ? `tcg:${li.id.slice(4)}` : null });
      }
      return (ours.lines || []).length;
    }
    await appendAlert(env, { ch: 'TCGplayer', msg: `Square payment ${money(p.amount_money)} completed${sqOrderId ? ` (order ${sqOrderId})` : ''} — update the TCGplayer listing if singles were sold`,
      source: 'square:payment.updated', squareOrderId: sqOrderId });
    return 1;
  }
  if ((status === 'FAILED' || status === 'CANCELED') && ours) {
    ours.status = 'failed';
    ours.error = `payment ${status.toLowerCase()}`;
    await putJSON(env.KV, `order:${ours.id}`, ours, { expirationTtl: EVENT_TTL });
  }
  return 0;
}

const HANDLERS = {
  'inventory.count.updated': onInventoryCount,
  'order.created': onOrderCreated,
  'payment.updated': onPaymentUpdated,
};

export function register(r) {
  r.post('/square/webhook', async ({ env, req, url }) => {
    const body = await req.text();
    const sig = req.headers.get('x-square-hmacsha256-signature');
    const notifyUrl = env.SQUARE_WEBHOOK_URL || url.toString();
    if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) throw new HttpError(401, 'SQUARE_WEBHOOK_SIGNATURE_KEY not set');
    if (!(await verifyWebhookSignature(env, notifyUrl, body, sig))) throw new HttpError(401, 'bad signature');

    let event;
    try { event = JSON.parse(body); } catch { return { ok: true, ignored: 'invalid JSON' }; }
    if (!event || typeof event !== 'object') return { ok: true, ignored: 'empty event' };
    const type = String(event.type || 'unknown');
    const eventId = event.event_id ? String(event.event_id) : null;

    if (eventId) {
      const key = `square:event:${eventId}`;
      if (await env.KV.get(key)) return { ok: true, type, duplicate: true };
      await putJSON(env.KV, key, { at: new Date().toISOString(), type, event }, { expirationTtl: EVENT_TTL });
    }

    const handler = HANDLERS[type];
    let alerts = 0, ok = true, note = null;
    if (handler) {
      try { alerts = await handler(env, event); }
      catch (e) { ok = false; note = e && e.message ? e.message : String(e); console.error('[square webhook]', type, note); }
    } else {
      note = 'unhandled type';
    }
    try { await markHook(env, type, ok, note); } catch {}
    return { ok: true, type, handled: !!handler, alerts };
  });
}
