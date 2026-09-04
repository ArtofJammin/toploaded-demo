// Fixed-window rate limiter on KV. Good enough to stop form spam; KV is
// eventually consistent so treat limits as approximate.
import { HttpError } from './http.js';

export async function rateLimit(env, key, { limit = 10, windowSec = 600 } = {}) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const n = Number((await env.KV.get(k)) || 0) + 1;
  await env.KV.put(k, String(n), { expirationTtl: windowSec + 60 });
  if (n > limit) {
    const retryAfter = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
    const err = new HttpError(429, 'slow down — try again in a few minutes', { retryAfter });
    err.retryAfter = retryAfter;
    throw err;
  }
  return n;
}
