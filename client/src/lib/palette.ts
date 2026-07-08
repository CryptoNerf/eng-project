// Paper palette for word cards: flat colors like real index cards.
// Every paper color carries its own ink colors picked for contrast, so words
// stay легко читаемыми on any card. Difficulty maps to a color family; the
// exact shade is chosen deterministically per word for a lively pile-of-paper
// look that never changes between renders.

import type { Difficulty } from './types';

export interface Paper {
  bg: string; // card background
  ink: string; // primary text
  sub: string; // secondary text (labels, hints)
  chipBg: string; // small label chip
  chipInk: string;
  border: string;
}

const dark = (bg: string): Paper => ({
  bg,
  ink: '#ffffff',
  sub: 'rgba(255,255,255,0.72)',
  chipBg: '#ffffff',
  chipInk: '#121110',
  border: 'rgba(0,0,0,0.25)',
});

const light = (bg: string, ink: string, sub: string): Paper => ({
  bg,
  ink,
  sub,
  chipBg: '#121110',
  chipInk: '#ffffff',
  border: 'rgba(18,17,16,0.2)',
});

// One color per difficulty — the card color IS the difficulty, no ambiguity:
// easy = green paper, medium = yellow paper, hard = terracotta with white ink.
const PAPERS: Record<Difficulty, Paper> = {
  easy: light('#cfe36e', '#26300a', '#4c5a1e'),
  medium: light('#f2d94c', '#33290a', '#5c4d14'),
  hard: dark('#c2401f'),
};

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function paperFor(_word: string, difficulty: Difficulty): Paper {
  return PAPERS[difficulty];
}

/** Small deterministic tilt (±1.4°) so cards feel like scattered paper. */
export function tiltFor(word: string): string {
  const h = hash(word + '~');
  return `${(((h % 29) - 14) / 10).toFixed(1)}deg`;
}

export const DIFF_LABEL: Record<Difficulty, string> = {
  easy: 'простое',
  medium: 'среднее',
  hard: 'сложное',
};

/** Flat swatches for filter chips etc. */
export const DIFF_SWATCH: Record<Difficulty, string> = {
  easy: '#cfe36e',
  medium: '#f2d94c',
  hard: '#c2401f',
};
