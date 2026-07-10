interface Props {
  elapsed: number; // seconds since the operation started
  mode: 'ingest' | 'open';
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} с`;
}

/**
 * Blocking overlay for long operations. We can't stream real progress from
 * the Cloud Function, so the bar follows a saturating curve tuned to typical
 * durations — honest enough to show movement, capped at 95% until done.
 */
export function IngestOverlay({ elapsed, mode }: Props) {
  const isIngest = mode === 'ingest';
  // typical: ingest ~25-60s (cold + yt-dlp), open ~2-8s (network + render)
  const tau = isIngest ? 22 : 3.5;
  const pct = Math.min(95, Math.round(100 * (1 - Math.exp(-Math.max(elapsed, 0.5) / tau))));

  const title = isIngest ? 'Собираем карточки' : 'Открываем колоду';
  const stage = isIngest
    ? elapsed < 8
      ? 'Извлекаем субтитры с YouTube…'
      : elapsed < 25
        ? 'Разбираем текст и собираем карточки…'
        : 'Новое видео — первая загрузка может занять до минуты…'
    : 'Загружаем слова из вашей библиотеки…';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 px-6">
      <div className="w-full max-w-sm border-2 border-ink-900 bg-white p-6 text-center animate-fade-up">
        <p className="text-base font-bold text-ink-900">{title}</p>
        <p className="mt-2 min-h-[2.5rem] text-sm text-ink-500">{stage}</p>

        <div className="mt-2 h-3 w-full border border-ink-900 bg-white">
          <div
            className="h-full bg-[#f7dd4b] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <span className="border border-ink-900 bg-[#f7dd4b] px-3 py-1 font-bold text-ink-900">
            {fmt(elapsed)}
          </span>
          {isIngest && <span className="text-xs text-ink-400">обычно 20–60 секунд</span>}
        </div>

        {isIngest && elapsed >= 70 && (
          <p className="mt-3 text-xs text-ink-400">
            Дольше обычного — YouTube не торопится. Ещё немного…
          </p>
        )}
      </div>
    </div>
  );
}
