// Measuring the user's vocabulary instead of assuming it.
//
// Readiness is only honest if the vocabulary it assumes is the user's own.
// This is a standard frequency-band vocabulary test: sample words across the
// frequency list, see where recognition breaks down, and extrapolate.
//
// It asks the user to PICK a translation rather than to self-report «знаю» —
// self-report inflates, and inflated input is exactly what made every video
// look 80% understandable in the first place.

import { STOPWORDS } from './stopwords';
import { lemmaOf, VOCAB_SIZE, wordAtRank } from './words';

/**
 * Frequency bands to probe: [from, to, probes). A band's width is its weight in
 * the final estimate, so the wide ones at the top get an extra question — there
 * a single lucky or unlucky answer would otherwise swing the result by 2000
 * words.
 */
const BANDS: [number, number, number][] = [
  [0, 500, 2],
  [500, 1000, 2],
  [1000, 1500, 2],
  [1500, 2000, 2],
  [2000, 3000, 2],
  [3000, 4000, 2],
  [4000, 6000, 3],
  [6000, 8000, 3],
  [8000, 10000, 3],
];

export const TEST_LENGTH = BANDS.reduce((n, b) => n + b[2], 0);
const OPTIONS = 4;

export interface TestItem {
  word: string;
  rank: number;
  band: number;
  options: string[]; // shuffled; the correct one is `answer`
  answer: string;
}

/** Words to probe, plus the pool we need translations for. */
export function pickTestWords(exclude: Set<string> = new Set()): {
  probes: { word: string; rank: number; band: number }[];
  distractors: string[];
} {
  const probes: { word: string; rank: number; band: number }[] = [];
  const used = new Set<string>();

  BANDS.forEach(([from, to, want], band) => {
    let picked = 0;
    for (let guard = 0; guard < 300 && picked < want; guard++) {
      const rank = from + Math.floor(Math.random() * (Math.min(to, VOCAB_SIZE) - from));
      const word = wordAtRank(rank);
      if (!word || used.has(word) || exclude.has(word) || !testable(word)) continue;
      used.add(word);
      probes.push({ word, rank, band });
      picked++;
    }
  });

  // Wrong options come from ranks far from the probe, so they read as
  // plausible Russian words but can't accidentally be a second meaning.
  const distractors: string[] = [];
  for (let i = 0; i < TEST_LENGTH * 2; i++) {
    const rank = Math.floor(Math.random() * Math.min(6000, VOCAB_SIZE));
    const word = wordAtRank(rank);
    if (word && !used.has(word) && testable(word)) {
      used.add(word);
      distractors.push(word);
    }
  }
  return { probes, distractors };
}

/**
 * Only base forms of content words make fair probes: «that» has no meaningful
 * translation on its own and «starts» tests inflection, not vocabulary.
 */
function testable(word: string): boolean {
  return word.length >= 3 && !STOPWORDS.has(word) && lemmaOf(word) === word;
}

/** Assemble multiple-choice items once the translations are in. */
export function buildItems(
  probes: { word: string; rank: number; band: number }[],
  probeRu: string[],
  distractorRu: string[],
): TestItem[] {
  // Wrong options must look exactly like right ones. Require Cyrillic
  // (translateBatch echoes the source back on failure) and reject capitalised
  // proper nouns — «Андерсон» among four options is a giveaway.
  const pool = distractorRu.filter(
    (t) => t && t.length > 1 && /[а-яё]/i.test(t) && t[0] === t[0].toLocaleLowerCase('ru'),
  );
  const items: TestItem[] = [];

  probes.forEach((p, i) => {
    const answer = (probeRu[i] || '').trim();
    // no usable translation — drop the item rather than test nothing
    if (!answer || !/[а-яё]/i.test(answer)) return;
    // A capitalised translation means a proper noun: the frequency list is
    // web-crawled and carries names and brands («moscow» → «Москва»).
    // Transliteration is recognisable to anyone, so such items measure nothing.
    if (answer[0] !== answer[0].toLocaleLowerCase('ru')) return;
    const wrong: string[] = [];
    const seen = new Set([answer.toLowerCase()]);
    for (let guard = 0; guard < 200 && wrong.length < OPTIONS - 1; guard++) {
      const cand = pool[Math.floor(Math.random() * pool.length)]?.trim();
      if (!cand || seen.has(cand.toLowerCase())) continue;
      seen.add(cand.toLowerCase());
      wrong.push(cand);
    }
    if (wrong.length < OPTIONS - 1) return;
    items.push({
      word: p.word,
      rank: p.rank,
      band: p.band,
      answer,
      options: shuffle([answer, ...wrong]),
    });
  });

  return items;
}

