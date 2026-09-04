// Passcode login + HMAC-signed bearer tokens. Two roles: "staff" and "admin";
// admin satisfies any staff-only check. Passcode hashes live in secrets
// (STAFF_PIN_HASH / ADMIN_PIN_HASH = sha256 hex of the passcode). Tokens are
// base64url(JSON{role,iat,exp}) + "." + base64url(HMAC-SHA256(TOKEN_SECRET, payload)).
import { HttpError } from './http.js';

const enc = new TextEncoder();

export async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64url(bytes) {
  let s = typeof bytes === 'string' ? btoa(bytes) : btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(env, { role, ttlSec = 12 * 3600 }) {
  const secret = env.TOKEN_SECRET;
  if (!secret) throw new HttpError(500, 'TOKEN_SECRET not configured');
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ role, iat: now, exp: now + ttlSec }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return payload + '.' + b64url(new Uint8Array(sig));
}

export async function verifyToken(env, token) {
  if (!token || !env.TOKEN_SECRET) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    if (env.KV && await env.KV.get('revoked:' + sig)) return null;
    const sigBytes = Uint8Array.from(unb64url(sig), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.TOKEN_SECRET), sigBytes, enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(unb64url(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (data.role !== 'staff' && data.role !== 'admin') return null;
    return data;
  } catch { return null; }
}

// Logout: remember the token's signature until it would have expired anyway.
export async function revokeToken(env, token) {
  if (!token || !env.KV) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  let exp = 0;
  try { exp = Number(JSON.parse(unb64url(payload)).exp) || 0; } catch { return false; }
  const ttl = Math.max(60, exp - Math.floor(Date.now() / 1000));
  await env.KV.put('revoked:' + sig, '1', { expirationTtl: ttl });
  return true;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Returns "admin" | "staff" | null for a passcode.
export async function roleForPin(env, pin) {
  if (typeof pin !== 'string' || !pin) return null;
  const h = await sha256hex(pin);
  if (env.ADMIN_PIN_HASH && timingSafeEqual(h, env.ADMIN_PIN_HASH.toLowerCase())) return 'admin';
  if (env.STAFF_PIN_HASH && timingSafeEqual(h, env.STAFF_PIN_HASH.toLowerCase())) return 'staff';
  return null;
}

// Populates ctx.auth from the Authorization header (null when absent/invalid).
export async function attachAuth(ctx) {
  const h = ctx.req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  ctx.auth = token ? await verifyToken(ctx.env, token) : null;
}

// Middleware factory: requireRole('staff') lets staff or admin through.
export function requireRole(role) {
  return (ctx) => {
    if (!ctx.auth) throw new HttpError(401, 'login required');
    if (role === 'admin' && ctx.auth.role !== 'admin') throw new HttpError(403, 'admin only');
  };
}
