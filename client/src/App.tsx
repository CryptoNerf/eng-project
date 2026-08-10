import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { fetchTranscript, translateBatch, warmupIngest, ApiError } from './lib/api';
import { translateWords } from './lib/translate';
import { buildCards, countUnits, exampleEnd, CARDS_VERSION, UNRANKED } from './lib/words';
import { initialSrs, isDue, isLearnedSrs, review } from './lib/srs';
import { auth } from './lib/firebase';
import { watchUser, completeEmailLink, pendingEmailLink } from './lib/auth';
import { track, identify } from './lib/analytics';
import {
  cloudRepo,
  localRepo,
  migrateLocalToCloud,
  migrateProgressToWords,
  type Repo,
} from './lib/repo';
import {
  bumpStats,
  calcStreak,
  dueWords,
  isKnown,
  isLearnedAuto,
  isMastered,
  pctMastered,
  reviewsToday,
  type WordsMap,
} from './lib/vocab';
import { coverageFromCards, readinessOf, DEFAULT_KNOWN_RANK } from './lib/coverage';
import {
  analyzeChapters,
  canSplitIntoChapters,
  resolveChapters,
  type ChapterInfo,
} from './lib/chapters';
import { toAnkiTsv, toCsv, download } from './lib/anki';
import type {
  Card,
  Chapter,
  Deck,
  Profile,
  DeckMeta,
  Difficulty,
  Segment,
  Stats,
  StudyCard,
  WordState,
} from './lib/types';
import { UrlForm } from './components/UrlForm';
import { DeckList } from './components/DeckList';
import { VideoHeader } from './components/VideoHeader';
import { Toolbar, type SortKey, type StatusKey } from './components/Toolbar';
import { WordCard } from './components/WordCard';
import { StudyView } from './components/StudyView';
import { Dictionary, type DictTab } from './components/Dictionary';
import { Logo } from './components/Logo';
import { IngestOverlay } from './components/IngestOverlay';
import { LoginModal } from './components/LoginModal';
import { ClipPlayer, type Clip } from './components/ClipPlayer';
import { WatchView } from './components/WatchView';
import { WatchSummary } from './components/WatchSummary';
import { ChapterList } from './components/ChapterList';
import { LevelTest } from './components/LevelTest';

