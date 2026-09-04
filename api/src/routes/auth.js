// Passcode login.
//   POST /auth/login {pin}   → {token, role, exp}   (rate limited: 5 tries / 10 min per IP, Retry-After on 429)
//   GET  /auth/me            → {role, exp} or 401
//   POST /auth/logout        → {ok, revoked} (the bearer token is denylisted until it expires)
import { readJson, HttpError } from '../lib/http.js';
import { roleForPin, signToken, revokeToken } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';

export function register(r) {
  r.post('/auth/login', async ({ env, req, ip }) => {
    await rateLimit(env, `login:${ip}`, { limit: 5, windowSec: 600 });
    const body = await readJson(req, 4096);
    const role = await roleForPin(env, body.pin);
    if (!role) throw new HttpError(401, 'wrong passcode');
    const ttlSec = 12 * 3600;
    const token = await signToken(env, { role, ttlSec });
    return { token, role, exp: Math.floor(Date.now() / 1000) + ttlSec };
  });
  r.get('/auth/me', async ({ auth }) => {
    if (!auth) throw new HttpError(401, 'login required');
    return { role: auth.role, exp: auth.exp };
  });
  r.post('/auth/logout', async ({ env, req }) => {
    const h = req.headers.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    const revoked = token ? await revokeToken(env, token) : false;
    return { ok: true, revoked };
  });
}
