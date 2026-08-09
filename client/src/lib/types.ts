export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** A section of the video: author-defined on YouTube, or split by time. */
export interface Chapter {
  title: string;
  start: number;
  end: number;
}

export interface Transcript {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  language: string;
  auto: boolean;
  chapters?: Chapter[]; // empty when the video has none
  segments: Segment[];
  text: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Example {
  en: string;
  ru?: string;
  time: number; // phrase start, seconds into the video
  end?: number; // phrase end (for the in-card clip player)
}

/** Dictionary meanings of one part of speech: «сущ.: вид, тип, сорт». */
export interface Sense {
  pos: string; // part of speech, already in Russian
  meanings: string[];
}

export interface Card {
  id: string; // lemma or phrase (key)
  word: string; // display form
  forms?: string[]; // surface forms seen in the video (run, running, ran…)
  isPhrase?: boolean; // multi-word unit ("kind of", "figure out")
  translation: string; // RU ('' until fetched) — most common meaning
  senses?: Sense[]; // other meanings, so multi-sense words are obvious
  examples: Example[];
  count: number; // occurrences in this video (all forms)
  rank: number; // frequency rank (UNRANKED if not in common list)
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
  builderVersion?: number; // CARDS_VERSION the cards were built with
  totalWords?: number; // word units spoken in the video (denominator for «готовность»)
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
  builderVersion?: number; // decks below CARDS_VERSION are rebuilt on open
  coverage?: StoredCoverage; // «готовность» without loading full cards
}

/**
 * Compact «готовность к видео» payload kept on the deck list document.
 *
 * Understanding depends on how much of the SPOKEN WORDS you know, not on how
 * many of the deck's unique words you know — a handful of frequent words buys
 * most of the video.
 *
 * Deliberately minimal: ids come from `wordIds`, and each word's frequency
 * rank is recomputed from the id itself, so only the counts are stored — a
 * comma-joined string costs ~1.5 KB for a 570-word deck instead of ~9 KB as a
 * number array. Nothing here depends on the user, so the same document serves
 * any vocabulary level.
 */
export interface StoredCoverage {
  v: number; // shape version; older payloads are ignored
  total: number; // word units spoken in the video
  base: number; // units that belong to no card (function words, junk)
  counts: string; // occurrence count per card, parallel to wordIds
}

/**
 * What the app knows about the user's own English.
 *
 * `knownRank` is the vocabulary frontier: words more common than this are
 * assumed known. It has to be MEASURED — a fixed guess makes every video show
 * the same readiness, because the top 1000 English words alone cover ~72% of
 * running speech in any video.
 */
export interface Profile {
  knownRank?: number;
  vocabEstimate?: number; // words known, as measured by the test
  calibratedAt?: number;
}
