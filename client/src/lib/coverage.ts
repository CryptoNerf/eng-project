// «Готовность к видео»: how much of what is actually SAID the user understands,
// and the shortest list of words that closes the gap.
//
// Deck size is a misleading goal. Words are distributed very unevenly, so a
// small, frequent minority carries most of the speech: in a 19-minute
// 3Blue1Brown video 76 of the deck's 564 words take understanding from 74% to
// 90%, while 225 words that occur exactly once are worth 7% between them.
//
// The number is only meaningful if the vocabulary it assumes is the USER'S.
// The 1000 most common English words alone already cover 71–74% of running
// speech in any video, so a fixed assumption makes every video report roughly
// the same «понятно ~80%» — a fact about English, not about the learner.
// Hence `knownRank` comes from a measured vocabulary test, and any word the
// user has actually acted on overrides the assumption.

import type { Card, DeckMeta, StoredCoverage } from './types';
import { isMastered, knownWeight, type WordsMap } from './vocab';
import { rankOf } from './words';

/** Storage shape version — older payloads are ignored until a deck rebuild. */
export const COVERAGE_V = 2;

/**
 * Two rungs, not one.
 *
 * The percentage badly needs interpreting: 74% known words sounds like «I get
 * most of it», but it means one word in four is unknown — about three unknown
 * words in every subtitle line, which is unwatchable. At 90% it is one in ten
 * (workable with tap-to-translate subtitles), at 95% one in twenty (relaxed).
 * The UI therefore always states the ratio, never the percentage alone.
 */
export const READY_TARGET = 0.9;
export const COMFORT_TARGET = 0.95;

/**
 * Fallback frontier. Only ever used once a level HAS been measured but the
 * stored value is missing — readiness is not shown at all before the test,
 * because any fixed assumption produces the same ~75% on every video.
 */
export const DEFAULT_KNOWN_RANK = 1000;

/** Coverage data in working form. */
export interface Coverage {
  total: number; // word units spoken in the video
  base: number; // units that belong to no card (function words, junk)
  ids: string[]; // one per card, most frequent first
  counts: number[]; // parallel to ids
}

export interface Readiness {
  /**
   * 0..100 progress towards «можно смотреть» — what the bar shows.
   *
   * NOT the coverage percentage. Coverage has no zero: any video starts around
   * 70-80% for any learner, because that is how English distributes, so a bar
   * filled to 74% told a beginner they were nearly there. This one starts empty
   * and fills as the words that actually block the video get learned.
   */
  progressPct: number;
  /** Split of that progress: fully learned vs still in rotation (half credit). */
  fullPct: number;
  partPct: number;
  learned: number; // deck words the user has learned
  learning: number; // …and words currently in rotation
  pct: number; // 0..100 of the spoken words the user knows
  /** One unknown word every N — the number people can actually picture. */
  unknownEvery: number;
  ready: boolean; // ≥ READY_TARGET: watchable with the app's subtitles
  comfortable: boolean; // ≥ COMFORT_TARGET
  plan: string[]; // words to reach READY_TARGET, biggest win first
  planComfort: string[]; // …and to reach COMFORT_TARGET
  gainPct: number; // points `plan` adds — the yellow part of the bar
  knownUnits: number; // familiar words spoken — the numerator, shown as-is
  total: number; // words spoken in the video — the denominator
}

/** Working-form coverage straight from an open deck. */
export function coverageFromCards(
  cards: Card[],
  totalWords: number | undefined,
): Coverage | null {
  if (!totalWords || totalWords <= 0) return null;
  const ordered = [...cards].sort((a, b) => b.count - a.count || a.rank - b.rank);
  const inCards = ordered.reduce((s, c) => s + c.count, 0);
  return {
    total: totalWords,
    base: Math.max(0, totalWords - inCards),
    ids: ordered.map((c) => c.id),
    counts: ordered.map((c) => c.count),
  };
}

/** Packed for storage. Ids are not repeated — `wordIds` already holds them. */
export function buildCoverage(cards: Card[], totalWords: number): StoredCoverage | undefined {
  if (!totalWords || totalWords <= 0) return undefined;
  const inCards = cards.reduce((s, c) => s + c.count, 0);
  return {
    v: COVERAGE_V,
    total: totalWords,
    base: Math.max(0, totalWords - inCards),
    counts: cards.map((c) => c.count).join(','),
  };
}

