export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  language: string;
  auto: boolean;
  segments: Segment[];
  text: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Example {
  en: string;
  ru?: string;
  time: number; // seconds into the video
}

export interface Card {
  id: string; // normalized word (key)
  word: string; // display form
  translation: string; // RU ('' until fetched)
  examples: Example[];
  count: number; // occurrences in this video
  rank: number; // frequency rank (Infinity if not in common list)
  difficulty: Difficulty;
}

export interface SrsState {
  reps: number;
  interval: number; // days
  ease: number;
  due: number; // epoch ms
  lastGrade?: number;
}

/** 'learning' — в работе; 'known' — пользователь вручную отметил «уже знаю». */
export type WordStatus = 'learning' | 'known';

/**
 * Global per-user word state, shared across all videos. Progress made in one
 * video counts everywhere; decks only supply context (examples, timestamps).
 */
export interface WordState {
  word: string;
  status: WordStatus;
  srs: SrsState;
  sources: string[]; // videoIds the word came from
  translation: string;
  updatedAt: number;
}

/** A study card carries the video it came from (mixed-source sessions). */
export interface StudyCard extends Card {
  videoId: string;
}

export interface DayStat {
  r: number; // reviews that day
  l: number; // words that crossed the "learned" threshold that day
}

export interface Stats {
  days: Record<string, DayStat>; // key: YYYY-MM-DD (local)
}

export interface Deck {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  createdAt: number;
  cards: Card[];
  srs: Record<string, SrsState>;
}

/** Lightweight deck info for lists — cards live in separate documents. */
export interface DeckMeta {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  createdAt: number;
  cardCount: number;
  wordIds?: string[]; // for «вы знаете X%» without loading full cards
}
