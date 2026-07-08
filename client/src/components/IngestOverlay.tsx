interface Props {
  elapsed: number; // seconds since ingest started
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} с`;
}

/**
 * Blocking overlay shown during the opaque "fetch subtitles" phase. We can't
 * stream real progress from the Cloud Function, so we reassure with an elapsed
 * timer and staged messages — and a note that a first-time video is slower.
 */
export function IngestOverlay({ elapsed }: Props) {
  const stage =
    elapsed < 8
      ? 'Извлекаем субтитры с YouTube…'
      : elapsed < 22
        ? 'Разбираем текст и собираем карточки…'
        : 'Новое видео — первая загрузка может занять до минуты…';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 px-6">
      <div className="w-full max-w-sm border-2 border-ink-900 bg-white p-6 text-center animate-fade-up">
        <div className="mx-auto mb-4 h-8 w-8 rounded-full border-2 border-ink-200 border-t-ink-900 animate-spin-slow" />
        <p className="text-base font-bold text-ink-900">Собираем карточки</p>
        <p className="mt-2 min-h-[2.5rem] text-sm text-ink-500">{stage}</p>
        <p className="mt-3 inline-block border border-ink-900 bg-[#f7dd4b] px-3 py-1 text-sm font-bold text-ink-900">
          {fmt(elapsed)}
        </p>
        {elapsed >= 45 && (
          <p className="mt-3 text-xs text-ink-400">
            Дольше обычного — ещё немного, или закройте и попробуйте позже.
          </p>
        )}
      </div>
    </div>
  );
}
