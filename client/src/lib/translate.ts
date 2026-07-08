// EN→RU translation via Google's public key-less `gtx` endpoint, called
// directly from the browser (the endpoint returns `Access-Control-Allow-Origin: *`).
// Each user translates from their own IP — no server, no shared quota.

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const cache = new Map<string, string>();

async function translateOne(text: string, target: string, source: string): Promise<string> {
  const key = `${source}|${target}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const params = new URLSearchParams({
    client: 'gtx',
    sl: source,
    tl: target,
    dt: 't',
    q: text,
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const data: unknown[][] = await res.json();
  const translated = ((data?.[0] as unknown[][]) || [])
    .map((chunk) => (chunk?.[0] as string) || '')
    .join('')
    .trim();
  const result = translated || text;
  cache.set(key, result);
  return result;
}

/** Run async tasks with bounded concurrency, preserving input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results = new Array<R | null>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = await fn(items[i]);
        } catch {
          results[i] = null;
        }
      }
    }),
  );
  return results;
}

/**
 * Translate an array of strings EN→target. Returns an array aligned to the
 * input; failed items fall back to the original text.
 */
export async function translateBatch(texts: string[], target = 'ru'): Promise<string[]> {
  if (texts.length === 0) return [];
  const out = await mapLimit(texts, 6, (t) => translateOne(String(t), target, 'en'));
  return out.map((v, i) => (v == null ? texts[i] : v));
}
