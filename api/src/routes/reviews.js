// Google reviews are fetched server-side; API keys never reach the public page.
// No provider content is persisted. Curated, attributed TCGplayer reviews remain supported.
import { loadConfig } from './config.js';
import { rateLimit } from '../lib/ratelimit.js';
import { HttpError } from '../lib/http.js';
export function register(r){
  r.get('/reviews',async ({env,ip})=>{
    const cfg=await loadConfig(env),rv=cfg.reviews||{},min=rv.minRating||5;
    const items=(rv.items||[]).filter(t=>t.rating>=min&&(t.source!=='google'||t.rating===5));
    if(rv.source!=='google')return {items,mode:'curated',minRating:min};
    const terms=env.GOOGLE_REVIEWS_TERMS_URL,privacy=env.GOOGLE_REVIEWS_PRIVACY_URL;
    if(!env.GOOGLE_PLACES_API_KEY||!rv.googlePlaceId||![terms,privacy].every(u=>typeof u==='string'&&/^https:\/\//.test(u)))
      return {items,mode:'setup-required',minRating:min};
    await rateLimit(env,`reviews:${ip}`,{limit:6,windowSec:600});
    const response=await fetch('https://places.googleapis.com/v1/places/'+encodeURIComponent(rv.googlePlaceId),{
      headers:{'X-Goog-Api-Key':env.GOOGLE_PLACES_API_KEY,'X-Goog-FieldMask':'reviews,googleMapsUri'},signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new HttpError(502,'Google reviews are temporarily unavailable');
    const place=await response.json();
    const fetched=(place.reviews||[]).filter(t=>t.rating===5&&t.text?.text).map(t=>({
      quote:t.text.text,who:t.authorAttribution?.displayName||'Google reviewer',rating:t.rating,source:'google',
      url:t.googleMapsUri||place.googleMapsUri,authorUrl:t.authorAttribution?.uri,photo:t.authorAttribution?.photoUri,at:t.publishTime}));
    return {items:[...fetched,...items.filter(t=>t.source!=='google')].slice(0,6),mode:'google',minRating:min,allReviews:place.googleMapsUri,terms,privacy};
  });
}
