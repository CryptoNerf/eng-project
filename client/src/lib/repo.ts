// Repository layer: one interface, two backends.
// CloudRepo → Firestore under spaces/{spaceId} (offline-capable via cache).
// LocalRepo → localStorage (fallback when the cloud is unavailable).
//
// The subtree is addressed by a hash of the sync key, not by an account: the
// app stores no e-mail, no name and no OAuth identity (see lib/space.ts).
//
// Data layout (two-layer model):
//   decks/{videoId} + decks/{videoId}/cards/chunk_N — per-video cards/examples
//   words/{word}   — GLOBAL word state (SRS shared across videos)
//   stats/summary  — daily review counters (streak is computed client-side)
//   stats/profile  — measured vocabulary level

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
import { buildCoverage } from './coverage';
import * as local from './storage';
import type { Card, Deck, DeckMeta, Profile, Stats, WordState } from './types';

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

  /** Measured vocabulary level — what «готовность» is calculated against. */
  loadProfile(): Promise<Profile>;
  saveProfile(profile: Profile): Promise<void>;
}

const CARDS_PER_CHUNK = 150;

function toMeta(d: Deck): DeckMeta {
  const meta: DeckMeta = {
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
  // «готовность» on the collections screen, without loading any cards.
  // Firestore rejects undefined, so the field is added only when we have it.
  const coverage = buildCoverage(d.cards, d.totalWords ?? 0);
  if (coverage) meta.coverage = coverage;
  return meta;
}

/** JSON roundtrips turn Infinity into null — repair ranks on the way in. */
function sanitizeCards(cards: Card[]): Card[] {
  return cards.map((c) => ({
    ...c,
    rank: typeof c.rank === 'number' && Number.isFinite(c.rank) ? c.rank : UNRANKED,
  }));
}

/* ------------------------------ CloudRepo ------------------------------ */

export function cloudRepo(spaceId: string): Repo {
  const userDoc = (...segs: string[]) => doc(db, 'spaces', spaceId, ...segs);
  const userCol = (...segs: string[]) => collection(db, 'spaces', spaceId, ...segs);

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

      return {
        ...meta,
        totalWords: meta.coverage?.total,
        cards: sanitizeCards(cards),
        srs: {},
      };
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

    async loadProfile() {
      const snap = await getDoc(userDoc('stats', 'profile'));
      return snap.exists() ? (snap.data() as Profile) : {};
    },

    async saveProfile(profile) {
      await setDoc(userDoc('stats', 'profile'), profile, { merge: true });
    },
  };
}

/**
 * One-time move of a legacy account subtree (users/{uid}) into a sync space.
 *
 * Accounts are gone — identity is a local key now — so everything a signed-in
 * user had must be carried over before their session disappears. Runs only
 * when the space is still empty, so it can never overwrite newer data.
 * Nothing is deleted: the old subtree stays until it is removed by hand.
 */
export async function migrateAccountToSpace(uid: string, repo: Repo): Promise<number> {
  if (repo.kind !== 'cloud') return 0;
  const existing = await repo.listDecks().catch(() => []);
  const existingWords = await repo.listWords().catch(() => []);
  if (existing.length > 0 || existingWords.length > 0) return 0;

  const accountCol = (...segs: string[]) => collection(db, 'users', uid, ...segs);
  const accountDoc = (...segs: string[]) => doc(db, 'users', uid, ...segs);

  /* ---------- decks with their card chunks ---------- */
  const deckSnap = await getDocs(accountCol('decks')).catch(() => null);
  let moved = 0;
  for (const d of deckSnap?.docs || []) {
    const meta = d.data() as DeckMeta;
    const chunks = await getDocs(query(accountCol('decks', d.id, 'cards'), orderBy('i')));
    const cards: Card[] = [];
    chunks.forEach((c) => cards.push(...((c.data().cards as Card[]) || [])));
    if (cards.length === 0) continue;
    await repo.saveDeckFull({ ...meta, cards: sanitizeCards(cards), srs: {} });
    moved++;
  }

  /* ---------- global word progress ---------- */
  const wordSnap = await getDocs(accountCol('words')).catch(() => null);
  let words = (wordSnap?.docs || []).map((w) => w.data() as WordState);

  // even older layout: per-deck progress documents
  if (words.length === 0) {
    const progSnap = await getDocs(accountCol('progress')).catch(() => null);
    const merged = new Map<string, WordState>();
    progSnap?.forEach((docSnap) => {
      const videoId = docSnap.id;
      const srsMap = (docSnap.data().srs || {}) as Deck['srs'];
      for (const [word, srs] of Object.entries(srsMap)) {
        const prev = merged.get(word);
        if (!prev || srs.interval > prev.srs.interval) {
          merged.set(word, {
            word,
            status: 'learning',
            srs,
            sources: [...(prev?.sources || []), videoId],
            translation: prev?.translation || '',
            updatedAt: Date.now(),
          });
        } else if (!prev.sources.includes(videoId)) {
          prev.sources.push(videoId);
        }
      }
    });
    words = [...merged.values()];
  }
  if (words.length) await repo.saveWordsBulk(words);

  /* ---------- stats and measured level ---------- */
  const stats = await getDoc(accountDoc('stats', 'summary')).catch(() => null);
  if (stats?.exists()) await repo.saveStats(stats.data() as Stats);
  const profile = await getDoc(accountDoc('stats', 'profile')).catch(() => null);
  if (profile?.exists()) await repo.saveProfile(profile.data() as Profile);

  return moved + words.length;
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

  async loadProfile() {
    return local.loadProfileLocal();
  },

  async saveProfile(profile) {
    local.saveProfileLocal(profile);
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