/** What the user did with one item. «skip» is an explicit «не знаю». */
export type Answer = 'ok' | 'miss' | 'skip';

/** Per-band outcome, shown to the user so the estimate isn't a black box. */
export interface BandResult {
  from: number;
  to: number;
  asked: number;
  ok: number;
  share: number; // 0..1 known, after guess-correction and smoothing
}

export interface Estimate {
  vocabulary: number;
  bands: BandResult[];
}

/**
 * Vocabulary size from the answers: for every frequency band, the share of
 * words known, times the band's width.
 *
 * Guessing is corrected for only among items the user actually attempted — an
 * explicit «не знаю» involves no guess, so penalising it as one would
 * understate the result. Skipped items count as unknown.
 *
 * Recognition can only fall as words get rarer, so the per-band shares are
 * fitted with isotonic regression (pool adjacent violators). An earlier
 * running-minimum version was far too harsh: one unlucky band with two
 * questions zeroed out everything rarer than it.
 */
export function estimateVocabulary(items: TestItem[], answers: Answer[]): Estimate {
  const stats = BANDS.map(() => ({ ok: 0, tried: 0, n: 0 }));
  items.forEach((item, i) => {
    const s = stats[item.band];
    s.n++;
    if (answers[i] === 'skip') return;
    s.tried++;
    if (answers[i] === 'ok') s.ok++;
  });

  // raw share per band, corrected for 1-in-4 guessing among attempts
  const asked: number[] = [];
  const raw: number[] = [];
  stats.forEach(({ ok, tried, n }) => {
    asked.push(n);
    if (n === 0) {
      raw.push(NaN);
      return;
    }
    // deliberately NOT clamped at zero here: with 2-3 questions per band,
    // clamping each band separately lets noise only ever push the estimate up
    // (a pure guesser scored ~1300 words that way). Negative slack cancels
    // across bands during the fit instead; the result is clamped afterwards.
    const hit = tried > 0 ? (ok / tried - 1 / OPTIONS) / (1 - 1 / OPTIONS) : 0;
    raw.push((hit * tried) / n);
  });

  const fitted = fillGaps(isotonic(raw, asked)).map((v) => Math.min(1, Math.max(0, v)));

  let vocabulary = 0;
  const bands: BandResult[] = BANDS.map(([from, to], i) => {
    vocabulary += fitted[i] * (to - from);
    return { from, to, asked: stats[i].n, ok: stats[i].ok, share: fitted[i] };
  });

  return { vocabulary: Math.round(vocabulary), bands };
}

/** Best non-increasing fit of `values` weighted by `weights` (PAVA). */
function isotonic(values: number[], weights: number[]): number[] {
  const blocks: { sum: number; w: number; from: number; to: number }[] = [];
  values.forEach((v, i) => {
    if (Number.isNaN(v) || weights[i] === 0) return; // untested band
    let b = { sum: v * weights[i], w: weights[i], from: i, to: i };
    while (blocks.length) {
      const prev = blocks[blocks.length - 1];
      if (prev.sum / prev.w >= b.sum / b.w) break; // already non-increasing
      blocks.pop();
      b = { sum: prev.sum + b.sum, w: prev.w + b.w, from: prev.from, to: b.to };
    }
    blocks.push(b);
  });

  const out = values.map(() => NaN);
  for (const b of blocks) {
    const mean = b.sum / b.w;
    for (let i = b.from; i <= b.to; i++) if (!Number.isNaN(values[i])) out[i] = mean;
  }
  return out;
}

/** A band whose questions were all dropped inherits its nearest neighbour. */
function fillGaps(v: number[]): number[] {
  const out = [...v];
  let last = 1;
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(out[i])) out[i] = last;
    else last = out[i];
  }
  return out;
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
