import {HttpError} from './http.js';
import {squareConfigured,squareRequest,createPaymentLink,toCents} from './square.js';
import {putJSON} from './kv.js';

export function claimCheckoutStatus(env){
  const ready=env.CLAIM_CHECKOUT_ENABLED==='true'&&['sandbox','production'].includes(env.SQUARE_ENV)&&squareConfigured(env)&&!!env.LIVE_CLAIMS&&!!env.KV&&!!env.SQUARE_WEBHOOK_SIGNATURE_KEY&&!!env.SQUARE_WEBHOOK_URL&&!env.SQUARE_WEBHOOK_URL.includes('REPLACE');
  return {ready,mode:env.SQUARE_ENV==='production'?'production':'sandbox',inventory:'Square catalog variations; TCGplayer requires a separate authorized connector',reason:ready?'Connected: Square confirms payments and tracks catalog stock.':'Claim checkout is not activated. Connect Square, the signed webhook and shared backend, then complete the sales acceptance checks.'};
}
export async function claimInternal(env,id,action,body){
  if(!env.LIVE_CLAIMS)throw new HttpError(503,'Shared claims service not connected');
  const obj=env.LIVE_CLAIMS.get(env.LIVE_CLAIMS.idFromName('shop-stream'));
  const r=await obj.fetch(new Request('https://claims.internal/_checkout/'+encodeURIComponent(id)+(action?'/'+action:''),{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})}));
  const d=await r.json();if(!r.ok)throw new HttpError(r.status,d.error||'Claim update failed');return d.claim;
}
async function stock(env,id){
  const cat=await squareRequest(env,'GET','/v2/catalog/object/'+encodeURIComponent(id));
  const obj=cat.body?.object,v=obj?.item_variation_data;
  const location=v?.location_overrides?.find(o=>o.location_id===env.SQUARE_LOCATION_ID);
  if(!cat.ok||obj?.type!=='ITEM_VARIATION'||obj.id!==id||obj.is_deleted||!v||!(location?.track_inventory??v.track_inventory)||v.measurement_unit_id||location?.sold_out||obj.absent_at_location_ids?.includes(env.SQUARE_LOCATION_ID)||(obj.present_at_all_locations===false&&!obj.present_at_location_ids?.includes(env.SQUARE_LOCATION_ID)))throw new HttpError(409,'Select an active, inventory-tracked Square variation at this location');
  if(v.price_money?.currency && v.price_money.currency!=='USD')throw new HttpError(409,'This checkout requires USD inventory');
  const count=await squareRequest(env,'GET','/v2/inventory/'+encodeURIComponent(id)+'?location_ids='+encodeURIComponent(env.SQUARE_LOCATION_ID));
  if(!count.ok||!Array.isArray(count.body?.counts)||count.body.cursor)throw new HttpError(503,'Square inventory could not be verified');
  const rows=count.body.counts.filter(c=>c.catalog_object_id===id&&c.location_id===env.SQUARE_LOCATION_ID&&c.state==='IN_STOCK');
  const available=rows.length===1?Number(rows[0].quantity):0;
  if(!Number.isInteger(available)||available<1)throw new HttpError(409,'This Square variation is out of stock');
  return available;
}
export async function checkoutClaim(env,id){
  if(!claimCheckoutStatus(env).ready)throw new HttpError(503,claimCheckoutStatus(env).reason);
  let c=await claimInternal(env,id);
  if(c.status!=='claimed')throw new HttpError(409,'This claim is not awaiting payment');
  if(c.checkout?.url)return {url:c.checkout.url,orderId:c.checkout.ref,mode:env.SQUARE_ENV};
  if(!c.squareVariationId)throw new HttpError(409,'Attach the exact Square variation when posting the claim');
  const cents=toCents(c.price);if(!Number.isInteger(cents)||cents<1||cents>1000000)throw new HttpError(400,'Claim price must be $0.01–$10,000');
  const available=c.checkout?0:await stock(env,c.squareVariationId);
  const flat=Number(env.SHIPPING_CENTS??499),free=Number(env.FREE_SHIPPING_CENTS??10000);
  if(!Number.isInteger(flat)||flat<0||!Number.isInteger(free)||free<0)throw new HttpError(503,'Configure valid shipping amounts');
  c=await claimInternal(env,id,'begin',{available,shippingCents:c.fulfillment==='ship'&&cents<free?flat:0});
  // Persisted intent + stable key: a network timeout/retry never creates another checkout.
  const ref=c.checkout.ref,lines=[{id:c.tcgProductId?'tcg-'+c.tcgProductId:'claim-'+id,name:c.card,qty:1,cents,catalogObjectId:c.squareVariationId,note:c.tcgProductId?'tcg:'+c.tcgProductId:'Stream claim '+id}];
  const pl=await createPaymentLink(env,{lines,fulfillment:c.fulfillment,shippingCents:c.checkout.shippingCents,ref,idempotencyKey:id,redirectUrl:String(env.SITE_URL||'').replace(/\/?$/,'/')+'#/live',note:'Confirmed live stream claim'});
  const u=new URL(pl.url);if(u.protocol!=='https:'||!(u.hostname==='square.link'||u.hostname.endsWith('.square.link')||u.hostname.endsWith('.square.site')))throw new HttpError(502,'Square returned an unexpected checkout URL');
  if(!pl.id||!pl.orderId)throw new HttpError(502,'Square did not return the checkout identifiers');
  await claimInternal(env,id,'link',pl);
  const order={id:ref,claimId:id,status:'pending',mock:false,at:c.at,fulfillment:c.fulfillment,total:c.price+c.checkout.shippingCents/100,lines:lines.map(l=>({id:l.id,name:l.name,qty:1,price:c.price})),square:{orderId:pl.orderId,paymentLinkId:pl.id}};
  await putJSON(env.KV,'order:'+ref,order,{expirationTtl:30*86400});
  await putJSON(env.KV,'order:sq:'+pl.orderId,{id:ref},{expirationTtl:30*86400});
  return {url:pl.url,orderId:ref,mode:env.SQUARE_ENV};
}
export async function cancelClaimCheckout(env,id){
  const c=await claimInternal(env,id);
  if(c.status==='cancelled')return {ok:true};
  if(c.status==='paid'||c.status==='shipped')throw new HttpError(409,'Refund paid claims in Square');
  if(c.checkout){
    if(!c.checkout.paymentLinkId)throw new HttpError(409,'Recover the pending payment link before cancelling');
    const r=await squareRequest(env,'DELETE','/v2/online-checkout/payment-links/'+encodeURIComponent(c.checkout.paymentLinkId));
    if(!r.ok||r.body?.cancelled_order_id!==c.checkout.squareOrderId)throw new HttpError(409,'Square has not confirmed cancellation; check whether payment completed');
  }
  await claimInternal(env,id,'cancel',{});return {ok:true};
}
// Called only after signature validation. Never trust browser redirects, public
// status edits or a partial/foreign payment as proof of a paid claim.
export async function settleClaimPayment(env,p,order){
  const id=order?.reference_id?.startsWith('TL-CLAIM-')?order.reference_id.slice(9):null;
  if(!id)return null;
  const c=await claimInternal(env,id);
  const li=order.line_items?.filter(l=>l.catalog_object_id===c.squareVariationId)||[];
  if(p.status!=='COMPLETED'||!p.id||p.order_id!==order.id||p.location_id!==env.SQUARE_LOCATION_ID||order.location_id!==env.SQUARE_LOCATION_ID||!['OPEN','COMPLETED'].includes(order.state)||order.total_money?.currency!=='USD'||order.net_amount_due_money?.amount!==0||!Number.isInteger(order.total_money?.amount)||order.total_money.amount<toCents(c.price)+(c.checkout?.shippingCents||0)||li.length!==1||li[0].quantity!=='1'||li[0].base_price_money?.amount!==toCents(c.price)||!c.checkout)throw new HttpError(409,'Claim payment/order details are incomplete or do not match');
  await claimInternal(env,id,'paid',{orderId:order.id,paymentId:p.id});
  return {id:c.checkout.ref,claimId:id,at:c.at,fulfillment:c.fulfillment,mock:false,lines:[{id:c.tcgProductId?'tcg-'+c.tcgProductId:null,name:c.card,qty:1,price:c.price}]};
}
