// Repository layer: one interface, two backends.
// CloudRepo → Firestore under users/{uid} (offline-capable via persistent cache).
// LocalRepo → localStorage (fallback when auth is unavailable).
//
// Data layout (two-layer model):
//   decks/{videoId} + decks/{videoId}/cards/chunk_N — per-video cards/examples
//   words/{word}   — GLOBAL per-user word state (SRS shared across videos)
//   stats/summary  — daily review counters (streak is computed client-side)

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { UNRANKED } from './words';
import * as local from './storage';
import type { Card, Deck, DeckMeta, Stats, WordState } from './types';

export interface Repo {
  kind: 'cloud' | 'local';
  listDecks(): Promise<DeckMeta[]>;
  loadDeck(videoId: string): Promise<Deck | null>;
  saveDeckFull(deck: Deck): Promise<void>;
  saveCards(videoId: string, cards: Card[]): Promise<void>;
  deleteDeck(videoId: string): Promise<void>;

  listWords(): Promise<WordState[]>;
  saveWord(w: WordState): Promise<void>;
  saveWordsBulk(ws: WordState[]): Promise<void>;

  loadStats(): Promise<Stats>;
  saveStats(stats: Stats): Promise<void>;
}

const CARDS_PER_CHUNK = 150;

function toMeta(d: Deck): DeckMeta {
  return {
    videoId: d.videoId,
    title: d.title,
    author: d.author,
    thumbnail: d.thumbnail,
    duration: d.duration,
    createdAt: d.createdAt,
    cardCount: d.cards.length,
    wordIds: d.cards.map((c) => c.id),
    builderVersion: d.builderVersion ?? 1,
  };
}

/** JSON roundtrips turn Infinity into null — repair ranks on the way in. */
function sanitizeCards(cards: Card[]): Card[] {
  return cards.map((c) => ({
    ...c,
    rank: typeof c.rank === 'number' && Number.isFinite(c.rank) ? c.rank : UNRANKED,
  }));
}

/* ------------------------------ CloudRepo ------------------------------ */

export function cloudRepo(uid: string): Repo {
  const userDoc = (...segs: string[]) => doc(db, 'users', uid, ...segs);
  const userCol = (...segs: string[]) => collection(db, 'users', uid, ...segs);

  return {
    kind: 'cloud',

    async listDecks() {
      const snap = await getDocs(query(userCol('decks'), orderBy('createdAt', 'desc')));
      return snap.docs.map((d) => d.data() as DeckMeta);
    },

    async loadDeck(videoId) {
      const metaSnap = await getDoc(userDoc('decks', videoId));
      if (!metaSnap.exists()) return null;
      const meta = metaSnap.data() as DeckMeta;

      const chunksSnap = await getDocs(query(userCol('decks', videoId, 'cards'), orderBy('i')));
      const cards: Card[] = [];
      chunksSnap.forEach((c) => cards.push(...((c.data().cards as Card[]) || [])));

      // Backfill wordIds for decks saved before the two-layer model
      if (!meta.wordIds?.length && cards.length) {
        setDoc(
          userDoc('decks', videoId),
          { wordIds: cards.map((c) => c.id) },
          { merge: true },
        ).catch(() => {});
      }

      return { ...meta, cards: sanitizeCards(cards), srs: {} };
    },

    async saveDeckFull(deck) {
      const batch = writeBatch(db);
      batch.set(userDoc('decks', deck.videoId), toMeta(deck));
      const cards = sanitizeCards(deck.cards);
      for (let i = 0; i * CARDS_PER_CHUNK < cards.length; i++) {
        batch.set(userDoc('decks', deck.videoId, 'cards', `chunk_${i}`), {
          i,
          cards: cards.slice(i * CARDS_PER_CHUNK, (i + 1) * CARDS_PER_CHUNK),
        });
      }
      await batch.commit();
    },

    async saveCards(videoId, cards) {
      const batch = writeBatch(db);
      const clean = sanitizeCards(cards);
      for (let i = 0; i * CARDS_PER_CHUNK < clean.length; i++) {
        batch.set(userDoc('decks', videoId, 'cards', `chunk_${i}`), {
          i,
          cards: clean.slice(i * CARDS_PER_CHUNK, (i + 1) * CARDS_PER_CHUNK),
        });
      }
      await batch.commit();
    },

    async deleteDeck(videoId) {
      const chunksSnap = await getDocs(userCol('decks', videoId, 'cards'));
      const batch = writeBatch(db);
      chunksSnap.forEach((c) => batch.delete(c.ref));
      batch.delete(userDoc('decks', videoId));
      batch.delete(userDoc('progress', videoId)); // legacy
      await batch.commit();
    },

    async listWords() {
      const snap = await getDocs(userCol('words'));
      return snap.docs.map((d) => d.data() as WordState);
    },

    async saveWord(w) {
      await setDoc(userDoc('words', w.word), w);
    },

    async saveWordsBulk(ws) {
      for (let i = 0; i < ws.length; i += 400) {
        const batch = writeBatch(db);
        for (const w of ws.slice(i, i + 400)) {
          batch.set(userDoc('words', w.word), w);
        }
        await batch.commit();
      }
    },

    async loadStats() {
      const snap = await getDoc(userDoc('stats', 'summary'));
      const s = snap.exists() ? (snap.data() as Stats) : { days: {} };
      return s.days ? s : { days: {} };
    },

    async saveStats(stats) {
      await setDoc(userDoc('stats', 'summary'), stats, { merge: true });
    },
  };
}

