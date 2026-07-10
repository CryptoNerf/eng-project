import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/words';
import { XIcon } from './Icons';

export interface Clip {
  videoId: string;
  start: number;
  end: number;
  en: string;
  ru?: string;
  word?: string;
  forms?: string[];
}

interface Props {
  clip: Clip;
  onClose: () => void;
}

/* ---------------- YouTube IFrame API loader (once per session) ---------------- */

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
      PlayerState?: { PLAYING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  seekTo(sec: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  destroy(): void;
}

let ytApi: Promise<NonNullable<Window['YT']>> | null = null;
function loadYouTubeApi(): Promise<NonNullable<Window['YT']>> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApi) {
    ytApi = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApi;
}

/* ---------------- highlight the learned word in the phrase ---------------- */

function Highlighted({ sentence, forms }: { sentence: string; forms?: string[] }) {
  if (!forms?.length) return <>{sentence}</>;
  const esc = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const splitter = new RegExp(`(\\b(?:${esc})\\w*)`, 'gi');
  const matcher = new RegExp(`^(?:${esc})\\w*$`, 'i');
  return (
    <>
      {sentence.split(splitter).map((p, i) =>
        matcher.test(p) ? (
          <mark key={i} className="bg-[#f7dd4b] px-0.5 font-bold text-ink-900">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Modal with an embedded YouTube player: starts at the phrase, auto-pauses at
 * its end, «ещё раз» replays. Lets the learner hear the word in the real
 * speaker's voice without leaving the app.
 */
export function ClipPlayer({ clip, onClose }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);

  // small lead-in so the phrase isn't clipped at the start
  const start = Math.max(0, clip.start - 0.4);
  const end = clip.end + 0.4;

  useEffect(() => {
    let cancelled = false;
    let watcher: ReturnType<typeof setInterval> | undefined;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !holderRef.current) return;
      playerRef.current = new YT.Player(holderRef.current, {
        videoId: clip.videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: Math.floor(start),
          autoplay: 1,
          playsinline: 1, // iOS: play in place, not fullscreen
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            setReady(true);
            e.target.seekTo(start, true);
            e.target.playVideo(); // may be ignored on iOS — YouTube's own ▶ works
          },
        },
      });
      // pause when the phrase ends
      watcher = setInterval(() => {
        const p = playerRef.current;
        if (!p?.getCurrentTime) return;
        try {
          if (p.getCurrentTime() >= end) p.pauseVideo();
        } catch {
          /* player not ready yet */
        }
      }, 250);
    });

    return () => {
      cancelled = true;
      if (watcher) clearInterval(watcher);
      try {
        playerRef.current?.destroy();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.videoId, clip.start]);

  function replay() {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(start, true);
    p.playVideo();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/85 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg border-2 border-ink-900 bg-white animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-900 px-3 py-2">
          <span className="text-sm font-bold text-ink-900">
            фраза из видео · {formatTime(clip.start)}
          </span>
          <button onClick={onClose} className="p-1 text-ink-400 hover:text-ink-900">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-video w-full bg-ink-900">
          <div ref={holderRef} className="absolute inset-0 h-full w-full" />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="h-8 w-8 rounded-full border-2 border-white/30 border-t-white animate-spin-slow" />
            </div>
          )}
        </div>

        <div className="space-y-1 px-3 py-3">
          <p className="text-sm leading-snug text-ink-800">
            <Highlighted sentence={clip.en} forms={clip.forms} />
          </p>
          {clip.ru && <p className="text-xs text-ink-400">{clip.ru}</p>}
          <button
            onClick={replay}
            className="mt-2 border border-ink-900 bg-[#f7dd4b] px-3 py-1.5 text-sm font-bold text-ink-900 transition hover:opacity-90"
          >
            ⟲ ещё раз
          </button>
        </div>
      </div>
    </div>
  );
}
