import { requireRole } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import { rateLimit } from '../lib/ratelimit.js';
async function board({env,req}){
  if(!env.LIVE_CLAIMS)throw new HttpError(503,'The shared claims board has not been connected');
  const id=env.LIVE_CLAIMS.idFromName('shop-stream');
  return env.LIVE_CLAIMS.get(id).fetch(req);
}
async function post(ctx){await rateLimit(ctx.env,'stream-claim:'+ctx.ip,{limit:60,windowSec:60});return board(ctx);}
export function register(r){
  r.get('/live/claims',board);
  r.post('/live/claims',requireRole('staff'),post);
  r.put('/live/claims/:id',requireRole('staff'),post);
}