/** Migrate legacy per-deck progress docs into global words/. Cloud only. */
export async function migrateProgressToWords(repo: Repo, uid: string): Promise<number> {
  if (repo.kind !== 'cloud') return 0;
  const existing = await repo.listWords();
  if (existing.length > 0) return 0;

  const progSnap = await getDocs(collection(db, 'users', uid, 'progress'));
  if (progSnap.empty) return 0;

  // word -> best srs across decks (keep the longest interval)
  const merged = new Map<string, WordState>();
  const decks = await repo.listDecks();
  const cardsByDeck = new Map<string, Map<string, Card>>();
  for (const meta of decks) {
    const full = await repo.loadDeck(meta.videoId);
    if (full) cardsByDeck.set(meta.videoId, new Map(full.cards.map((c) => [c.id, c])));
  }

  progSnap.forEach((docSnap) => {
    const videoId = docSnap.id;
    const srsMap = (docSnap.data().srs || {}) as Deck['srs'];
    for (const [word, srs] of Object.entries(srsMap)) {
      const card = cardsByDeck.get(videoId)?.get(word);
      const prev = merged.get(word);
      if (!prev || srs.interval > prev.srs.interval) {
        merged.set(word, {
          word,
          status: 'learning',
          srs,
          sources: [...(prev?.sources || []), videoId],
          translation: card?.translation || prev?.translation || '',
          updatedAt: Date.now(),
        });
      } else if (!prev.sources.includes(videoId)) {
        prev.sources.push(videoId);
      }
    }
  });

  const words = [...merged.values()];
  if (words.length) await repo.saveWordsBulk(words);
  return words.length;
}

/* ------------------------------ LocalRepo ------------------------------ */

export const localRepo: Repo = {
  kind: 'local',

  async listDecks() {
    return local.loadDecks().map(toMeta);
  },

  async loadDeck(videoId) {
    const d = local.getDeck(videoId);
    return d ? { ...d, cards: sanitizeCards(d.cards), srs: {} } : null;
  },

  async saveDeckFull(deck) {
    local.saveDeck(deck);
  },

  async saveCards(videoId, cards) {
    const d = local.getDeck(videoId);
    if (d) local.saveDeck({ ...d, cards });
  },

  async deleteDeck(videoId) {
    local.deleteDeck(videoId);
  },

  async listWords() {
    return local.loadWords();
  },

  async saveWord(w) {
    const words = local.loadWords();
    const idx = words.findIndex((x) => x.word === w.word);
    if (idx >= 0) words[idx] = w;
    else words.push(w);
    local.saveWordsLocal(words);
  },

  async saveWordsBulk(ws) {
    const words = local.loadWords();
    const byWord = new Map(words.map((w) => [w.word, w]));
    for (const w of ws) byWord.set(w.word, w);
    local.saveWordsLocal([...byWord.values()]);
  },

  async loadStats() {
    return local.loadStatsLocal();
  },

  async saveStats(stats) {
    local.saveStatsLocal(stats);
  },
};

/* ------------------------------ Migration ------------------------------ */

const MIGRATED_KEY = 'molly.migrated.v1';

/**
 * One-time move of localStorage decks into the user's cloud account.
 * Runs only when the cloud account has no decks yet.
 */
export async function migrateLocalToCloud(repo: Repo): Promise<number> {
  if (repo.kind !== 'cloud') return 0;
  if (localStorage.getItem(MIGRATED_KEY)) return 0;
  const localDecks = local.loadDecks();
  if (localDecks.length === 0) {
    localStorage.setItem(MIGRATED_KEY, '1');
    return 0;
  }
  const cloudDecks = await repo.listDecks();
  if (cloudDecks.length > 0) {
    localStorage.setItem(MIGRATED_KEY, '1');
    return 0;
  }
  for (const d of localDecks) {
    await repo.saveDeckFull({ ...d, cards: sanitizeCards(d.cards) });
  }
  localStorage.setItem(MIGRATED_KEY, '1');
  return localDecks.length;
}
