// «Готовность к видео»: how much of what is actually SAID the user already
// understands, and the shortest list of words that closes the gap.
//
// Deck size is a misleading goal. Words are distributed very unevenly, so a
// small, frequent minority carries most of the speech: in a 19-minute
// 3Blue1Brown video 79 of the deck's 571 words take understanding from 75% to
// 90%, while 225 words that occur exactly once are worth 7% between them.
// Showing «выучите 79 слов» instead of «571 карточка» turns an open-ended pile
// into a finishable goal — and tells the user when to go back and watch.

import type { Card, StoredCoverage } from './types';
import { isMastered, type WordsMap } from './vocab';
import { EASY_MAX } from './words';

/**
 * Comprehension target. Below ~90% of running words a video stops holding
 * together; 95% is comfortable. 90% is the promise we make on the progress bar.
 */
export const READY_TARGET = 0.9;

/** Coverage data in working form (counts decoded). */
export interface Coverage {
  total: number; // word units spoken in the video
  base: number; // units understood before learning anything new
  ids: string[]; // words worth learning, most frequent first
  counts: number[]; // parallel to ids
}

export interface Readiness {
  pct: number; // 0..100 of the speech understood right now
  targetPct: number; // 0..100 the goal on the bar
  ready: boolean; // target reached — time to watch
  plan: string[]; // words that get there, biggest win first
  gainPct: number; // points the plan adds
}

/**
 * Split a deck's cards into «already understood» and «worth learning».
 *
 * Words inside the top-EASY_MAX are assumed known: they are the app's own
 * "easy" tier and every learner who can start a video at all knows them.
 * Everything the deck never made a card for (function words, junk) is part of
 * the baseline too — it is understood or irrelevant either way.
 */
export function coverageFromCards(cards: Card[], totalWords: number | undefined): Coverage | null {
  if (!totalWords || totalWords <= 0) return null;
  const worth = cards
    .filter((c) => c.rank >= EASY_MAX)
    .sort((a, b) => b.count - a.count || a.rank - b.rank);
  const learnable = worth.reduce((s, c) => s + c.count, 0);
  return {
    total: totalWords,
    base: Math.max(0, totalWords - learnable),
    ids: worth.map((c) => c.id),
    counts: worth.map((c) => c.count),
  };
}

/** Same data, packed for storage on the deck list document. */
export function buildCoverage(cards: Card[], totalWords: number): StoredCoverage | undefined {
  const cov = coverageFromCards(cards, totalWords);
  if (!cov) return undefined;
  return { total: cov.total, base: cov.base, ids: cov.ids, counts: cov.counts.join(',') };
}

export function decodeCoverage(c: StoredCoverage | undefined): Coverage | null {
  if (!c?.total || !c.ids?.length) return null;
  const counts = String(c.counts || '').split(',');
  return {
    total: c.total,
    base: c.base,
    ids: c.ids,
    counts: c.ids.map((_, i) => Number(counts[i]) || 0),
  };
}

/**
 * Where the user stands and what to learn next.
 *
 * `ids` arrive sorted by frequency, so walking them in order IS the optimal
 * greedy plan: each next word is the cheapest remaining percent of speech.
 */
export function readinessOf(
  cov: Coverage | null,
  words: WordsMap,
  target = READY_TARGET,
): Readiness | null {
  if (!cov) return null;

  let known = cov.base;
  const rest: { id: string; n: number }[] = [];
  cov.ids.forEach((id, i) => {
    const n = cov.counts[i];
    if (isMastered(words.get(id))) known += n;
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
  };
}
