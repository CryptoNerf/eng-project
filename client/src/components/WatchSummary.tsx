import { useState } from 'react';
import type { Deck } from '../lib/types';
import { isMastered, type WordsMap } from '../lib/vocab';
import { CheckIcon } from './Icons';

interface Props {
  seen: string[]; // card keys that appeared in the subtitles while watching
  deck: Deck;
  words: WordsMap;
  onRelearn: (key: string) => void;
  onClose: () => void;
}

/**
 * Closes the loop after watching: shows how much of the video's vocabulary
 * the learner actually met on screen, and lets them push back anything they
 * didn't recognize.
 */
export function WatchSummary({ seen, deck, words, onRelearn, onClose }: Props) {
  const [pushedBack, setPushedBack] = useState<Set<string>>(new Set());

  const known = seen.filter((k) => isMastered(words.get(k)));
  const pct = deck.cards.length
    ? Math.round((seen.length / deck.cards.length) * 100)
    : 0;
  const byKey = new Map(deck.cards.map((c) => [c.id, c]));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/85 px-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col border-2 border-ink-900 bg-white animate-fade-up">
        <div className="shrink-0 border-b border-ink-900 px-4 py-3">
          <h3 className="text-lg font-bold text-ink-900">Как прошёл просмотр</h3>
          <p className="mt-1 text-sm text-ink-600">
            Вы встретили <b>{seen.length}</b> из {deck.cards.length} слов видео ({pct}%),
            из них <b>{known.length}</b> уже выучено.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">
            встреченные слова — отметьте те, что не узнали
          </p>
          <div className="flex flex-wrap gap-1.5">
            {seen.map((key) => {
              const card = byKey.get(key);
              const pushed = pushedBack.has(key);
              const mastered = isMastered(words.get(key));
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (pushed) return;
                    onRelearn(key);
                    setPushedBack((s) => new Set(s).add(key));
                  }}
                  title={card?.translation || ''}
                  className={`border px-2 py-1 text-xs font-medium transition ${
                    pushed
                      ? 'border-ink-900 bg-[#f2d94c] text-ink-900'
                      : mastered
                        ? 'border-ink-900 bg-[#cfe36e] text-ink-900 hover:bg-[#f2d94c]'
                        : 'border-ink-300 bg-white text-ink-600 hover:border-ink-900'
                  }`}
                >
                  {card?.word || key}
                  {pushed && ' ↻'}
                </button>
              );
            })}
          </div>
          {pushedBack.size > 0 && (
            <p className="mt-3 text-xs text-ink-500">
              {pushedBack.size} {plural(pushedBack.size, 'слово', 'слова', 'слов')} вернулись
              в изучение — появятся в ближайшем повторении.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-ink-900 px-4 py-3">
          <button
            onClick={onClose}
            className="inline-flex w-full items-center justify-center gap-2 border-2 border-ink-900 bg-ink-900 py-2.5 font-bold text-white transition hover:bg-ink-700"
          >
            <CheckIcon className="h-4 w-4" />
            готово
          </button>
        </div>
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
