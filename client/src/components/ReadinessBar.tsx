import type { Readiness } from '../lib/coverage';

interface Props {
  readiness: Readiness;
  /** 'full' — deck header, 'compact' — collections grid. */
  size?: 'full' | 'compact';
  /** Offered where there is room: measure the level instead of assuming it. */
  onCalibrate?: () => void;
}

/**
 * «Готовность к видео» — the share of spoken words the user understands.
 *
 * Green is what they already know; yellow is exactly the plan that reaches the
 * target, so the bar shows both where they stand and how far the next study
 * session takes them. Same two colours as the word cards: green = выучено,
 * жёлтый = в изучении.
 */
export function ReadinessBar({ readiness, size = 'full', onCalibrate }: Props) {
  const { pct, gainPct, targetPct, ready, plan, measured } = readiness;
  const compact = size === 'compact';
  // «≈» while the level is still assumed: the top 1000 English words alone
  // cover ~72% of any video, so an unmeasured number says more about English
  // than about the user
  const approx = measured ? '' : '≈';

  return (
    <div className={compact ? '' : 'w-full max-w-sm'}>
      {!compact && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
            готовность к видео
          </span>
          <span className="text-sm font-bold text-ink-900">
            {approx}
            {pct}%
          </span>
        </div>
      )}

      <div
        title="Доля произнесённых в видео слов, которые вы знаете"
        className={`flex w-full border border-ink-900 bg-white ${compact ? 'h-1.5' : 'h-2.5'}`}
      >
        <div className="bg-[#cfe36e]" style={{ width: `${pct}%` }} />
        {!ready && <div className="bg-[#f7dd4b]" style={{ width: `${gainPct}%` }} />}
      </div>

      <p
        className={`mt-1 ${compact ? 'text-[11px] text-ink-600' : 'text-xs text-ink-700'}`}
      >
        {compact && (
          <span className="font-bold">
            понятно {approx}
            {pct}%
          </span>
        )}
        {ready ? (
          <span className={compact ? ' text-ink-500' : 'font-bold'}>
            {compact ? ' · можно смотреть' : `вы понимаете ${targetPct}%+ реплик — можно смотреть`}
          </span>
        ) : (
          <span>
            {compact ? ' · ' : ''}
            до {targetPct}% — {plan.length} {plural(plan.length, 'слово', 'слова', 'слов')}
          </span>
        )}
      </p>

      {!compact && !measured && onCalibrate && (
        <button
          onClick={onCalibrate}
          className="mt-1.5 border-b border-dashed border-ink-400 text-[11px] text-ink-500 transition hover:text-ink-900"
        >
          процент оценочный — проверить свой словарь за минуту
        </button>
      )}
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
