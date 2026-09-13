import { requireRole } from '../lib/auth.js';
import { HttpError,v } from '../lib/http.js';
import {squareConfigured,squareRequest} from '../lib/square.js';
import { rateLimit } from '../lib/ratelimit.js';
import {claimCheckoutStatus,checkoutClaim,cancelClaimCheckout} from '../lib/claim-checkout.js';
async function board({env,req}){
  if(!env.LIVE_CLAIMS)throw new HttpError(503,'The shared claims board has not been connected');
  const id=env.LIVE_CLAIMS.idFromName('shop-stream');
  return env.LIVE_CLAIMS.get(id).fetch(req);
}
async function post(ctx){await rateLimit(ctx.env,'stream-claim:'+ctx.ip,{limit:60,windowSec:60});return board(ctx);}
export function register(r){
  r.get('/live/catalog',requireRole('staff'),async({env,url,ip})=>{
    if(!squareConfigured(env))throw new HttpError(503,'Connect Square to search its inventory');
    await rateLimit(env,'claim-catalog:'+ip,{limit:20,windowSec:60});
    const q=v.str(url.searchParams.get('q'),{min:2,max:100,name:'search'});
    const res=await squareRequest(env,'POST','/v2/catalog/search-catalog-items',{text_filter:q,enabled_location_ids:[env.SQUARE_LOCATION_ID],archived_state:'ARCHIVED_STATE_NOT_ARCHIVED',limit:20});
    if(!res.ok)throw new HttpError(502,'Square catalog search is unavailable');
    const items=[];
    for(const obj of res.body?.items||[]){
      const variations=obj.type==='ITEM_VARIATION'?[obj]:obj.item_data?.variations||[];
      for(const variation of variations){const d=variation.item_variation_data,loc=d?.location_overrides?.find(l=>l.location_id===env.SQUARE_LOCATION_ID);if(!d||variation.is_deleted||!(loc?.track_inventory??d.track_inventory))continue;
        const price=loc?.price_money||d.price_money;
        items.push({variationId:variation.id,name:[obj.item_data?.name,d.name].filter(Boolean).join(' · ').slice(0,120),sku:d.sku||'',price:price?.currency==='USD'?price.amount/100:null,tcgProductId:/^tcg[:-](\d+)(?:\b|$)/i.exec(d.sku||'')?.[1]||null});
      }
    }
    return {items:items.slice(0,20),more:!!res.body?.cursor||items.length>20};
  });
  r.get('/live/checkout/status',async({env})=>claimCheckoutStatus(env));
  r.post('/live/claims/:id/checkout',requireRole('staff'),async({env,params,ip})=>{await rateLimit(env,'claim-pay:'+ip,{limit:20,windowSec:60});return checkoutClaim(env,params.id);});
  r.post('/live/claims/:id/cancel-checkout',requireRole('staff'),async({env,params})=>cancelClaimCheckout(env,params.id));
  r.get('/live/claims',board);
  r.post('/live/claims',requireRole('staff'),post);
  r.put('/live/claims/:id',requireRole('staff'),post);
}
