// HTTP helpers shared by every route.
export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function allowedOrigin(env, req) {
  const origin = req.headers.get('origin') || '';
  const list = String(env.SITE_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin) return null;
  if (list.length === 0 || list.includes('*') || list.includes(origin)) return origin;
  return null;
}

export function corsHeaders(env, req) {
  const origin = allowedOrigin(env, req);
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

// Reads a JSON body with a size cap. Returns {} for empty bodies.
export async function readJson(req, maxBytes = 64 * 1024) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'body too large');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'body too large');
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid JSON'); }
}

export function clientIp(req) {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '0.0.0.0';
}

// Small validators so routes stay readable.
export const v = {
  str(x, { max = 500, min = 0, name = 'field' } = {}) {
    if (typeof x !== 'string') throw new HttpError(400, `${name} must be a string`);
    const s = x.trim();
    if (s.length < min) throw new HttpError(400, `${name} is required`);
    if (s.length > max) throw new HttpError(400, `${name} too long`);
    return s;
  },
  num(x, { min = -Infinity, max = Infinity, name = 'field' } = {}) {
    const n = Number(x);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} out of range`);
    return n;
  },
  email(x, { name = 'email' } = {}) {
    const s = v.str(x, { max: 200, min: 3, name });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, `${name} looks wrong`);
    return s.toLowerCase();
  },
  oneOf(x, list, { name = 'field' } = {}) {
    if (!list.includes(x)) throw new HttpError(400, `${name} must be one of ${list.join(', ')}`);
    return x;
  },
};
