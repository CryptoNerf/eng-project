import type { CSSProperties } from 'react';
import type { DeckMeta } from '../lib/types';
import { tiltFor } from '../lib/palette';
import { pctMastered, type WordsMap } from '../lib/vocab';
import { BookIcon, TrashIcon } from './Icons';

interface Props {
  decks: DeckMeta[];
  words: WordsMap;
  onOpen: (deck: DeckMeta) => void;
  onDelete: (videoId: string) => void;
}

export function DeckList({ decks, words, onOpen, onDelete }: Props) {
  if (decks.length === 0) return null;
  return (
    <div className="mx-auto mt-14 w-full max-w-3xl">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-500">
        <BookIcon className="h-4 w-4" />
        ваши коллекции
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {decks.map((d) => {
          const pct = pctMastered(d.wordIds, words);
          return (
          <div
            key={d.videoId}
            style={{ '--tilt': tiltFor(d.videoId) } as CSSProperties}
            className="paper-tilt group flex cursor-pointer items-center gap-3 border border-ink-900 bg-white p-2.5 transition"
            onClick={() => onOpen(d)}
          >
            <img
              src={d.thumbnail}
              alt=""
              className="h-14 w-24 shrink-0 border border-ink-900 object-cover"
              loading="lazy"
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-bold text-ink-900">{d.title}</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {d.cardCount} слов · {d.author}
              </p>
              {pct !== null && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 w-24 border border-ink-900 bg-white">
                    <div className="h-full bg-[#cfe36e]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-ink-600">знаете {pct}%</span>
                </div>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(d.videoId);
              }}
              className="shrink-0 p-2 text-ink-300 opacity-0 transition hover:text-[#c2401f] group-hover:opacity-100"
              title="Удалить"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
