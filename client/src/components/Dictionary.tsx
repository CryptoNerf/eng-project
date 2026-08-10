import { useMemo, useState } from 'react';
import type { DeckMeta, WordState } from '../lib/types';
import { describeInterval } from '../lib/srs';
import { dueWords, isKnown, isLearnedAuto, type WordsMap } from '../lib/vocab';
import { speak } from '../lib/tts';
import { BookIcon, BrainIcon, SearchIcon, SoundIcon } from './Icons';

export type DictTab = 'due' | 'learning' | 'learned' | 'known';

interface Props {
  words: WordsMap;
  decks: DeckMeta[];
  tab: DictTab;
  onTab: (t: DictTab) => void;
  onMarkKnown: (word: WordState) => void;
  onUnmarkKnown: (word: WordState) => void;
  onOpenVideo: (videoId: string) => void;
  /** Start a review of the words listed under «к повторению». */
  onReview: () => void;
}

const TABS: { key: DictTab; label: string }[] = [
  { key: 'due', label: 'к повторению' },
  { key: 'learning', label: 'изучаю' },
  { key: 'learned', label: 'выучил' },
  { key: 'known', label: 'знаю' },
];

export function Dictionary({
  words,
  decks,
  tab,
  onTab,
  onMarkKnown,
  onUnmarkKnown,
  onOpenVideo,
  onReview,
}: Props) {
  const [search, setSearch] = useState('');

  const titleOf = useMemo(() => {
    const m = new Map(decks.map((d) => [d.videoId, d.title]));
    return (id: string) => m.get(id) || 'видео удалено';
  }, [decks]);

  const groups = useMemo(() => {
    const all = [...words.values()];
    return {
      // exactly what «повторить» will show, in the order it will show them
      due: dueWords(words),
      learning: all
        .filter((w) => !isKnown(w) && !isLearnedAuto(w))
        .sort((a, b) => a.srs.due - b.srs.due),
      learned: all
        .filter(isLearnedAuto)
        .sort((a, b) => b.updatedAt - a.updatedAt),
      known: all.filter(isKnown).sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }, [words]);

  const q = search.trim().toLowerCase();
  const list = groups[tab].filter(
    (w) => !q || w.word.includes(q) || w.translation.toLowerCase().includes(q),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-500">
        <BookIcon className="h-4 w-4" />
        мой словарь
      </h2>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onTab(t.key)}
            className={`border px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? 'border-ink-900 bg-ink-900 text-white'
                : 'border-ink-300 bg-white text-ink-400 hover:border-ink-900 hover:text-ink-900'
            }`}
          >
            {t.label} <span className="text-xs opacity-60">{groups[t.key].length}</span>
          </button>
        ))}
        <div className="relative min-w-[160px] flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="поиск…"
            className="w-full border border-ink-900 bg-white py-2 pl-8 pr-3 text-sm outline-none placeholder:text-ink-400"
          />
        </div>
      </div>

      {tab === 'due' && groups.due.length > 0 && (
        <button
          onClick={onReview}
          className="mb-4 inline-flex items-center gap-2 border-2 border-ink-900 bg-[#f7dd4b] px-4 py-2 text-sm font-bold text-ink-900 transition hover:opacity-90"
        >
          <BrainIcon className="h-4 w-4" />
          повторить {groups.due.length} {plural(groups.due.length, 'слово', 'слова', 'слов')}
        </button>
      )}

      {list.length === 0 ? (
        <p className="border border-dashed border-ink-300 bg-white px-4 py-10 text-center text-sm text-ink-400">
          {tab === 'due'
            ? 'На сегодня всё повторено. Возвращайтесь завтра.'
            : tab === 'learning'
            ? 'Пока пусто — добавьте видео и начните учить слова.'
            : tab === 'learned'
              ? 'Здесь появятся слова, которые вы стабильно вспоминаете 3 недели и дольше.'
              : 'Отмечайте «уже знаю» на карточках — такие слова собираются здесь.'}
        </p>
      ) : (
        <div className="border border-ink-900 bg-white">
          {list.map((w, i) => (
            <div
              key={w.word}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${
                i > 0 ? 'border-t border-dotted border-ink-300' : ''
              }`}
            >
              <span className="min-w-28 text-sm font-bold lowercase text-ink-900">{w.word}</span>
              <span className="flex-1 text-sm text-ink-600">{w.translation || '—'}</span>
              <span className="text-[11px] text-ink-400">
                {tab === 'learning' || tab === 'due' ? describeInterval(w.srs) : ''}
              </span>
              <span className="flex items-center gap-1">
                {w.sources.slice(0, 2).map((id) => (
                  <button
                    key={id}
                    onClick={() => onOpenVideo(id)}
                    className="max-w-36 truncate border border-ink-300 px-1.5 py-0.5 text-[11px] text-ink-500 transition hover:border-ink-900 hover:text-ink-900"
                    title={titleOf(id)}
                  >
                    {titleOf(id)}
                  </button>
                ))}
              </span>
              <button
                onClick={() => speak(w.word)}
                className="p-1 text-ink-400 transition hover:text-ink-900"
                title="Произнести"
              >
                <SoundIcon className="h-4 w-4" />
              </button>
              {tab === 'known' ? (
                <button
                  onClick={() => onUnmarkKnown(w)}
                  className="border border-ink-900 px-2 py-0.5 text-[11px] font-bold text-ink-900 transition hover:bg-[#f2d94c]"
                >
                  учить снова
                </button>
              ) : (
                <button
                  onClick={() => onMarkKnown(w)}
                  className="border border-ink-900 px-2 py-0.5 text-[11px] font-bold text-ink-900 transition hover:bg-[#cfe36e]"
                >
                  знаю
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
