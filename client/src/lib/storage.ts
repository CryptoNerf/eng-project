import type { Deck, Stats, WordState } from './types';

const KEY = 'molly.decks.v1';
const WORDS_KEY = 'molly.words.v1';
const STATS_KEY = 'molly.stats.v1';

export function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const decks = JSON.parse(raw) as Deck[];
    return Array.isArray(decks) ? decks : [];
  } catch {
    return [];
  }
}

function persist(decks: Deck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch (e) {
    console.error('Не удалось сохранить колоды:', e);
  }
}

export function saveDeck(deck: Deck): Deck[] {
  const decks = loadDecks();
  const idx = decks.findIndex((d) => d.videoId === deck.videoId);
  if (idx >= 0) decks[idx] = deck;
  else decks.unshift(deck);
  persist(decks);
  return decks;
}

export function deleteDeck(videoId: string): Deck[] {
  const decks = loadDecks().filter((d) => d.videoId !== videoId);
  persist(decks);
  return decks;
}

export function getDeck(videoId: string): Deck | undefined {
  return loadDecks().find((d) => d.videoId === videoId);
}

/* ---------- global word states (local fallback) ---------- */

export function loadWords(): WordState[] {
  try {
    const raw = localStorage.getItem(WORDS_KEY);
    const list = raw ? (JSON.parse(raw) as WordState[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveWordsLocal(words: WordState[]): void {
  try {
    localStorage.setItem(WORDS_KEY, JSON.stringify(words));
  } catch (e) {
    console.error('Не удалось сохранить словарь:', e);
  }
}

export function loadStatsLocal(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    const s = raw ? (JSON.parse(raw) as Stats) : { days: {} };
    return s && typeof s === 'object' && s.days ? s : { days: {} };
  } catch {
    return { days: {} };
  }
}

export function saveStatsLocal(stats: Stats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}
