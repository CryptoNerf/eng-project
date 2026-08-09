import type { Readiness } from '../lib/coverage';

interface Props {
  readiness: Readiness;
  /** 'full' — deck header, 'compact' — collections grid and chapters. */
  size?: 'full' | 'compact';
}

/**
 * «Готовность к видео» — the share of spoken words the user knows.
 *
 * Only ever rendered once the vocabulary level has been MEASURED. A fixed
 * assumption is worthless here: the 1000 most common English words alone cover
 * ~72% of running speech in any video, so every deck would open at «≈75%»
 * whatever the learner's actual level.
 *
 * Green is what they already know; yellow is exactly the plan that reaches the
 * target, so the bar shows both where they stand and how far the next study
 * session takes them. Same two colours as the word cards.
 */
export function ReadinessBar({ readiness, size = 'full' }: Props) {
  const { pct, gainPct, targetPct, ready, plan, knownUnits, total } = readiness;
  const compact = size === 'compact';

  return (
    <div className={compact ? '' : 'w-full max-w-sm'}>
      {!compact && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
            готовность к видео
          </span>
          <span className="text-sm font-bold text-ink-900">{pct}%</span>
        </div>
      )}

      <div
        className={`flex w-full border border-ink-900 bg-white ${compact ? 'h-1.5' : 'h-2.5'}`}
      >
        <div className="bg-[#cfe36e]" style={{ width: `${pct}%` }} />
        {!ready && <div className="bg-[#f7dd4b]" style={{ width: `${gainPct}%` }} />}
      </div>

      <p className={`mt-1 ${compact ? 'text-[11px] text-ink-600' : 'text-xs text-ink-700'}`}>
        {compact && <span className="font-bold">понятно {pct}%</span>}
        {ready ? (
          <span className={compact ? ' text-ink-500' : 'font-bold'}>
            {compact ? ' · можно смотреть' : `знаете ${targetPct}%+ слов этого видео — можно смотреть`}
          </span>
        ) : (
          <span>
            {compact ? ' · ' : ''}
            до {targetPct}% — {plan.length} {plural(plan.length, 'слово', 'слова', 'слов')}
          </span>
        )}
      </p>

      {!compact && (
        // the percentage in plain arithmetic, so it is never a black box
        <p className="mt-0.5 text-[11px] text-ink-400">
          знакомо {knownUnits.toLocaleString('ru')} из {total.toLocaleString('ru')} слов,
          звучащих в видео
        </p>
      )}
    </div>
  );
}

/**
 * Stand-in for the bar while the user's level is unknown. Shows no number at
 * all — an invented one would look like data.
 */
export function ReadinessUnknown({
  onCalibrate,
  cards,
}: {
  onCalibrate: () => void;
  cards: number;
}) {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
          готовность к видео
        </span>
        <span className="text-sm font-bold text-ink-300">—</span>
      </div>
      <div className="h-2.5 w-full border border-dashed border-ink-300 bg-white" />
      <p className="mt-1 text-xs text-ink-500">
        в видео {cards.toLocaleString('ru')} разных слов — сколько из них знаете вы,
        приложение пока не знает
      </p>
      <button
        onClick={onCalibrate}
        className="mt-2 border-2 border-ink-900 bg-[#f7dd4b] px-3 py-1 text-sm font-bold text-ink-900 transition hover:opacity-90"
      >
        проверить словарь · 1 минута
      </button>
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
