import type { SrsState } from './types';

export const DAY = 24 * 60 * 60 * 1000;

// Grades exposed to the UI as four buttons.
export const GRADES = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
} as const;
export type GradeKey = keyof typeof GRADES;

export function initialSrs(): SrsState {
  return { reps: 0, interval: 0, ease: 2.5, due: Date.now() };
}

/**
 * SM-2 spaced-repetition update.
 * "again" (grade < 3) resets the card to be re-shown within the session.
 */
export function review(prev: SrsState, grade: number, now = Date.now()): SrsState {
  const state: SrsState = { ...prev, lastGrade: grade };

  if (grade < 3) {
    state.reps = 0;
    state.interval = 0;
    state.due = now + 60 * 1000; // ~1 min: comes back this session
    return state;
  }

  if (state.reps === 0) state.interval = 1;
  else if (state.reps === 1) state.interval = 6;
  else state.interval = Math.round(state.interval * state.ease);

  // grade 5 ("easy") gets a small bonus
  if (grade === 5) state.interval = Math.round(state.interval * 1.15);

  state.reps += 1;
  state.ease = Math.max(
    1.3,
    state.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)),
  );
  state.due = now + state.interval * DAY;
  return state;
}

/** Cards whose due time has passed (or brand-new). */
export function isDue(state: SrsState | undefined, now = Date.now()): boolean {
  if (!state) return true;
  return state.due <= now;
}

// A word counts as «выучено» once its stable recall interval reaches 3 weeks
// (Anki's "mature" convention).
export const LEARNED_INTERVAL_DAYS = 21;

export function isLearnedSrs(state: SrsState | undefined): boolean {
  return !!state && state.interval >= LEARNED_INTERVAL_DAYS;
}

export function describeInterval(state: SrsState): string {
  if (state.reps === 0) return 'новое';
  if (state.interval < 1) return 'скоро';
  if (state.interval === 1) return 'завтра';
  return `через ${state.interval} дн.`;
}
