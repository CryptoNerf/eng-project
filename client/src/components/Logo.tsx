import { useEffect, useState } from 'react';

interface Props {
  onHome?: () => void;
}

/**
 * The logo is a small paper card: «Эмиль гений» on the front; flip it over
 * and the back reads «Emile is a genius». Flips on hover and lazily by
 * itself every few seconds; clicking it navigates home.
 */
export function Logo({ onHome }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (hover) return;
    const t = setInterval(() => setFlipped((f) => !f), 6000);
    return () => clearInterval(t);
  }, [hover]);

  const isFlipped = hover ? true : flipped;

  return (
    <button
      className="flip-card h-12 w-32 shrink-0 cursor-pointer select-none"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onHome}
      title="На главную"
    >
      <div className={`flip-inner relative h-full w-full ${isFlipped ? 'is-flipped' : ''}`}>
        <div className="flip-face absolute inset-0 flex items-center justify-center border border-ink-900 bg-[#cfe36e] px-2 text-center text-[13px] font-bold leading-tight text-ink-900">
          Эмиль гений
        </div>
        <div className="flip-face flip-back absolute inset-0 flex items-center justify-center border border-dashed border-ink-900 bg-white px-2 text-center text-[11px] font-bold leading-tight text-ink-900">
          Emile is a&nbsp;genius
        </div>
      </div>
    </button>
  );
}
