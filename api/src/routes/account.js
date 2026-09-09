// Customer sessions are deliberately separate from staff passcodes/tokens.
// High-entropy emailed codes (128 bits), hashed at rest. No customer balance writes.
import { getJSON, putJSON } from '../lib/kv.js';
import { HttpError, readJson, v, json } from '../lib/http.js';
import { sha256hex } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { sendEmail } from '../lib/email.js';

const CODE_TTL = 600, SESSION_TTL = 12 * 3600;
const random = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
const privateJSON = (data) => json(data, 200, { 'cache-control': 'no-store, private' });
export const accountConfigured = (env) => !!(env.KV && env.RESEND_API_KEY && env.EMAIL_FROM);
function available(env) { if (!accountConfigured(env)) throw new HttpError(503, 'Customer sign-in is not connected yet. Please contact the shop.'); }
function bearer(req) { return (req.headers.get('authorization') || '').replace(/^Bearer /, ''); }
async function session(env, req) {
  if (!env.KV) throw new HttpError(503, 'Customer sign-in is not connected yet.');
  const token = bearer(req);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Please sign in again.');
  const key = 'account:session:' + await sha256hex(token);
  const data = await getJSON(env.KV, key);
  if (!data || data.exp <= Date.now()) throw new HttpError(401, 'Your session expired. Please sign in again.');
  return { ...data, key };
}

export function register(r) {
  r.get('/account/status', async ({ env }) => privateJSON({ enabled: accountConfigured(env) }));
  r.post('/account/code', async ({ env, req, ip }) => {
    available(env);
    await rateLimit(env, 'account-send:' + ip, { limit: 5, windowSec: 600 });
    const email = v.email((await readJson(req, 2048)).email);
    await rateLimit(env, 'account-email:' + await sha256hex(email), { limit: 3, windowSec: 600 });
    const challenge = random(16), code = random(16);
    const key = 'account:code:' + challenge;
    await putJSON(env.KV, key, { email, hash: await sha256hex(code), exp: Date.now() + CODE_TTL * 1000, attempts: 0 }, { expirationTtl: CODE_TTL });
    let result;
    try {
      result = await sendEmail(env, { to: email, subject: 'Your Top Loaded sign-in code',
        text: 'Paste this sign-in code into the Top Loaded account page:\n\n' + code + '\n\nIt expires in 10 minutes. Never share it with anyone, including shop staff. If you did not request it, ignore this email.' });
    } catch { result = { sent: false }; }
    if (!result.sent) { await env.KV.delete(key); throw new HttpError(503, 'We could not send the code. Please try again later.'); }
    // Same response whether or not this email has a credit ledger. Never enumerate customers.
    return privateJSON({ ok: true, challenge, expiresIn: CODE_TTL });
  });
  r.post('/account/verify', async ({ env, req, ip }) => {
    available(env);
    await rateLimit(env, 'account-verify:' + ip, { limit: 20, windowSec: 600 });
    const body = await readJson(req, 2048);
    const challenge = v.str(body.challenge, { min: 32, max: 32, name: 'challenge' });
    const code = v.str(body.code, { min: 1, max: 64, name: 'code' }).replace(/\s/g, '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(challenge)) throw new HttpError(400, 'Invalid challenge.');
    const key = 'account:code:' + challenge, data = await getJSON(env.KV, key);
    if (!data || data.exp <= Date.now() || data.attempts >= 5) throw new HttpError(401, 'Code expired or invalid. Request a new one.');
    data.attempts++;
    await putJSON(env.KV, key, data, { expirationTtl: Math.max(60, Math.ceil((data.exp - Date.now()) / 1000)) });
    if (await sha256hex(code) !== data.hash) throw new HttpError(401, 'Code expired or invalid. Request a new one.');
    await env.KV.delete(key);
    const token = random(32), exp = Date.now() + SESSION_TTL * 1000;
    await putJSON(env.KV, 'account:session:' + await sha256hex(token), { email: data.email, exp }, { expirationTtl: SESSION_TTL });
    return privateJSON({ token, exp });
  });
  r.get('/account/me', async ({ env, req, ip }) => {
    const who = await session(env, req);
    await rateLimit(env, 'account-read:' + ip, { limit: 60, windowSec: 60 });
    const index = await getJSON(env.KV, 'credit:index', []), matches = [];
    // Read the authoritative customer, including older index entries that don't carry email.
    for (const entry of index) {
      if (typeof entry.email === 'string' && entry.email.trim().toLowerCase() !== who.email) continue;
      const customer = await getJSON(env.KV, 'credit:' + entry.id);
      if (customer && String(customer.email || '').trim().toLowerCase() === who.email) matches.push(customer);
      if (matches.length > 1) break;
    }
    if (matches.length !== 1) return privateJSON({ email: who.email, linked: false, needsReview: matches.length > 1 });
    const c = matches[0], entries = await getJSON(env.KV, 'credit:log:' + c.id, []);
    return privateJSON({ email: who.email, linked: true,
      customer: { name: c.name, balance: c.balance, updatedAt: c.updatedAt },
      entries: entries.slice(0, 50).map(e => ({ at: e.at, kind: e.kind, amount: e.credited, balanceAfter: e.balanceAfter })) });
  });
  r.post('/account/logout', async ({ env, req }) => {
    const who = await session(env, req);
    await env.KV.delete(who.key);
    return privateJSON({ ok: true });
  });
}