const DEFAULT_FILTER: Difficulty[] = ['medium', 'hard'];
const STUDY_SESSION_MAX = 40;
// context sentences translated per card (the card shows the first one)
const MAX_EXAMPLE_RU = 3;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const [decksLoading, setDecksLoading] = useState(true);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [showDict, setShowDict] = useState(false);
  const [dictTab, setDictTab] = useState<DictTab>('learning');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  // long operations show a timed overlay: 'ingest' (fetch subtitles) or
  // 'open' (loading a saved deck / building a review session)
  const [busyKind, setBusyKind] = useState<'ingest' | 'open' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tProgress, setTProgress] = useState<{ done: number; total: number } | null>(null);

  const [words, setWords] = useState<WordsMap>(new Map());
  const [stats, setStats] = useState<Stats>({ days: {} });
  // the user's own vocabulary level — «готовность» is meaningless without it
  const [profile, setProfile] = useState<Profile>({});
  const [levelTest, setLevelTest] = useState(false);

  const [active, setActive] = useState<Set<Difficulty>>(new Set(DEFAULT_FILTER));
  const [status, setStatus] = useState<StatusKey>('learning');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('frequency');
  const [studyCards, setStudyCards] = useState<StudyCard[] | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  // watch mode: the payoff step — rewatch the video with interactive subtitles
  const [watch, setWatch] = useState<{ segments: Segment[]; startAt?: number } | null>(null);
  const [watchSummary, setWatchSummary] = useState<string[] | null>(null);
  const segmentsCache = useRef(new Map<string, { segments: Segment[]; chapters: Chapter[] }>());
  // chapters are computed from the transcript on demand, not stored in the deck
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [chapterInfo, setChapterInfo] = useState<ChapterInfo[] | null>(null);
  // Mounting 300+ flip-cards at once janks phones for seconds — render the
  // grid incrementally instead.
  const [renderCount, setRenderCount] = useState(48);

  // token guards against applying async results from a previous video
  const token = useRef(0);
  const deepLinkHandled = useRef(false);
  const emailLinkHandled = useRef(false);
  const deckCache = useRef(new Map<string, Deck>());
  const warmed = useRef(false);

  /** Boot the ingest function while the user is still pasting the URL. */
  function warmIngest() {
    if (warmed.current) return;
    warmed.current = true;
    warmupIngest();
  }

  /** Open the in-app phrase player for an example of a card. */
  function playClip(videoId: string, card: Card, ex: Card['examples'][number]) {
    setClip({
      videoId,
      start: ex.time,
      end: exampleEnd(ex),
      en: ex.en,
      ru: ex.ru,
      word: card.word,
      forms: card.forms?.length ? card.forms : [card.word],
    });
    track('clip_played', { video_id: videoId });
  }

  /* ---------- auth → repo ---------- */
  useEffect(() => {
    const unsub = watchUser((u) => {
      setUser(u);
      setRepo(u ? cloudRepo(u.uid) : localRepo);
      identify(u?.uid ?? null);
    });
    return unsub;
  }, []);

  // tick the elapsed-seconds counter while a busy overlay is up
  useEffect(() => {
    if (!busyKind) return;
    setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [busyKind]);

  // chapters describe one video — drop them when the deck changes
  useEffect(() => {
    setChaptersOpen(false);
    setChapterInfo(null);
  }, [deck?.videoId]);

  // reset the incremental grid whenever the visible set changes
  useEffect(() => {
    setRenderCount(48);
  }, [deck?.videoId, active, search, sort, status]);

  /* ---------- when repo is ready: migrate, load everything ---------- */
  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    (async () => {
      // Complete an email-link sign-in if we returned via one. NB: linking to
      // the SAME uid fires no onAuthStateChanged event, so we must keep going
      // and load data below — early-returning here left the app empty.
      if (!emailLinkHandled.current && pendingEmailLink()) {
        emailLinkHandled.current = true;
        try {
          await completeEmailLink(() =>
            window.prompt('Введите e-mail, на который пришла ссылка для входа:'),
          );
          const u = auth.currentUser;
          if (u && !cancelled) setUser({ ...u } as User);
          // if the link signed into a DIFFERENT account, onAuthStateChanged
          // re-creates the repo and this effect reruns with the right uid
        } catch (e) {
          console.warn('Не удалось завершить вход по ссылке:', e);
        }
      }
      try {
        await migrateLocalToCloud(repo);
      } catch (e) {
        console.warn('Миграция локальных колод не удалась:', e);
      }
      // Load independent data in parallel — collections must not wait for the
      // (potentially large) words collection.
      setDecksLoading(true);
      await Promise.all([
        (async () => {
          try {
            const list = await repo.listDecks();
            if (!cancelled) setDecks(list);
          } catch (e) {
            console.warn('Не удалось загрузить колоды:', e);
          } finally {
            if (!cancelled) setDecksLoading(false);
          }
        })(),
        (async () => {
          try {
            let ws = await repo.listWords();
            if (ws.length === 0 && user) {
              const migrated = await migrateProgressToWords(repo, user.uid).catch(() => 0);
              if (migrated > 0) ws = await repo.listWords();
            }
            if (!cancelled) setWords(new Map(ws.map((w) => [w.word, w])));
          } catch (e) {
            console.warn('Не удалось загрузить словарь:', e);
          }
        })(),
        (async () => {
          try {
            const s = await repo.loadStats();
            if (!cancelled) setStats(s);
          } catch {
            /* keep empty stats */
          }
        })(),
        (async () => {
          try {
            const p = await repo.loadProfile();
            if (!cancelled) setProfile(p);
          } catch {
            /* no level yet just means readiness stays hidden */
          }
        })(),
      ]);
      if (!deepLinkHandled.current) {
        deepLinkHandled.current = true;
        const params = new URLSearchParams(window.location.search);
        const v = params.get('v') || params.get('url');
        if (v && !cancelled) handleSubmit(v);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  /* ---------- load a video ---------- */
  async function handleSubmit(url: string) {
    if (!repo) return;
    setLoading(true);
    setBusyKind('ingest');
    setError(null);
    const myToken = ++token.current;
    try {
      const t = await fetchTranscript(url);
      const cards = buildCards(t);
      if (cards.length === 0) {
        throw new ApiError('В субтитрах не нашлось слов для изучения.');
      }
      setBusyKind(null);

      // Reuse saved translations for the same video (match examples by text —
      // rebuilt cards may order/segment examples differently)
      const existing = await repo.loadDeck(t.videoId).catch(() => null);
      if (existing) {
        const prevByWord = new Map(existing.cards.map((c) => [c.id, c]));
        const ruByEn = new Map<string, string>();
        for (const c of existing.cards) {
          for (const ex of c.examples) if (ex.ru) ruByEn.set(ex.en, ex.ru);
        }
        for (const c of cards) {
          const prev = prevByWord.get(c.id);
          if (prev) c.translation = prev.translation;
          for (const ex of c.examples) {
            const ru = ruByEn.get(ex.en);
            if (ru) ex.ru = ru;
          }
        }
      }

      const newDeck: Deck = {
        videoId: t.videoId,
        title: t.title,
        author: t.author,
        thumbnail: t.thumbnail,
        duration: t.duration,
        createdAt: existing?.createdAt ?? Date.now(),
        builderVersion: CARDS_VERSION,
        totalWords: countUnits(t), // denominator for «готовность»
        cards,
        srs: {},
      };

      segmentsCache.current.set(t.videoId, {
        segments: t.segments,
        chapters: t.chapters || [],
      });
      deckCache.current.set(newDeck.videoId, newDeck);
      setDeck(newDeck);
      setShowDict(false);
      setActive(new Set(DEFAULT_FILTER));
      setStatus('learning');
      setSearch('');
      setLoading(false);
      track('video_added', { video_id: t.videoId, cards: cards.length, auto_subs: t.auto });
      repo
        .saveDeckFull(newDeck)
        .then(() => repo.listDecks())
        .then(setDecks)
        .catch((e) => console.warn('Не удалось сохранить колоду:', e));
      translateAllWords(newDeck, myToken);
    } catch (e) {
      setLoading(false);
      setBusyKind(null);
      const msg = e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.';
      track('video_add_failed', { code: e instanceof ApiError ? e.code : 'UNKNOWN' });
      setError(msg);
    }
  }

  /* ---------- progressive word translation ---------- */
  async function translateAllWords(target: Deck, myToken: number) {
    if (!repo) return;
    const missing = target.cards.filter((c) => !c.translation);
    if (missing.length === 0) return;
    setTranslating(true);
    setTProgress({ done: 0, total: missing.length });
    const CHUNK = 25;
    let latestCards: Card[] | null = null;
    for (let i = 0; i < missing.length; i += CHUNK) {
      if (token.current !== myToken) return; // user moved on
      const chunk = missing.slice(i, i + CHUNK);
      let translations: Awaited<ReturnType<typeof translateWords>>;
      try {
        // one request per word returns the main translation AND every
        // dictionary meaning, so multi-sense words are visible on the card
        translations = await translateWords(chunk.map((c) => c.word));
      } catch {
        continue;
      }
      if (token.current !== myToken) return;
      setTProgress({ done: Math.min(i + CHUNK, missing.length), total: missing.length });
      setDeck((prev) => {
        if (!prev || prev.videoId !== target.videoId) return prev;
        const map = new Map(chunk.map((c, j) => [c.id, translations[j]]));
        const cards = prev.cards.map((c) => {
          const t = map.get(c.id);
          return t
            ? { ...c, translation: t.translation, senses: t.senses.length ? t.senses : undefined }
            : c;
        });
        latestCards = cards;
        return { ...prev, cards };
      });
    }
    if (token.current === myToken) {
      setTranslating(false);
      setTProgress(null);
      if (latestCards) {
        repo
          .saveCards(target.videoId, latestCards)
          .catch((e) => console.warn('Не удалось сохранить переводы:', e));
      }
    }
  }

  /* ---------- lazy example translation ---------- */
  /**
   * Translate the context sentences of many cards at once and RETURN the
   * filled-in cards.
   *
   * Returning them matters: study sessions used to snapshot their cards first
   * and only then kick off translation, which wrote into `deck` state — so the
   * session itself kept the untranslated copies and every card showed English
   * context only. Batching also replaces up to 40 full deck writes with one.
   */
  async function fillExampleTranslations(cards: Card[]): Promise<Card[]> {
    const need: string[] = [];
    const seen = new Set<string>();
    for (const c of cards) {
      for (const ex of c.examples.slice(0, MAX_EXAMPLE_RU)) {
        if (!ex.ru && !seen.has(ex.en)) {
          seen.add(ex.en);
          need.push(ex.en);
        }
      }
    }
    if (need.length === 0) return cards;

    let translations: string[];
    try {
      translations = await translateBatch(need);
    } catch {
      return cards; // context stays EN-only rather than blocking the session
    }
    const byEn = new Map<string, string>();
    need.forEach((en, i) => {
      const ru = translations[i];
      if (ru && ru !== en) byEn.set(en, ru);
    });
    if (byEn.size === 0) return cards;

    const apply = (c: Card): Card => {
      let touched = false;
      const examples = c.examples.map((ex, i) => {
        if (ex.ru || i >= MAX_EXAMPLE_RU) return ex;
        const ru = byEn.get(ex.en);
        if (!ru) return ex;
        touched = true;
        return { ...ex, ru };
      });
      return touched ? { ...c, examples } : c;
    };

    // the same sentences often appear in other cards — fill the whole deck once
    setDeck((prev) => {
      if (!prev) return prev;
      const updated = prev.cards.map(apply);
      if (repo) {
        repo
          .saveCards(prev.videoId, updated)
          .catch((e) => console.warn('Не удалось сохранить перевод примера:', e));
      }
      return { ...prev, cards: updated };
    });

    return cards.map(apply);
  }

  /** Single-card path: revealing a card in the grid. */
  async function translateExamples(card: Card) {
    await fillExampleTranslations([card]);
  }

  function persistWord(ws: WordState) {
    setWords((m) => new Map(m).set(ws.word, ws));
    repo?.saveWord(ws).catch((e) => console.warn('Не удалось сохранить слово:', e));
  }

  function applyGrade(card: StudyCard, grade: number) {
    const prev = words.get(card.id);
    const prevSrs = prev?.srs ?? initialSrs();
    const wasLearned = isLearnedSrs(prevSrs);
    const srs = review(prevSrs, grade);
    persistWord({
      word: card.id,
      status: 'learning',
      srs,
      sources: mergeSources(prev?.sources, card.videoId),
      translation: card.translation || prev?.translation || '',
      updatedAt: Date.now(),
    });
    const nowLearned = isLearnedSrs(srs);
    setStats((s) => {
      const next = bumpStats(s, { r: 1, l: nowLearned && !wasLearned ? 1 : 0 });
      repo?.saveStats(next).catch(() => {});
      return next;
    });
  }

  function markKnownWord(word: string, translation: string, videoId?: string) {
    const prev = words.get(word);
    persistWord({
      word,
      status: 'known',
      srs: prev?.srs ?? initialSrs(),
      sources: mergeSources(prev?.sources, videoId),
      translation: translation || prev?.translation || '',
      updatedAt: Date.now(),
    });
    track('word_known');
  }

  function unmarkKnown(w: WordState) {
    persistWord({
      ...w,
      status: 'learning',
      srs: { ...w.srs, due: Date.now() },
      updatedAt: Date.now(),
    });
  }

  /** «Не узнал в видео» — back into the rotation, due right away. */
  function relearnWord(key: string) {
    const prev = words.get(key);
    persistWord({
      word: key,
      status: 'learning',
      srs: { ...(prev?.srs ?? initialSrs()), due: Date.now() },
      sources: mergeSources(prev?.sources, deck?.videoId),
      translation: prev?.translation || deck?.cards.find((c) => c.id === key)?.translation || '',
      updatedAt: Date.now(),
    });
    track('word_relearn');
  }

  /**
   * Subtitles + chapters for a video, from the global transcript cache.
   * Watch mode and the chapter panel share one fetch per session.
   */
  async function ensureTranscript(videoId: string, overlay = true) {
    const cached = segmentsCache.current.get(videoId);
    if (cached) return cached;
    if (overlay) {
      setLoading(true);
      setBusyKind('open');
    }
    try {
      const t = await fetchTranscript(videoId);
      const data = { segments: t.segments, chapters: t.chapters || [] };
      segmentsCache.current.set(videoId, data);
      return data;
    } finally {
      if (overlay) {
        setLoading(false);
        setBusyKind(null);
      }
    }
  }

  /** Open watch mode, optionally starting at a chapter. */
  async function openWatch(startAt?: number) {
    if (!deck) return;
    try {
      const { segments } = await ensureTranscript(deck.videoId);
      setWatch({ segments, startAt });
      track('watch_started', { video_id: deck.videoId, from_chapter: startAt != null });
    } catch {
      setError('Не удалось загрузить субтитры для просмотра.');
    }
  }

  /** Show the video split into parts, each with its own readiness. */
  async function toggleChapters() {
    if (!deck) return;
    if (chaptersOpen) {
      setChaptersOpen(false);
      return;
    }
    setChaptersOpen(true);
    if (chapterInfo) return; // already computed for this deck
    try {
      const { segments, chapters } = await ensureTranscript(deck.videoId, false);
      const resolved = resolveChapters(chapters, segments, deck.duration);
      setChapterInfo(analyzeChapters(segments, resolved, deck.cards));
      track('chapters_opened', { video_id: deck.videoId, chapters: resolved.length });
    } catch {
      setChapterInfo([]);
      setError('Не удалось загрузить субтитры для разбивки на главы.');
    }
  }

  /* ---------- derived: deck view ---------- */
  const counts = useMemo<Record<Difficulty, number>>(() => {
    const c = { easy: 0, medium: 0, hard: 0 };
    deck?.cards.forEach((card) => {
      if (!isMastered(words.get(card.id))) c[card.difficulty] += 1;
    });
    return c;
  }, [deck, words]);

  const masteredCount = useMemo(
    () => (deck ? deck.cards.filter((c) => isMastered(words.get(c.id))).length : 0),
    [deck, words],
  );

  const deckPct = useMemo(
    () => (deck ? pctMastered(deck.cards.map((c) => c.id), words) : null),
    [deck, words],
  );

  // Null until the user's vocabulary is measured. Readiness is deliberately
  // NOT shown before that: any fixed assumption puts every video at ~75%,
  // which describes English rather than the learner.
  const knownRank = profile.calibratedAt
    ? profile.knownRank ?? DEFAULT_KNOWN_RANK
    : null;

  // «готовность к видео»: share of the SPOKEN words the user understands.
  // Also null for decks built before coverage — they get it when rebuilt.
  const deckReadiness = useMemo(
    () =>
      knownRank === null
        ? null
        : readinessOf(coverageFromCards(deck?.cards || [], deck?.totalWords), words, knownRank),
    [deck, words, knownRank],
  );

  /** Store the measured vocabulary size and recompute every readiness with it. */
  function applyLevel(vocabulary: number) {
    const next: Profile = {
      knownRank: Math.max(200, Math.min(10000, vocabulary)),
      vocabEstimate: vocabulary,
      calibratedAt: Date.now(),
    };
    setProfile(next);
    setLevelTest(false);
    track('level_measured', { vocabulary });
    repo?.saveProfile(next).catch((e) => console.warn('Не удалось сохранить уровень:', e));
  }

  const visible = useMemo(() => {
    if (!deck) return [];
    const q = search.trim().toLowerCase();
    let list = deck.cards.filter((c) => active.has(c.difficulty));
    if (status === 'learning') list = list.filter((c) => !isMastered(words.get(c.id)));
    else if (status === 'mastered') list = list.filter((c) => isMastered(words.get(c.id)));
    if (q) {
      list = list.filter(
        (c) => c.word.includes(q) || c.translation.toLowerCase().includes(q),
      );
    }
    const order = deck.cards;
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'alpha':
          return a.word.localeCompare(b.word);
        case 'difficulty':
          return b.rank === a.rank ? b.count - a.count : b.rank - a.rank;
        case 'appearance':
          return order.indexOf(a) - order.indexOf(b);
        default:
          return b.count - a.count || a.rank - b.rank;
      }
    });
    return list;
  }, [deck, active, search, sort, words, status]);

  const dueCount = useMemo(() => {
    if (!deck) return 0;
    const now = Date.now();
    return visible.filter((c) => {
      const ws = words.get(c.id);
      return !isKnown(ws) && isDue(ws?.srs, now);
    }).length;
  }, [deck, visible, words]);

  /* ---------- derived: home ---------- */
  const dueTodayCount = useMemo(() => dueWords(words).length, [words]);
  const learnedTotal = useMemo(
    () => [...words.values()].filter((w) => isLearnedAuto(w) || isKnown(w)).length,
    [words],
  );
  const streak = useMemo(() => calcStreak(stats), [stats]);
  const todayReviews = useMemo(() => reviewsToday(stats), [stats]);

  /* ---------- actions ---------- */
  function toggleDiff(d: Difficulty) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next.size === 0 ? new Set([d]) : next;
    });
  }

  async function startStudy() {
    if (!deck) return;
    const now = Date.now();
    const pool0 = visible.filter((c) => !isKnown(words.get(c.id)));
    const due = pool0.filter((c) => isDue(words.get(c.id)?.srs, now));
    const pool = (due.length ? due : pool0).slice(0, STUDY_SESSION_MAX);
    if (pool.length === 0) return;
    setTranslating(true);
    const ready = await fillExampleTranslations(pool);
    setTranslating(false);
    track('study_started', { cards: ready.length });
    setStudyCards(ready.map((c) => ({ ...c, videoId: deck.videoId })));
  }

  /**
   * Study exactly the words that buy the most understanding — the plan behind
   * «до 90%». Order is preserved: the most frequent word comes first.
   */
  async function startPlanStudy(ids: string[]) {
    if (!deck || ids.length === 0) return;
    const byId = new Map(deck.cards.map((c) => [c.id, c]));
    const pool = ids
      .map((id) => byId.get(id))
      .filter((c): c is Card => !!c && !isKnown(words.get(c.id)))
      .slice(0, STUDY_SESSION_MAX);
    if (pool.length === 0) return;
    setTranslating(true);
    const ready = await fillExampleTranslations(pool);
    setTranslating(false);
    track('study_started', { cards: ready.length, mode: 'plan' });
    setStudyCards(ready.map((c) => ({ ...c, videoId: deck.videoId })));
  }

  /** «Повторить сегодня»: due words from ALL videos, each with its own context. */
  async function startGlobalReview() {
    if (!repo) return;
    const due = dueWords(words).slice(0, STUDY_SESSION_MAX);
    if (due.length === 0) return;
    setLoading(true);
    setBusyKind('open');
    try {
      const deckIds = new Set(decks.map((d) => d.videoId));
      const cards: StudyCard[] = [];
      for (const w of due) {
        const sourceId = w.sources.find((id) => deckIds.has(id));
        let card: Card | undefined;
        if (sourceId) {
          let full = deckCache.current.get(sourceId);
          if (!full) {
            full = (await repo.loadDeck(sourceId).catch(() => null)) || undefined;
            if (full) deckCache.current.set(sourceId, full);
          }
          card = full?.cards.find((c) => c.id === w.word);
        }
        cards.push(
          card
            ? { ...card, translation: card.translation || w.translation, videoId: sourceId! }
            : {
                id: w.word,
                word: w.word,
                translation: w.translation,
                examples: [],
                count: 1,
                rank: UNRANKED,
                difficulty: 'medium',
                videoId: w.sources[0] || '',
              },
        );
      }
      // translate first examples in-memory so the session has RU context
      const needs = cards.filter((c) => c.examples[0] && !c.examples[0].ru);
      if (needs.length) {
        try {
          const ru = await translateBatch(needs.map((c) => c.examples[0].en));
          needs.forEach((c, i) => {
            c.examples = c.examples.map((ex, j) => (j === 0 ? { ...ex, ru: ru[i] } : ex));
          });
        } catch {
          /* examples stay EN-only */
        }
      }
      track('global_review_started', { cards: cards.length });
      setStudyCards(cards);
    } finally {
      setLoading(false);
      setBusyKind(null);
    }
  }

  async function openDeck(meta: DeckMeta) {
    if (!repo) return;
    // decks built by an older pipeline get rebuilt from the cached transcript
    // (fast: the transcript is in the global cache) — lemmatization etc. apply
    if ((meta.builderVersion ?? 1) < CARDS_VERSION) {
      return handleSubmit(meta.videoId);
    }
    token.current++;
    setLoading(true);
    const cached = deckCache.current.has(meta.videoId);
    if (!cached) setBusyKind('open'); // instant from memory → no overlay flash
    setError(null);
    try {
      const full = deckCache.current.get(meta.videoId) || (await repo.loadDeck(meta.videoId));
      if (!full) throw new Error('missing');
      deckCache.current.set(meta.videoId, full);
      setDeck(full);
      setShowDict(false);
      setActive(new Set(DEFAULT_FILTER));
      setStatus('learning');
      setSearch('');
      track('deck_opened', { video_id: meta.videoId });
      translateAllWords(full, token.current);
    } catch {
      setError('Не удалось открыть колоду. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
      setBusyKind(null);
    }
  }

  function openDeckById(videoId: string) {
    const meta = decks.find((d) => d.videoId === videoId);
    if (meta) openDeck(meta);
  }

  async function removeDeck(videoId: string) {
    if (!repo) return;
    if (deck?.videoId === videoId) setDeck(null);
    deckCache.current.delete(videoId);
    setDecks((prev) => prev.filter((d) => d.videoId !== videoId));
    try {
      await repo.deleteDeck(videoId);
    } catch (e) {
      console.warn('Не удалось удалить колоду:', e);
    }
  }

  // Linking adds a provider to the same uid, so onAuthStateChanged may not
  // fire — refresh the header state from the current user explicitly.
  function afterLogin() {
    const u = auth.currentUser;
    if (u) {
      setUser({ ...u } as User);
      setRepo(cloudRepo(u.uid));
    }
    track('google_linked');
  }

  function goHome() {
    setDeck(null);
    setShowDict(false);
  }

  function exportTsv() {
    if (!deck) return;
    track('export', { format: 'anki_tsv', cards: visible.length });
    download(`${slug(deck.title)}-anki.txt`, toAnkiTsv(visible), 'text/plain');
  }
  function exportCsv() {
    if (!deck) return;
    track('export', { format: 'csv', cards: visible.length });
    download(`${slug(deck.title)}.csv`, toCsv(visible), 'text/csv');
  }

  /* ---------- render ---------- */
  return (
    <>
    {/* invisible while studying or playing a clip: 3D-flipped cards
        (preserve-3d) would otherwise paint through fixed overlays */}
    <div
      className={`flex min-h-screen flex-col ${
        studyCards || clip || watch || watchSummary ? 'invisible' : ''
      }`}
    >
      <Header
        user={user}
        repo={repo}
        onLogin={() => setShowLogin(true)}
        onHome={goHome}
        onDict={() => {
          setDeck(null);
          setShowDict(true);
          track('dict_opened');
        }}
        dictActive={showDict}
      />

      {deck ? (
        <main className="px-4 pb-24 pt-6">
          <VideoHeader
            deck={deck}
            cardCount={deck.cards.length}
            pct={deckPct}
            readiness={deckReadiness}
            needsLevel={knownRank === null}
            vocabulary={profile.vocabEstimate ?? profile.knownRank}
            onCalibrate={() => setLevelTest(true)}
            showChapters={canSplitIntoChapters(deck.duration)}
            chapterCount={chapterInfo?.length || null}
            chaptersOpen={chaptersOpen}
            onNew={goHome}
            onWatch={() => openWatch()}
            onStudyPlan={() => startPlanStudy(deckReadiness?.plan || [])}
            onToggleChapters={toggleChapters}
          />
          {chaptersOpen && (
            <ChapterList
              chapters={chapterInfo}
              words={words}
              knownRank={knownRank}
              onStudy={startPlanStudy}
              onCalibrate={() => setLevelTest(true)}
              onWatch={(start) => openWatch(start)}
            />
          )}
          <Toolbar
            counts={counts}
            active={active}
            onToggle={toggleDiff}
            search={search}
            onSearch={setSearch}
            sort={sort}
            onSort={setSort}
            visible={visible.length}
            dueCount={dueCount}
            masteredCount={masteredCount}
            learningCount={deck.cards.length - masteredCount}
            status={status}
            onStatus={setStatus}
            onStudy={startStudy}
            onExportTsv={exportTsv}
            onExportCsv={exportCsv}
          />

          {translating && (
            <div className="mx-auto mb-4 flex max-w-6xl items-center gap-2 text-sm text-ink-400">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-ink-200 border-t-ink-900 animate-spin-slow" />
              {tProgress
                ? `Переводим слова: ${tProgress.done} из ${tProgress.total}`
                : 'Переводим слова…'}
            </div>
          )}

          <div className="mx-auto max-w-6xl">
            {visible.length === 0 ? (
              <p className="py-20 text-center text-ink-400">
                {status === 'mastered'
                  ? 'Под этими фильтрами вы пока ничего не выучили.'
                  : masteredCount > 0 && status === 'learning'
                    ? 'Все слова под этими фильтрами вы уже знаете. 🎉'
                    : 'Ничего не найдено. Измените фильтры или запрос.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visible.slice(0, renderCount).map((card) => (
                    <WordCard
                      key={card.id}
                      card={card}
                      videoId={deck.videoId}
                      mastered={isMastered(words.get(card.id))}
                      onReveal={translateExamples}
                      onKnown={(c) => markKnownWord(c.id, c.translation, deck.videoId)}
                      onPlayClip={(c, ex) => playClip(deck.videoId, c, ex)}
                    />
                  ))}
                </div>
                {visible.length > renderCount && (
                  <AutoLoadMore
                    remaining={visible.length - renderCount}
                    onMore={() => setRenderCount((c) => c + 96)}
                  />
                )}
              </>
            )}
          </div>
        </main>
      ) : showDict ? (
        <Dictionary
          words={words}
          decks={decks}
          tab={dictTab}
          onTab={setDictTab}
          onReview={startGlobalReview}
          onMarkKnown={(w) => markKnownWord(w.word, w.translation)}
          onUnmarkKnown={unmarkKnown}
          onOpenVideo={openDeckById}
        />
      ) : (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-6">
        {/* pb ~18vh biases flex-centering upward: optical center above geometric */}
        <div className="flex flex-1 flex-col justify-center pb-[18vh]">
          {(words.size > 0 || decks.length > 0) && (
            <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-sm">
              {streak > 0 && (
                <span className="border border-ink-900 bg-[#f2d94c] px-3 py-1.5 font-bold text-ink-900">
                  🔥 {streak} {plural(streak, 'день', 'дня', 'дней')} подряд
                </span>
              )}
              <span className="border border-ink-900 bg-white px-3 py-1.5 font-bold text-ink-900">
                выучено: {learnedTotal}
              </span>
              {todayReviews > 0 && (
                <span className="border border-ink-300 bg-white px-3 py-1.5 text-ink-500">
                  сегодня: {todayReviews} повт.
                </span>
              )}
              {dueTodayCount > 0 && (
                <button
                  onClick={() => {
                    setDictTab('due');
                    setShowDict(true);
                    track('dict_opened', { from: 'due_chip' });
                  }}
                  className="border border-ink-900 bg-[#f7dd4b] px-3 py-1.5 font-bold text-ink-900 transition hover:opacity-90"
                  title="Показать слова, которые пора повторить"
                >
                  к повторению: {dueTodayCount}
                </button>
              )}
              <button
                onClick={() => setLevelTest(true)}
                className={`border px-3 py-1.5 transition hover:bg-ink-100 ${
                  knownRank !== null
                    ? 'border-ink-900 bg-white font-bold text-ink-900'
                    : 'border-dashed border-ink-400 text-ink-500'
                }`}
                title="Проверка словарного запаса — от неё зависит «готовность к видео»"
              >
                {knownRank !== null
                  ? `словарь: ≈${(profile.vocabEstimate ?? knownRank).toLocaleString('ru')} слов · изменить`
                  : 'проверить словарь'}
              </button>
            </div>
          )}

          <p className="mx-auto mb-6 max-w-xl text-center text-base text-ink-500">
            Вставьте ссылку на YouTube — выгрузим субтитры и соберём карточки
            со словами, переводом и примерами в контексте.
          </p>
          <UrlForm
            onSubmit={handleSubmit}
            loading={loading}
            disabled={!repo}
            error={error}
            onWarmup={warmIngest}
          />
          <DeckList
            decks={decks}
            words={words}
            knownRank={knownRank}
            loading={decksLoading}
            onOpen={openDeck}
            onDelete={removeDeck}
          />
        </div>
        <footer className="shrink-0 py-4 text-center text-xs text-ink-400">
          Copyright 2026{' '}
          <a
            href="https://cryptonerf.github.io/portfolio/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted transition hover:text-ink-900"
          >
            Émile Alexanyan
          </a>
        </footer>
        </main>
      )}
    </div>

      {studyCards && (
        <StudyView
          cards={studyCards}
          onGrade={applyGrade}
          onKnown={(c) => markKnownWord(c.id, c.translation, c.videoId)}
          onPlayClip={(c, ex) => playClip(c.videoId, c, ex)}
          paused={!!clip}
          onClose={() => setStudyCards(null)}
        />
      )}

      {clip && <ClipPlayer clip={clip} onClose={() => setClip(null)} />}

      {watch && deck && (
        <WatchView
          videoId={deck.videoId}
          title={deck.title}
          segments={watch.segments}
          cards={deck.cards}
          words={words}
          startAt={watch.startAt}
          onKnown={(key, translation) => markKnownWord(key, translation, deck.videoId)}
          onRelearn={relearnWord}
          onClose={(seen) => {
            setWatch(null);
            if (seen.length > 0) setWatchSummary(seen);
            track('watch_finished', { words_seen: seen.length });
          }}
        />
      )}

      {levelTest && (
        <LevelTest
          skip={new Set(words.keys())}
          onDone={applyLevel}
          onClose={() => setLevelTest(false)}
        />
      )}

      {watchSummary && deck && (
        <WatchSummary
          seen={watchSummary}
          deck={deck}
          words={words}
          onRelearn={relearnWord}
          onClose={() => setWatchSummary(null)}
        />
      )}

      {busyKind && <IngestOverlay elapsed={elapsed} mode={busyKind} />}

      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} onGoogleLinked={afterLogin} />
      )}
    </>
  );
}

