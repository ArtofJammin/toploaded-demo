// KV conveniences. Keys are namespaced by feature ("config", "form:vendor:<id>",
// "credit:<customerId>", "alerts", "spots", "chat", "rl:<ip>:<bucket>", …).
export async function getJSON(kv, key, fallback = null) {
  const v = await kv.get(key, 'json');
  return v === null || v === undefined ? fallback : v;
}
export async function putJSON(kv, key, value, opts = {}) {
  await kv.put(key, JSON.stringify(value), opts);
  return value;
}
// Lists every value under a prefix (KV list pages at 1000 keys; fine for a shop).
export async function listJSON(kv, prefix, { limit = 200 } = {}) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: Math.min(1000, limit) });
    for (const k of page.keys) {
      if (out.length >= limit) break;
      const val = await kv.get(k.name, 'json');
      if (val !== null) out.push({ key: k.name, value: val });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < limit);
  return out;
}
// Append to a bounded list stored under one key (newest first).
export async function pushList(kv, key, item, max = 200) {
  const list = (await getJSON(kv, key, [])) || [];
  list.unshift(item);
  if (list.length > max) list.length = max;
  await putJSON(kv, key, list);
  return list;
}
