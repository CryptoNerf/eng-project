// Helpers around the global word layer: statuses, video-readiness percent,
// daily stats and streaks.

import { isLearnedSrs } from './srs';
import type { Stats, WordState } from './types';

export type WordsMap = Map<string, WordState>;

/** Manually marked «уже знаю». */
export function isKnown(ws?: WordState): boolean {
  return ws?.status === 'known';
}

/** Reached the learned threshold through reviews (not manual). */
export function isLearnedAuto(ws?: WordState): boolean {
  return !!ws && ws.status !== 'known' && isLearnedSrs(ws.srs);
}

/** «Вы знаете это слово»: manual known OR learned via SRS. Drives % and hiding. */
export function isMastered(ws?: WordState): boolean {
  return !!ws && (ws.status === 'known' || isLearnedSrs(ws.srs));
}

/** Percent of a video's words the user already knows; null while unknown. */
export function pctMastered(wordIds: string[] | undefined, words: WordsMap): number | null {
  if (!wordIds || wordIds.length === 0) return null;
  let n = 0;
  for (const id of wordIds) if (isMastered(words.get(id))) n++;
  return Math.round((n / wordIds.length) * 100);
}

/**
 * How much a word counts towards understanding a video, 0..1.
 *
 * `assumed` is what the user's measured vocabulary already grants the word
 * (1 for words more common than their frontier). Evidence may only move the
 * weight AWAY from zero, never below what was assumed by mere recall:
 * grading a common word «good» must not make the app think you know it less.
 * Failing it, however, is real negative evidence and drops it to zero.
 *
 * Mastery takes four successful reviews spread over three weeks (SM-2 reaches
 * a 21-day interval only then), so counting ONLY mastered words left the
 * readiness bar frozen through the first weeks of study — the work was
 * invisible. A word recalled at least once counts for half.
 */
export function knownWeight(ws: WordState | undefined, assumed = 0): number {
  if (isMastered(ws)) return 1;
  if (!ws) return assumed;
  return ws.srs.reps > 0 ? Math.max(0.5, assumed) : 0;
}

/** Words due for review now (excluding manually-known). */
export function dueWords(words: WordsMap, now = Date.now()): WordState[] {
  const due: WordState[] = [];
  for (const ws of words.values()) {
    if (ws.status !== 'known' && ws.srs.due <= now) due.push(ws);
  }
  due.sort((a, b) => a.srs.due - b.srs.due);
  return due;
}

/* ------------------------------ stats ------------------------------ */

const KEEP_DAYS = 120;

export function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Immutably bump today's counters; prunes entries older than KEEP_DAYS. */
export function bumpStats(stats: Stats, delta: { r?: number; l?: number }): Stats {
  const key = todayKey();
  const prev = stats.days[key] || { r: 0, l: 0 };
  const days = {
    ...stats.days,
    [key]: { r: prev.r + (delta.r || 0), l: prev.l + (delta.l || 0) },
  };
  const keys = Object.keys(days).sort();
  while (keys.length > KEEP_DAYS) delete days[keys.shift()!];
  return { days };
}

/** Consecutive days with at least one review, counting back from today. */
export function calcStreak(stats: Stats): number {
  const d = new Date();
  if (!stats.days[todayKey(d)]?.r) d.setDate(d.getDate() - 1); // today not started yet
  let streak = 0;
  while (stats.days[todayKey(d)]?.r) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function reviewsToday(stats: Stats): number {
  return stats.days[todayKey()]?.r || 0;
}
