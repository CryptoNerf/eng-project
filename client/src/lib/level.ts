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

/**
 * Vocabulary size from the answers: for every band, the share of words known,
 * times the band's width.
 *
 * Guessing is corrected for only among items the user actually attempted — an
 * explicit «не знаю» involves no guess, so penalising it as one would
 * understate the result. Skipped items simply count as unknown.
 *
 * Recognition is monotone in frequency, so the running share is clamped to be
 * non-increasing across bands: one lucky guess deep in the rare words must not
 * outweigh a whole band the user actually failed.
 */
export function estimateVocabulary(items: TestItem[], answers: Answer[]): number {
  const stats = BANDS.map(() => ({ ok: 0, tried: 0, n: 0 }));
  items.forEach((item, i) => {
    const s = stats[item.band];
    s.n++;
    if (answers[i] === 'skip') return;
    s.tried++;
    if (answers[i] === 'ok') s.ok++;
  });

  let ceiling = 1;
  let total = 0;
  BANDS.forEach(([from, to], band) => {
    const { ok, tried, n } = stats[band];
    // A band whose items were all dropped inherits the level around it rather
    // than counting as zero.
    if (n > 0) {
      const corrected =
        tried > 0 ? Math.max(0, (ok / tried - 1 / OPTIONS) / (1 - 1 / OPTIONS)) : 0;
      ceiling = Math.min(ceiling, (corrected * tried) / n);
    }
    total += ceiling * (to - from);
  });

  return Math.round(total);
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
