import { useEffect, useRef, useState } from 'react';
import {
  buildItems,
  estimateVocabulary,
  pickTestWords,
  type Answer,
  type Estimate,
  type TestItem,
} from '../lib/level';
import { translateBatch } from '../lib/translate';
import { XIcon } from './Icons';

interface Props {
  /** Words the user already tracks — testing those would measure nothing new. */
  skip: Set<string>;
  onDone: (vocabulary: number) => void;
  onClose: () => void;
}

/**
 * Vocabulary test behind «готовность к видео».
 *
 * Without it the app has to assume a level, and any fixed assumption makes
 * every video report the same percentage — the top 1000 English words alone
 * cover ~72% of running speech anywhere. Picking a translation (rather than
 * self-reporting «знаю») is what keeps the measurement honest.
 */
export function LevelTest({ skip, onDone, onClose }: Props) {
  const [items, setItems] = useState<TestItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [i, setI] = useState(0);
  const answers = useRef<Answer[]>([]);
  const [result, setResult] = useState<Estimate | null>(null);
  // the estimate is a measurement, not a verdict — the user can overrule it
  const [override, setOverride] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { probes, distractors } = pickTestWords(skip);
        const ru = await translateBatch([...probes.map((p) => p.word), ...distractors]);
        if (cancelled) return;
        const built = buildItems(probes, ru.slice(0, probes.length), ru.slice(probes.length));
        if (built.length < 6) setFailed(true);
        else setItems(built);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function answer(option: string | null) {
    if (!items) return;
    answers.current[i] = option === null ? 'skip' : option === items[i].answer ? 'ok' : 'miss';
    if (i + 1 < items.length) {
      setI(i + 1);
      return;
    }
    setResult(estimateVocabulary(items, answers.current));
  }

  const item = items?.[i];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f4f2ea] p-4">
      <div className="relative w-full max-w-lg border-2 border-ink-900 bg-white p-5 sm:p-7">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 border border-ink-300 p-1.5 text-ink-500 transition hover:bg-ink-100"
          title="Закрыть"
        >
          <XIcon className="h-4 w-4" />
        </button>

        {result !== null ? (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
              ваш словарь
            </h2>
            <p className="mt-2 text-4xl font-bold text-ink-900">
              ≈ {(override ?? result.vocabulary).toLocaleString('ru')} слов
            </p>

            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-ink-500">
              как это посчитано
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              Слова брались не подряд, а из девяти групп по частоте — от самых
              употребимых к редким. Граница проходит там, где вы перестали
              узнавать: всё, что чаще неё, считается знакомым.
            </p>
            <ul className="mt-2 max-h-52 overflow-y-auto border border-ink-200">
              {result.bands.map((b) => (
                <li
                  key={b.from}
                  className="flex items-center gap-2 border-b border-ink-100 px-2 py-1 text-[11px] last:border-b-0"
                >
                  <span className="w-24 shrink-0 tabular-nums text-ink-500">
                    {b.from === 0 ? 1 : b.from}–{b.to}
                  </span>
                  <span className="w-12 shrink-0 tabular-nums text-ink-400">
                    {b.ok}/{b.asked}
                  </span>
                  <span className="h-1.5 flex-1 border border-ink-300 bg-white">
                    <span
                      className="block h-full bg-[#cfe36e]"
                      style={{ width: `${Math.round(b.share * 100)}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-500">
                    {Math.round(b.share * 100)}%
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-ink-500">не согласны? поставьте своё:</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  onClick={() => setOverride(l.value)}
                  className={`border px-2 py-1 text-xs transition ${
                    override === l.value
                      ? 'border-ink-900 bg-[#f7dd4b] font-bold text-ink-900'
                      : 'border-ink-300 text-ink-600 hover:bg-ink-100'
                  }`}
                >
                  {l.label}
                </button>
              ))}
              {override !== null && (
                <button
                  onClick={() => setOverride(null)}
                  className="border border-dashed border-ink-300 px-2 py-1 text-xs text-ink-500 transition hover:bg-ink-100"
                >
                  вернуть результат теста
                </button>
              )}
            </div>

            <p className="mt-4 text-sm leading-relaxed text-ink-600">
              «Готовность к видео» теперь считается по вашему словарю: она
              показывает долю звучащих слов, которые вы знаете. Это не то же
              самое, что понимать речь на слух, но обычно мешает именно словарь.
            </p>
            <button
              onClick={() => onDone(override ?? result.vocabulary)}
              className="mt-4 w-full border-2 border-ink-900 bg-[#cfe36e] px-4 py-2.5 text-sm font-bold text-ink-900 transition hover:opacity-90"
            >
              применить
            </button>
          </div>
        ) : failed ? (
          <div>
            <p className="text-sm text-ink-600">
              Не удалось загрузить слова для теста. Попробуйте позже.
            </p>
            <button
              onClick={onClose}
              className="mt-4 border border-ink-900 px-4 py-2 text-sm font-bold transition hover:bg-ink-100"
            >
              закрыть
            </button>
          </div>
        ) : !item ? (
          <div className="flex items-center gap-2 py-8 text-sm text-ink-400">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-ink-200 border-t-ink-500 animate-spin-slow" />
            готовим тест…
          </div>
        ) : (
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
                проверка словаря
              </h2>
              <span className="text-xs text-ink-500">
                {i + 1} / {items!.length}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full border border-ink-900 bg-white">
              <div
                className="h-full bg-[#f7dd4b]"
                style={{ width: `${(i / items!.length) * 100}%` }}
              />
            </div>

            <p className="mt-7 text-center text-3xl font-bold text-ink-900">{item.word}</p>
            <p className="mt-1 text-center text-xs text-ink-400">
              выберите перевод — если не знаете, так и отвечайте
            </p>

            <div className="mt-5 grid gap-2">
              {item.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => answer(opt)}
                  className="border border-ink-900 bg-white px-3 py-2.5 text-left text-sm text-ink-900 transition hover:bg-[#f7dd4b]"
                >
                  {opt}
                </button>
              ))}
              <button
                onClick={() => answer(null)}
                className="border border-dashed border-ink-300 px-3 py-2 text-sm text-ink-500 transition hover:bg-ink-100"
              >
                не знаю
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Rough CEFR-to-vocabulary anchors, for overruling the measurement by hand. */
const LEVELS = [
  { value: 1000, label: '≈1 000 · A2' },
  { value: 2000, label: '≈2 000 · B1' },
  { value: 3500, label: '≈3 500 · B2' },
  { value: 6000, label: '≈6 000 · C1' },
];
