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
import { isMastered, type WordsMap } from './vocab';
import { rankOf } from './words';

/** Storage shape version — older payloads are ignored until a deck rebuild. */
export const COVERAGE_V = 2;

/**
 * Comprehension target. Below ~90% of running words a video stops holding
 * together; 95% is comfortable. 90% is the promise we make on the progress bar.
 */
export const READY_TARGET = 0.9;

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
  pct: number; // 0..100 of the speech understood right now
  targetPct: number; // 0..100 the goal on the bar
  ready: boolean; // target reached — time to watch
  plan: string[]; // words that get there, biggest win first
  gainPct: number; // points the plan adds
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
  const rest: { id: string; n: number }[] = [];
  cov.ids.forEach((id, i) => {
    const n = cov.counts[i];
    const state = words.get(id);
    if (state) {
      if (isMastered(state)) known += n;
      else rest.push({ id, n });
      return;
    }
    if (rankOf(id) < knownRank) known += n;
    else rest.push({ id, n });
  });

  const needed = Math.ceil(cov.total * target) - known;
  const plan: string[] = [];
  let gained = 0;
  for (const r of rest) {
    if (gained >= needed) break;
    gained += r.n;
    plan.push(r.id);
  }

  return {
    // floor, not round: «понятно 90%» must never appear while the bar still
    // asks for more words
    pct: Math.floor((known / cov.total) * 100),
    targetPct: Math.round(target * 100),
    ready: needed <= 0,
    plan,
    gainPct: Math.round((gained / cov.total) * 100),
    knownUnits: Math.round(known),
    total: cov.total,
  };
}
