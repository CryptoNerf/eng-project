// Free, key-less EN->RU translation via Google's public `gtx` endpoint.
// Results are cached in-memory per (text|target) to avoid re-requests.

const cache = new Map();
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

async function translateOne(text, target = 'ru', source = 'en') {
  const key = `${source}|${target}|${text}`;
  if (cache.has(key)) return cache.get(key);

  const params = new URLSearchParams({
    client: 'gtx',
    sl: source,
    tl: target,
    dt: 't',
    q: text,
  });

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Translate HTTP ${res.status}`);
  const data = await res.json();
  // data[0] is an array of [translatedChunk, originalChunk, ...]
  const translated = (data?.[0] || [])
    .map((chunk) => chunk?.[0] || '')
    .join('')
    .trim();
  const result = translated || text;
  cache.set(key, result);
  return result;
}

/** Run async tasks with a bounded concurrency, preserving input order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = null; // leave failed entries null; caller falls back
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Translate an array of strings EN->target. Returns array aligned to input.
 * Failed items fall back to the original text.
 */
export async function translateBatch(texts, target = 'ru') {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const out = await mapLimit(texts, 8, (t) => translateOne(String(t), target));
  return out.map((v, i) => (v == null ? texts[i] : v));
}
