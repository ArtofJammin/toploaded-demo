// The site's default settings. Same file the page build inlines, so the worker
// and the browser always agree on the config shape.
import defaults from '../../config.default.json' with { type: 'json' };
export const DEFAULT_CONFIG = defaults;

// Deep merge: objects merge, arrays and scalars replace.
export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice();
  if (!b || typeof b !== 'object') return b;
  const out = (a && typeof a === 'object' && !Array.isArray(a)) ? { ...a } : {};
  for (const [k, val] of Object.entries(b)) {
    out[k] = (val && typeof val === 'object' && !Array.isArray(val)) ? deepMerge(out[k], val) : (Array.isArray(val) ? val.slice() : val);
  }
  return out;
}
