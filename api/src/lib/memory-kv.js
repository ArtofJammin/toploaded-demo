// In-memory stand-in for a Cloudflare KV namespace. Used by the local dev server
// (optionally persisted to a JSON file) and by the tests.
export class MemoryKV {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); this.exp = new Map(); }
  _live(key) {
    const e = this.exp.get(key);
    if (e && e < Date.now()) { this.map.delete(key); this.exp.delete(key); return false; }
    return this.map.has(key);
  }
  async get(key, type) {
    if (!this._live(key)) return null;
    const v = this.map.get(key);
    if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }
  async put(key, value, opts = {}) {
    this.map.set(key, typeof value === 'string' ? value : String(value));
    if (opts.expirationTtl) this.exp.set(key, Date.now() + opts.expirationTtl * 1000);
    else if (opts.expiration) this.exp.set(key, opts.expiration * 1000);
    else this.exp.delete(key);
    this.onChange && this.onChange();
  }
  async delete(key) { this.map.delete(key); this.exp.delete(key); this.onChange && this.onChange(); }
  async list({ prefix = '', cursor, limit = 1000 } = {}) {
    const keys = [...this.map.keys()].filter(k => k.startsWith(prefix) && this._live(k)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = keys.slice(start, start + limit);
    const done = start + limit >= keys.length;
    return { keys: slice.map(name => ({ name })), list_complete: done, cursor: done ? undefined : String(start + limit) };
  }
  toJSON() { return Object.fromEntries([...this.map.entries()].filter(([k]) => this._live(k))); }
}
