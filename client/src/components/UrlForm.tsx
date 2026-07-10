import { useState } from 'react';
import { ArrowRightIcon, LinkIcon } from './Icons';

interface Props {
  onSubmit: (url: string) => void;
  loading: boolean;
  /** Backend not ready yet (auth initializing) — button waits without the
   *  confusing «обработка…» label. */
  disabled?: boolean;
  error: string | null;
  compact?: boolean;
  /** Called on first focus/paste — pre-warms the ingest function. */
  onWarmup?: () => void;
}

const SAMPLES = [
  { label: 'TED Talk', url: 'https://www.youtube.com/watch?v=8jPQjjsBbIc' },
  { label: '3Blue1Brown', url: 'https://youtu.be/aircAruvnKk' },
];

export function UrlForm({ onSubmit, loading, disabled, error, compact, onWarmup }: Props) {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v && !loading && !disabled) onSubmit(v);
  };

  return (
    <div className={compact ? '' : 'mx-auto w-full max-w-2xl'}>
      <form onSubmit={submit} className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
            <LinkIcon className="h-5 w-5" />
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={onWarmup}
            onPaste={onWarmup}
            placeholder="Ссылка на YouTube-видео…"
            disabled={loading}
            className="h-full w-full border border-ink-900 bg-white py-3.5 pl-11 pr-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:outline-2 focus:outline-solid focus:-outline-offset-2 focus:outline-ink-900 disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={loading || disabled || !value.trim()}
          className="inline-flex shrink-0 items-center gap-2 border-2 border-ink-900 bg-ink-900 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin-slow" />
              обработка…
            </>
          ) : (
            <>создать карточки</>
          )}
        </button>
      </form>

      {error && (
        <div className="mt-3 border-2 border-[#c2401f] bg-white px-4 py-3 text-sm font-medium text-[#c2401f] animate-fade-up">
          {error}
        </div>
      )}

      {!compact && !error && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-500">
          <span>попробуйте:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.url}
              onClick={() => !loading && !disabled && onSubmit(s.url)}
              className="inline-flex items-center gap-1 border border-ink-900 bg-white px-3 py-1 font-medium text-ink-900 transition hover:bg-ink-100"
            >
              {s.label}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
