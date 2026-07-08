import type { Deck } from '../lib/types';
import { formatTime } from '../lib/words';
import { LinkIcon, PlusIcon } from './Icons';

interface Props {
  deck: Deck;
  cardCount: number;
  pct: number | null; // «вы знаете X%» этого видео
  onNew: () => void;
}

export function VideoHeader({ deck, cardCount, pct, onNew }: Props) {
  return (
    <div className="mx-auto mb-6 max-w-6xl">
      <div className="flex flex-col gap-4 border border-ink-900 bg-white p-4 sm:flex-row sm:items-center">
        <a
          href={`https://www.youtube.com/watch?v=${deck.videoId}`}
          target="_blank"
          rel="noreferrer"
          className="relative block w-full shrink-0 overflow-hidden border border-ink-900 sm:w-56"
        >
          <img
            src={deck.thumbnail}
            alt={deck.title}
            className="aspect-video w-full object-cover"
            loading="lazy"
          />
          {deck.duration > 0 && (
            <span className="absolute bottom-1.5 right-1.5 bg-ink-900 px-1.5 py-0.5 text-xs font-bold text-white">
              {formatTime(deck.duration)}
            </span>
          )}
        </a>

        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-lg font-bold leading-snug text-ink-900">
            {deck.title}
          </h2>
          {deck.author && <p className="mt-0.5 text-sm text-ink-500">{deck.author}</p>}
          {pct !== null && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 w-40 border border-ink-900 bg-white">
                <div className="h-full bg-[#cfe36e]" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs font-bold text-ink-700">вы знаете {pct}%</span>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="bg-ink-900 px-2.5 py-1 text-sm font-bold text-white">
              {cardCount} {plural(cardCount, 'слово', 'слова', 'слов')}
            </span>
            <a
              href={`https://www.youtube.com/watch?v=${deck.videoId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 border border-ink-900 px-2.5 py-1 text-sm text-ink-900 transition hover:bg-ink-100"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              открыть на YouTube
            </a>
          </div>
        </div>

        <button
          onClick={onNew}
          className="inline-flex shrink-0 items-center gap-2 self-start border border-ink-900 bg-white px-4 py-2.5 text-sm font-bold text-ink-900 transition hover:bg-ink-100 sm:self-center"
        >
          <PlusIcon className="h-4 w-4" />
          новое видео
        </button>
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