/** Unpack a deck list entry. `counts` is parallel to `wordIds`, hence both. */
export function decodeCoverage(meta: DeckMeta | undefined): Coverage | null {
  const c = meta?.coverage;
  if (!c || c.v !== COVERAGE_V || !c.total || !meta?.wordIds?.length) return null;
  const counts = String(c.counts || '').split(',');
  return {
    total: c.total,
    base: c.base,
    ids: meta.wordIds,
    counts: meta.wordIds.map((_, i) => Number(counts[i]) || 0),
  };
}

/**
 * Where the user stands and what to learn next.
 *
 * A word counts as understood when the user has actually mastered it, or —
 * absent any evidence — when it is more common than their measured frontier.
 * Evidence wins both ways: a word they are still learning does NOT count as
 * known just because it is common.
 *
 * `ids` arrive sorted by frequency, so walking them in order IS the optimal
 * greedy plan: each next word is the cheapest remaining percent of speech.
 */
export function readinessOf(
  cov: Coverage | null,
  words: WordsMap,
  knownRank: number,
  target = READY_TARGET,
): Readiness | null {
  if (!cov) return null;

  let known = cov.base;
  // work already done on this video: fully learned words and half-credit for
  // the ones still in rotation. Kept apart so the bar can show both.
  let earnedFull = 0;
  let earnedPart = 0;
  let learned = 0;
  let learning = 0;
  const rest: { id: string; n: number }[] = [];

  cov.ids.forEach((id, i) => {
    const n = cov.counts[i];
    const state = words.get(id);
    // what the measured vocabulary already grants this word
    const assumed = rankOf(id) < knownRank ? 1 : 0;
    const w = knownWeight(state, assumed);
    known += n * w;

    // only progress BEYOND the baseline is the user's own doing — studying a
    // word the model already counted as known moves nothing, by construction
    const gain = Math.max(0, w - assumed) * n;
    if (isMastered(state)) {
      learned++;
      earnedFull += gain;
    } else if (state && state.srs.reps > 0) {
      learning++;
      earnedPart += gain;
    }

    // whatever is left of the word still stands between the user and the video
    if (w < 1) rest.push({ id, n: n * (1 - w) });
  });

  // one walk covers both rungs: the plan to «можно смотреть» is a prefix of
  // the plan to «комфортно»
  const needReady = Math.ceil(cov.total * target);
  const needComfort = Math.ceil(cov.total * COMFORT_TARGET);
  const planComfort: string[] = [];
  let readyCount = -1;
  let acc = known;
  let gained = 0;
  for (const r of rest) {
    if (acc >= needComfort) break;
    if (readyCount < 0 && acc >= needReady) readyCount = planComfort.length;
    acc += r.n;
    if (readyCount < 0) gained += r.n;
    planComfort.push(r.id);
  }
  if (readyCount < 0) readyCount = planComfort.length;

  const unknown = Math.max(0, cov.total - known);
  const ready = known >= needReady;

  // The bar measures distance travelled towards «можно смотреть»: work already
  // done against work still in the way. Once ready, it is full by definition
  // and the split just shows what that readiness rests on.
  const span = ready ? Math.max(earnedFull + earnedPart, 1) : earnedFull + earnedPart + gained;
  const fullPct = span > 0 ? (earnedFull / span) * 100 : 0;
  const partPct = span > 0 ? (earnedPart / span) * 100 : 0;

  return {
    progressPct: ready ? 100 : Math.round(fullPct + partPct),
    fullPct,
    partPct,
    learned,
    learning,
    // floor, not round: «знакомо 90%» must never appear while the bar still
    // asks for more words
    pct: Math.floor((known / cov.total) * 100),
    unknownEvery: unknown > 0 ? Math.round(cov.total / unknown) : 0,
    ready,
    comfortable: known >= needComfort,
    plan: planComfort.slice(0, readyCount),
    planComfort,
    gainPct: Math.round((gained / cov.total) * 100),
    knownUnits: Math.round(known),
    total: cov.total,
  };
}
