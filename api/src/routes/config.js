// Site configuration (hours, banner, show, events, live state, links…).
//   GET /config          public  → merged {defaults ← KV "config"}
//   PUT /config          admin   → deep-merge patch into KV "config", returns merged config
//   DELETE /config       admin   → reset to defaults
// The shape is config.default.json. Unknown top-level keys are rejected so a typo
// in the admin UI cannot bloat the record.
import { getJSON, putJSON } from '../lib/kv.js';
import { HttpError, readJson } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { DEFAULT_CONFIG, deepMerge } from '../defaults.js';

const MAX_BYTES = 200 * 1024; // logo data-URLs are the only big thing

export async function loadConfig(env) {
  const stored = await getJSON(env.KV, 'config', {});
  return deepMerge(DEFAULT_CONFIG, stored || {});
}

export function register(r) {
  r.get('/config', async ({ env }) => loadConfig(env));

  r.put('/config', requireRole('admin'), async ({ env, req }) => {
    const patch = await readJson(req, MAX_BYTES);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'patch must be an object');
    const allowed = new Set(Object.keys(DEFAULT_CONFIG));
    for (const k of Object.keys(patch)) {
      if (!allowed.has(k)) throw new HttpError(400, `unknown setting "${k}"`);
    }
    if (typeof patch.logo === 'string' && patch.logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(patch.logo)) {
      throw new HttpError(400, 'logo must be a PNG/JPEG/WebP/SVG data URL');
    }
    const stored = (await getJSON(env.KV, 'config', {})) || {};
    const next = deepMerge(stored, patch);
    next.updatedAt = new Date().toISOString();
    await putJSON(env.KV, 'config', next);
    return deepMerge(DEFAULT_CONFIG, next);
  });

  r.delete('/config', requireRole('admin'), async ({ env }) => {
    await env.KV.delete('config');
    return DEFAULT_CONFIG;
  });
}
