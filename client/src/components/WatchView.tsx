import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, Segment } from '../lib/types';
import { annotateLine, formatTime } from '../lib/words';
import { isMastered, type WordsMap } from '../lib/vocab';
import { translateWords } from '../lib/translate';
import { loadYouTubeApi, type YTPlayer } from '../lib/youtube';
import { speak } from '../lib/tts';
import { CheckIcon, SoundIcon, XIcon } from './Icons';

interface Props {
  videoId: string;
  title: string;
  segments: Segment[];
  cards: Card[];
  words: WordsMap;
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
  const seenRef = useRef<Set<string>>(new Set());

  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

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
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
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
        const idx = findSegment(segments, t);
        setCurrent((prev) => {
          if (idx !== prev && idx >= 0) markSeen(segments[idx]);
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
      }, 250);
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
  function markSeen(seg: Segment) {
    for (const part of annotateLine(seg.text)) {
      if (part.key && cardByKey.has(part.key)) seenRef.current.add(part.key);
    }
  }

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
    if (current >= 0) seek(segments[current].start);
  }, [current, seek, segments]);

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

      {/* player */}
      <div className="relative aspect-video w-full shrink-0 bg-ink-900">
        <div ref={holderRef} className="absolute inset-0 h-full w-full" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-8 w-8 rounded-full border-2 border-white/30 border-t-white animate-spin-slow" />
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-ink-900 px-3 py-2">
        <button
          onClick={repeatLine}
          className="border border-ink-900 bg-white px-2 py-1 text-xs font-bold text-ink-900 transition hover:bg-[#f7dd4b]"
        >
          ⟲ повторить
        </button>
        <button
          onClick={() => current > 0 && seek(segments[current - 1].start)}
          className="border border-ink-900 bg-white px-2 py-1 text-xs font-bold text-ink-900 transition hover:bg-ink-100"
        >
          ← строка
        </button>
        <button
          onClick={() => current < segments.length - 1 && seek(segments[current + 1].start)}
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
        <span className="ml-auto text-[11px] text-ink-500">
          знакомых слов: {studiedTotal}
        </span>
      </div>

      {/* subtitles */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {segments.map((seg, i) => (
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
            {annotateLine(seg.text).map((part, j) => {
              const card = part.key ? cardByKey.get(part.key) : undefined;
              if (!card) return <span key={j}>{part.text}</span>;
              const state = words.get(part.key!);
              // three states: mastered (quiet green), actively learning
              // (highlighted — these are the ones to catch), not started (plain)
              const cls = isMastered(state)
                ? 'text-[#4c5a1e] decoration-[#cfe36e]'
                : state
                  ? 'bg-[#f7dd4b] font-medium text-ink-900'
                  : 'decoration-ink-300';
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
          </p>
        ))}
        <div className="h-24" />
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
function findSegment(segments: Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
