// Minimal router: patterns like "/forms/:kind". Handlers receive a ctx object
// ({req, env, exec, url, params, ip, auth}) and return a Response or a plain
// object (serialized as JSON 200). Throw HttpError for error responses.
import { HttpError, json } from './http.js';

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z0-9_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  async handle(ctx) {
    const path = ctx.url.pathname;
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== ctx.req.method) continue;
      ctx.params = {};
      r.keys.forEach((k, i) => {
        try { ctx.params[k] = decodeURIComponent(m[i + 1]); }
        catch { throw new HttpError(400, 'bad path encoding'); }
      });
      let result;
      for (const h of r.handlers) {
        result = await h(ctx);
        if (result instanceof Response) return result;
      }
      if (result === undefined) return json({ ok: true });
      return json(result);
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method not allowed' : 'not found');
  }
}
