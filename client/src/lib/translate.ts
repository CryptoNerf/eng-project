// EN→RU translation via Google's public key-less `gtx` endpoint, called
// directly from the browser (the endpoint returns `Access-Control-Allow-Origin: *`).
// Each user translates from their own IP — no server, no shared quota.

import type { Sense } from './types';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const cache = new Map<string, string>();
const senseCache = new Map<string, Sense[]>();

// Google returns parts of speech in English; show them in Russian, short.
const POS_RU: Record<string, string> = {
  noun: 'сущ.',
  verb: 'глаг.',
  adjective: 'прил.',
  adverb: 'нареч.',
  pronoun: 'мест.',
  preposition: 'предл.',
  conjunction: 'союз',
  interjection: 'межд.',
  abbreviation: 'сокр.',
  numeral: 'числ.',
  particle: 'частица',
  exclamation: 'воскл.',
};

const MAX_SENSES_PER_POS = 4;

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

export interface WordTranslation {
  translation: string;
  senses: Sense[];
}

/**
 * Translate a single word AND collect its dictionary meanings grouped by part
 * of speech. One request (`dt=bd` rides along with `dt=t`), so seeing that a
 * word has several meanings costs nothing extra.
 */
async function translateWordOne(word: string, target: string): Promise<WordTranslation> {
  const key = `en|${target}|${word}`;
  const cachedSenses = senseCache.get(key);
  if (cachedSenses) return { translation: cache.get(key) || word, senses: cachedSenses };

  const params = new URLSearchParams({ client: 'gtx', sl: 'en', tl: target, q: word });
  params.append('dt', 't');
  params.append('dt', 'bd'); // bd = bilingual dictionary (all meanings by POS)

  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const data: unknown[] = await res.json();

  const translation =
    ((data?.[0] as unknown[][]) || [])
      .map((chunk) => (chunk?.[0] as string) || '')
      .join('')
      .trim() || word;

  const senses: Sense[] = [];
  for (const entry of (data?.[1] as unknown[][]) || []) {
    const posRaw = String(entry?.[0] || '').toLowerCase();
    const meanings = ((entry?.[1] as string[]) || []).slice(0, MAX_SENSES_PER_POS);
    if (meanings.length === 0) continue;
    senses.push({ pos: POS_RU[posRaw] || posRaw, meanings });
  }

  cache.set(key, translation);
  senseCache.set(key, senses);
  return { translation, senses };
}

/** Translate words with their dictionary meanings; aligned to input order. */
export async function translateWords(
  words: string[],
  target = 'ru',
): Promise<WordTranslation[]> {
  if (words.length === 0) return [];
  const out = await mapLimit(words, 6, (w) => translateWordOne(String(w), target));
  return out.map((v, i) => v ?? { translation: words[i], senses: [] });
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
