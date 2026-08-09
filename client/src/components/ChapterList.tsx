import type { ChapterInfo } from '../lib/chapters';
import { readinessOf } from '../lib/coverage';
import { isMastered, type WordsMap } from '../lib/vocab';
import { formatTime } from '../lib/words';
import { PlayIcon } from './Icons';
import { ReadinessBar } from './ReadinessBar';

interface Props {
  chapters: ChapterInfo[] | null; // null while the transcript loads
  words: WordsMap;
  knownRank: number | null; // null while the level is unknown
  onStudy: (ids: string[]) => void;
  onCalibrate: () => void;
  onWatch: (start: number) => void;
}

/**
 * The video broken into parts, each with its own readiness.
 *
 * The point is the size of the goal: a whole hour needs ~107 words, one of its
 * chapters needs ~11. That is a single sitting, and the payoff — watching those
 * minutes and understanding them — comes the same evening.
 */
export function ChapterList({
  chapters,
  words,
  knownRank,
  onStudy,
  onWatch,
  onCalibrate,
}: Props) {
  if (chapters === null) {
    return (
      <div className="mx-auto mb-6 max-w-6xl">
        <div className="flex items-center gap-2 border border-dashed border-ink-300 bg-white px-4 py-6 text-sm text-ink-400">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-ink-200 border-t-ink-500 animate-spin-slow" />
          считаем главы…
        </div>
      </div>
    );
  }
  if (chapters.length === 0) {
    return (
      <div className="mx-auto mb-6 max-w-6xl border border-dashed border-ink-300 bg-white px-4 py-4 text-sm text-ink-400">
        Это видео не удалось разбить на части — учите его целиком.
      </div>
    );
  }

  const readinessFor = (c: ChapterInfo) =>
    knownRank === null ? null : readinessOf(c.coverage, words, knownRank);
  const done = chapters.filter((c) => readinessFor(c)?.ready).length;

  return (
    <div className="mx-auto mb-6 max-w-6xl border border-ink-900 bg-white p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">
          по главам
        </h3>
        {knownRank === null ? (
          <button
            onClick={onCalibrate}
            className="border-b border-dashed border-ink-400 text-xs text-ink-500 transition hover:text-ink-900"
          >
            проверьте словарь — тогда у каждой главы появится своя готовность
          </button>
        ) : (
          <p className="text-xs text-ink-500">
            готово {done} из {chapters.length} · учите по одной — и сразу смотрите эту часть
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {chapters.map((info) => {
          const r = readinessFor(info);
          // without a measured level there is no plan — offer the chapter's own
          // words instead, most frequent first
          const todo = r
            ? r.plan
            : info.coverage.ids.filter((id) => !isMastered(words.get(id)));
          const mins = Math.max(1, Math.round((info.chapter.end - info.chapter.start) / 60));
          return (
            <li
              key={info.chapter.start}
              className={`border p-2.5 transition ${
                r?.ready ? 'border-ink-900 bg-[#f4f2ea]' : 'border-ink-300'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 bg-ink-900 px-1.5 py-0.5 text-[11px] font-bold text-white">
                  {formatTime(info.chapter.start)}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink-900">
                  {info.chapter.title}
                </p>
                <span className="shrink-0 text-[11px] text-ink-500">{mins} мин</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-[10rem] flex-1">
                  {r ? (
                    <ReadinessBar readiness={r} size="compact" />
                  ) : (
                    <span className="text-[11px] text-ink-500">
                      {todo.length} {plural(todo.length, 'новое слово', 'новых слова', 'новых слов')}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {r ? (
                    !r.ready && (
                      <button
                        onClick={() => onStudy(r.plan)}
                        className="border border-ink-900 bg-[#f7dd4b] px-2 py-1 text-xs font-bold text-ink-900 transition hover:opacity-90"
                        title={`+${r.gainPct}% понимания этой главы`}
                      >
                        учить {r.plan.length}
                      </button>
                    )
                  ) : (
                    todo.length > 0 && (
                      <button
                        onClick={() => onStudy(todo)}
                        className="border border-ink-900 bg-[#f7dd4b] px-2 py-1 text-xs font-bold text-ink-900 transition hover:opacity-90"
                        title="Слова этой главы, самые частые первыми"
                      >
                        учить
                      </button>
                    )
                  )}
                  <button
                    onClick={() => onWatch(info.chapter.start)}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-ink-900 transition hover:opacity-90 ${
                      r?.ready
                        ? 'border border-ink-900 bg-[#cfe36e]'
                        : 'border border-ink-300 bg-white hover:bg-ink-100'
                    }`}
                    title="Смотреть с начала главы"
                  >
                    <PlayIcon className="h-3 w-3" />
                    смотреть
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
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