function mergeSources(prev: string[] | undefined, videoId?: string): string[] {
  const set = new Set(prev || []);
  if (videoId) set.add(videoId);
  return [...set];
}

/** Sentinel at the grid's end: auto-loads more cards as the user scrolls near. */
function AutoLoadMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onMore();
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onMore]);

  return (
    <button
      ref={ref}
      onClick={onMore}
      className="mx-auto mt-6 block border border-ink-900 bg-white px-4 py-2 text-sm font-bold text-ink-900 transition hover:bg-ink-100"
    >
      показать ещё ({remaining})
    </button>
  );
}

interface HeaderProps {
  user: User | null;
  repo: Repo | null;
  onLogin: () => void;
  onHome: () => void;
  onDict: () => void;
  dictActive: boolean;
}

function Header({ user, repo, onLogin, onHome, onDict, dictActive }: HeaderProps) {
  return (
    <header className="border-b border-ink-900 bg-[#f4f2ea] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <Logo onHome={onHome} />
        <span className="hidden text-sm text-ink-500 lg:inline">
          английский по YouTube
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <button
            onClick={onDict}
            className={`shrink-0 border px-2.5 py-1.5 text-xs font-bold transition sm:px-3 ${
              dictActive
                ? 'border-ink-900 bg-ink-900 text-white'
                : 'border-ink-900 bg-white text-ink-900 hover:bg-ink-100'
            }`}
          >
            <span className="sm:hidden">словарь</span>
            <span className="hidden sm:inline">мой словарь</span>
          </button>
          {user && !user.isAnonymous ? (
            <span
              className="flex min-w-0 max-w-[34vw] items-center gap-1 border border-ink-900 bg-[#cfe36e] px-2 py-1.5 text-xs font-bold text-ink-900 sm:max-w-[200px] sm:px-2.5"
              title={user.email || ''}
            >
              <span className="shrink-0">✓</span>
              <span className="truncate">
                {user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'аккаунт'}
              </span>
            </span>
          ) : user ? (
            <button
              onClick={onLogin}
              className="shrink-0 border border-ink-900 bg-white px-2.5 py-1.5 text-xs font-bold text-ink-900 transition hover:bg-ink-100 sm:px-3"
              title="Войти — синхронизировать прогресс между устройствами"
            >
              войти
            </button>
          ) : repo ? (
            <span
              className="shrink-0 border border-dashed border-ink-400 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-400 sm:px-3"
              title="Облако недоступно, данные хранятся в этом браузере"
            >
              локально
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9а-я]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'molly'
  );
}
