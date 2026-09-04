// Passcode login.
//   POST /auth/login {pin}   → {token, role, exp}   (rate limited: 8 tries / 10 min per IP)
//   GET  /auth/me            → {role, exp} or 401
//   POST /auth/logout        → {ok} (tokens are stateless; the client just forgets it)
import { readJson, HttpError } from '../lib/http.js';
import { roleForPin, signToken } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';

export function register(r) {
  r.post('/auth/login', async ({ env, req, ip }) => {
    await rateLimit(env, `login:${ip}`, { limit: 8, windowSec: 600 });
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
  r.post('/auth/logout', async () => ({ ok: true }));
}
