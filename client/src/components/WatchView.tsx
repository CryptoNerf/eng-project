import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, Segment } from '../lib/types';
import {
  annotateLine,
  buildLines,
  formatTime,
  transcriptVocab,
  type Line,
} from '../lib/words';
import { isMastered, type WordsMap } from '../lib/vocab';
import { translateBatch, translateWords } from '../lib/translate';
import { loadYouTubeApi, type YTPlayer } from '../lib/youtube';
import { speak } from '../lib/tts';
import { CheckIcon, SoundIcon, XIcon } from './Icons';

interface Props {
  videoId: string;
  title: string;
  segments: Segment[];
  cards: Card[];
  words: WordsMap;
  startAt?: number; // seconds — opening a chapter starts there
  onKnown: (key: string, translation: string) => void;
  onRelearn: (key: string) => void;
  onClose: (seen: string[]) => void;
}

interface Picked {
  key: string;
  word: string;
  translation: string;
  known: boolean;
}

/**
 * Watch the video with interactive subtitles — the payoff step: words you
 * studied are highlighted as they're spoken, tapping any word shows its
 * translation, and each line can be repeated on demand.
 */
export function WatchView({
  videoId,
  title,
  segments,
  cards,
  words,
  startAt,
  onKnown,
  onRelearn,
  onClose,
}: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pauseAtLineEnd, setPauseAtLineEnd] = useState(false);
  const [showRu, setShowRu] = useState(true);
  const [ru, setRu] = useState<Map<number, string>>(new Map());
  const seenRef = useRef<Set<string>>(new Set());
  const ruPending = useRef<Set<number>>(new Set());
  // attempts per line: a sentence the translator keeps echoing back must not
  // be retried forever by the safety net below
  const ruTries = useRef<Map<number, number>>(new Map());

  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  // the deck lemmatized with the video's own vocabulary — tag words the same
  // way here, or tapped words wouldn't find their cards
  const vocab = useMemo(() => transcriptVocab(segments), [segments]);
  // cues are cut by display timing; regroup them into whole sentences
  const lines = useMemo<Line[]>(() => buildLines(segments), [segments]);
  useEffect(() => {
    ruPending.current.clear();
    ruTries.current.clear();
  }, [lines]);
  const linesRef = useRef<Line[]>(lines);
  linesRef.current = lines;

  /* ---------- player ---------- */
  useEffect(() => {
    let cancelled = false;
    let ticker: ReturnType<typeof setInterval> | undefined;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !holderRef.current) return;
      playerRef.current = new YT.Player(holderRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          ...(startAt ? { start: Math.floor(startAt) } : {}),
        },
        events: { onReady: () => setReady(true) },
      });

      ticker = setInterval(() => {
        const p = playerRef.current;
        if (!p?.getCurrentTime) return;
        let t: number;
        try {
          t = p.getCurrentTime();
        } catch {
          return;
        }
        const idx = findLine(linesRef.current, t);
        setCurrent((prev) => {
          if (idx !== prev && idx >= 0) markSeen(linesRef.current[idx]);
          // pause exactly once, when the active line ends
          if (pauseAtLineEndRef.current && prev >= 0 && idx !== prev) {
            try {
              p.pauseVideo();
            } catch {
              /* ignore */
            }
          }
          return idx;
        });
        // 120 ms, not 250: the poll interval is pure added lag on every
        // line change, and getCurrentTime is cheap
      }, 120);
    });

    return () => {
      cancelled = true;
      if (ticker) clearInterval(ticker);
      try {
        playerRef.current?.destroy();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // read the toggle inside the ticker without re-creating the player
  const pauseAtLineEndRef = useRef(pauseAtLineEnd);
  useEffect(() => {
    pauseAtLineEndRef.current = pauseAtLineEnd;
  }, [pauseAtLineEnd]);

  /** Remember which studied words actually showed up on screen. */
  function markSeen(line: Line) {
    if (!line) return;
    for (const part of annotateLine(line.text, vocab)) {
      if (part.key && cardByKey.has(part.key)) seenRef.current.add(part.key);
    }
  }

  /* ---------- translate lines lazily, as they come into view ---------- */
  useEffect(() => {
    if (!showRu || !listRef.current || typeof IntersectionObserver === 'undefined') return;
    const queue: number[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pumping = false;
    let stopped = false;

    /**
     * Drain the whole queue, twelve lines per request.
     *
     * The earlier version took `slice(0, 12)` and then cleared the queue, so
     * everything past the twelfth line was dropped — and since those elements
     * were already intersecting, the observer never fired for them again and
     * they stayed untranslated for good. One screenful plus the 200px margin
     * is easily more than twelve lines, which is why translations came out
     * patchy.
     */
    const pump = async () => {
      if (pumping) return;
      pumping = true;
      try {
        while (queue.length && !stopped) {
          const batch: number[] = [];
          while (queue.length && batch.length < 12) {
            const i = queue.shift()!;
            if (!ruPending.current.has(i)) batch.push(i);
          }
          if (batch.length === 0) continue;
          batch.forEach((i) => {
            ruPending.current.add(i);
            ruTries.current.set(i, (ruTries.current.get(i) ?? 0) + 1);
          });
          try {
            const translated = await translateBatch(batch.map((i) => lines[i].text));
            if (stopped) return;
            setRu((prev) => {
              const next = new Map(prev);
              batch.forEach((i, k) => {
                const ru = translated[k];
                // translateBatch echoes the source back when a request fails —
                // storing that would show English twice and never retry
                if (ru && ru !== lines[i].text) next.set(i, ru);
                else ruPending.current.delete(i);
              });
              return next;
            });
          } catch {
            batch.forEach((i) => ruPending.current.delete(i)); // allow a retry
          }
        }
      } finally {
        pumping = false;
      }
    };

    const enqueue = (i: number) => {
      if (Number.isNaN(i) || i < 0 || i >= lines.length) return;
      if (ruPending.current.has(i) || queue.includes(i)) return;
      if ((ruTries.current.get(i) ?? 0) >= 2) return;
      queue.push(i);
    };

    const schedule = () => {
      if (!queue.length) return;
      clearTimeout(timer);
      timer = setTimeout(pump, 150); // group a screenful into one batch
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          enqueue(Number((e.target as HTMLElement).dataset.line));
        }
        schedule();
      },
      { root: listRef.current, rootMargin: '200px' },
    );

    listRef.current.querySelectorAll('[data-line]').forEach((el) => io.observe(el));
    return () => {
      stopped = true;
      io.disconnect();
      clearTimeout(timer);
    };
  }, [showRu, lines]);

  // Safety net: whatever the observer missed, the line being spoken right now
  // must always have its translation — plus a few ahead, so it is ready in time.
  useEffect(() => {
    if (!showRu || current < 0) return;
    const wanted: number[] = [];
    for (let i = current; i < Math.min(lines.length, current + 4); i++) {
      if (ru.has(i) || ruPending.current.has(i)) continue;
      if ((ruTries.current.get(i) ?? 0) >= 2) continue;
      wanted.push(i);
    }
    if (wanted.length === 0) return;
    let cancelled = false;
    wanted.forEach((i) => {
      ruPending.current.add(i);
      ruTries.current.set(i, (ruTries.current.get(i) ?? 0) + 1);
    });
    translateBatch(wanted.map((i) => lines[i].text))
      .then((translated) => {
        if (cancelled) return;
        setRu((prev) => {
          const next = new Map(prev);
          wanted.forEach((i, k) => {
            const t = translated[k];
            if (t && t !== lines[i].text) next.set(i, t);
            else ruPending.current.delete(i);
          });
          return next;
        });
      })
      .catch(() => wanted.forEach((i) => ruPending.current.delete(i)));
    return () => {
      cancelled = true;
    };
  }, [current, showRu, lines, ru]);

  /* ---------- keep the active line in view ---------- */
  useEffect(() => {
    if (current < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-line="${current}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current]);

  /* ---------- actions ---------- */
  const seek = useCallback((sec: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(Math.max(0, sec), true);
    p.playVideo();
  }, []);

  const repeatLine = useCallback(() => {
    if (current >= 0) seek(lines[current].start);
  }, [current, seek, lines]);

  async function pickWord(key: string, surface: string) {
    const card = cardByKey.get(key);
    const state = words.get(key);
    setPicked({
      key,
      word: card?.word || surface,
      translation: card?.translation || '…',
      known: isMastered(state),
    });
    if (!card?.translation) {
      try {
        const [t] = await translateWords([key]);
        setPicked((p) => (p && p.key === key ? { ...p, translation: t.translation } : p));
      } catch {
        setPicked((p) => (p && p.key === key ? { ...p, translation: '—' } : p));
      }
    }
  }

  /* ---------- render ---------- */
  const studiedTotal = seenRef.current.size;

  return (
    <div className="fixed inset-0 z-50 isolate flex transform-gpu flex-col bg-[#f4f2ea]">
      {/* header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-900 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-900">{title}</span>
        <button
          onClick={() => onClose([...seenRef.current])}
          className="shrink-0 border border-ink-900 bg-white p-1.5 text-ink-900 transition hover:bg-ink-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Body: stacked on phones, side-by-side on wide screens.
          A full-width 16:9 player would be ~810px tall on a laptop and push
          the subtitles off screen, so its height is capped by the viewport. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex shrink-0 flex-col lg:h-full lg:w-[58%] lg:justify-center lg:border-r lg:border-ink-900">
      {/* player */}
      <div className="relative w-full shrink-0 bg-ink-900 h-[min(38vh,56.25vw)] lg:h-[min(60vh,32.6vw)]">
        <div ref={holderRef} className="absolute inset-0 h-full w-full" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 rounded-full border-2 border-white/30 border-t-white animate-spin-slow" />
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-ink-900 px-3 py-2 lg:border-b-0">
        <button
          onClick={repeatLine}
          className="border border-ink-900 bg-white px-2 py-1 text-xs font-bold text-ink-900 transition hover:bg-[#f7dd4b]"
        >
          ⟲ повторить
        </button>
        <button
          onClick={() => current > 0 && seek(lines[current - 1].start)}
          className="border border-ink-900 bg-white px-2 py-1 text-xs font-bold text-ink-900 transition hover:bg-ink-100"
        >
          ← строка
        </button>
        <button
          onClick={() => current < lines.length - 1 && seek(lines[current + 1].start)}
          className="border border-ink-900 bg-white px-2 py-1 text-xs font-bold text-ink-900 transition hover:bg-ink-100"
        >
          строка →
        </button>
        <button
          onClick={() => setPauseAtLineEnd((v) => !v)}
          className={`border px-2 py-1 text-xs font-bold transition ${
            pauseAtLineEnd
              ? 'border-ink-900 bg-[#f7dd4b] text-ink-900'
              : 'border-ink-300 bg-white text-ink-400 hover:border-ink-900 hover:text-ink-900'
          }`}
        >
          пауза после фразы
        </button>
        <button
          onClick={() => setShowRu((v) => !v)}
          className={`border px-2 py-1 text-xs font-bold transition ${
            showRu
              ? 'border-ink-900 bg-[#f7dd4b] text-ink-900'
              : 'border-ink-300 bg-white text-ink-400 hover:border-ink-900 hover:text-ink-900'
          }`}
        >
          перевод строк
        </button>
        <span className="ml-auto text-[11px] text-ink-500">
          знакомых слов: {studiedTotal}
        </span>
      </div>
      </div>

      {/* subtitles — own scroll area (right column on wide screens) */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {lines.map((seg, i) => (
          <p
            key={i}
            data-line={i}
            onClick={() => seek(seg.start)}
            className={`cursor-pointer border-l-2 py-1.5 pl-2 text-[15px] leading-relaxed transition ${
              i === current
                ? 'border-[#c2401f] bg-white font-medium text-ink-900'
                : 'border-transparent text-ink-400'
            }`}
          >
            <span className="mr-2 text-[10px] text-ink-300">{formatTime(seg.start)}</span>
            {annotateLine(seg.text, vocab).map((part, j) => {
              if (!part.key) return <span key={j}>{part.text}</span>;
              const card = cardByKey.get(part.key);
              const state = words.get(part.key);
              // four states: mastered (quiet green), actively learning
              // (highlighted — the ones to catch), a card not started yet
              // (faint dots), and any other word — tappable, but unmarked
              const cls = isMastered(state)
                ? 'text-[#4c5a1e] decoration-[#cfe36e]'
                : state
                  ? 'bg-[#f7dd4b] font-medium text-ink-900'
                  : card
                    ? 'decoration-ink-300'
                    : 'decoration-transparent hover:decoration-ink-300';
              return (
                <span
                  key={j}
                  onClick={(e) => {
                    e.stopPropagation();
                    pickWord(part.key!, part.text);
                  }}
                  className={`cursor-pointer underline decoration-dotted underline-offset-2 ${cls}`}
                >
                  {part.text}
                </span>
              );
            })}
            {showRu && ru.get(i) && (
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-400">
                {ru.get(i)}
              </span>
            )}
          </p>
        ))}
        <div className="h-24" />
      </div>
      </div>

      {/* word popover */}
      {picked && (
        <div className="shrink-0 border-t-2 border-ink-900 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] animate-fade-up">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold lowercase text-ink-900">{picked.word}</span>
            <button
              onClick={() => speak(picked.word)}
              className="border border-ink-900 p-1 text-ink-900 transition hover:bg-[#f7dd4b]"
            >
              <SoundIcon className="h-4 w-4" />
            </button>
            <span className="min-w-0 flex-1 truncate text-base font-bold text-ink-700">
              = {picked.translation}
            </span>
            <button
              onClick={() => setPicked(null)}
              className="shrink-0 p-1 text-ink-400 hover:text-ink-900"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {picked.known ? (
              <button
                onClick={() => {
                  onRelearn(picked.key);
                  setPicked(null);
                }}
                className="border border-ink-900 bg-white px-2.5 py-1 text-xs font-bold text-ink-900 transition hover:bg-[#f2d94c]"
              >
                не узнал — учить снова
              </button>
            ) : (
              <button
                onClick={() => {
                  onKnown(picked.key, picked.translation);
                  setPicked(null);
                }}
                className="inline-flex items-center gap-1 border border-ink-900 bg-white px-2.5 py-1 text-xs font-bold text-ink-900 transition hover:bg-[#cfe36e]"
              >
                <CheckIcon className="h-3 w-3" />
                уже знаю
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Index of the segment covering time t, or the last one before it. */
function findLine(lines: Line[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
