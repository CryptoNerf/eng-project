import { useState, type CSSProperties } from 'react';
import type { Card } from '../lib/types';
import { formatTime, youtubeUrlAt } from '../lib/words';
import { paperFor, tiltFor, DIFF_LABEL } from '../lib/palette';
import { speak } from '../lib/tts';
import { CheckIcon, ClockIcon, SoundIcon } from './Icons';

interface Props {
  card: Card;
  videoId: string;
  mastered?: boolean; // выучено или отмечено «уже знаю»
  onReveal?: (card: Card) => void;
  onKnown?: (card: Card) => void;
}

/** Wrap occurrences of the word (and its inflections) in a sentence. */
function Highlighted({ sentence, word }: { sentence: string; word: string }) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const splitter = new RegExp(`(\\b${esc}\\w*)`, 'gi');
  const matcher = new RegExp(`^${esc}\\w*$`, 'i');
  const parts = sentence.split(splitter);
  return (
    <>
      {parts.map((p, i) =>
        matcher.test(p) ? (
          <mark key={i} className="bg-[#f7dd4b] px-0.5 font-bold text-ink-900">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function WordCard({ card, videoId, mastered, onReveal, onKnown }: Props) {
  const [flipped, setFlipped] = useState(false);
  const paper = paperFor(card.word, card.difficulty);

  const toggle = () => {
    setFlipped((f) => {
      if (!f) onReveal?.(card);
      return !f;
    });
  };

  return (
    <div
      className="flip-card paper-tilt h-60 animate-fade-up"
      style={{ '--tilt': tiltFor(card.word) } as CSSProperties}
    >
      <div className={`flip-inner relative h-full w-full ${flipped ? 'is-flipped' : ''}`}>
        {/* FRONT: colored paper card */}
        <button
          onClick={toggle}
          style={{ backgroundColor: paper.bg, color: paper.ink, borderColor: paper.border }}
          className="flip-face absolute inset-0 flex flex-col border p-3 text-left"
        >
          <div className="flex items-start justify-between gap-2">
            <span
              style={{ backgroundColor: paper.chipBg, color: paper.chipInk }}
              className="px-1.5 py-0.5 text-[11px] font-bold"
            >
              {DIFF_LABEL[card.difficulty]}:
            </span>
            <span className="flex items-center gap-1.5">
              {mastered && (
                <span
                  style={{ backgroundColor: paper.chipBg, color: paper.chipInk }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] font-bold"
                  title="вы знаете это слово"
                >
                  <CheckIcon className="h-3 w-3" />
                </span>
              )}
              {card.count > 1 && (
                <span style={{ color: paper.sub }} className="text-[11px] font-bold">
                  ×{card.count}
                </span>
              )}
            </span>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="break-all text-2xl font-bold lowercase tracking-tight">
              {card.word}
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                speak(card.word);
              }}
              style={{ borderColor: paper.sub, color: paper.sub }}
              className="mt-3 inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition hover:opacity-80"
            >
              <SoundIcon className="h-3.5 w-3.5" />
              произнести
            </span>
          </div>

          <span style={{ color: paper.sub }} className="text-center text-[10px]">
            перевернуть →
          </span>
        </button>

        {/* BACK: white paper with dashed border */}
        <button
          onClick={toggle}
          className="flip-face flip-back absolute inset-0 flex flex-col border border-dashed border-ink-900 bg-white p-3 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="break-all text-base font-bold lowercase text-ink-900">
              {card.word}
            </span>
            <span className="shrink-0 text-base font-bold text-ink-900">
              {card.translation ? `= ${card.translation}` : '…'}
            </span>
          </div>
          {onKnown && !mastered && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onKnown(card);
              }}
              className="mt-1.5 inline-flex w-fit items-center gap-1 border border-ink-900 px-2 py-0.5 text-[11px] font-bold text-ink-900 transition hover:bg-[#cfe36e]"
            >
              <CheckIcon className="h-3 w-3" />
              уже знаю
            </span>
          )}
          <div className="mt-2 flex-1 space-y-2 overflow-y-auto pr-1">
            {card.examples.slice(0, 3).map((ex, i) => (
              <div key={i} className="border-t border-dotted border-ink-300 pt-1.5 text-[13px] leading-snug text-ink-800">
                <p>
                  <Highlighted sentence={ex.en} word={card.word} />
                </p>
                {ex.ru && <p className="mt-0.5 text-xs text-ink-400">{ex.ru}</p>}
                <div className="mt-1 flex items-center gap-3">
                  <a
                    href={youtubeUrlAt(videoId, ex.time)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-400 underline decoration-dotted transition hover:text-ink-900"
                  >
                    <ClockIcon className="h-3.5 w-3.5" />
                    {formatTime(ex.time)}
                  </a>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      speak(ex.en);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-400 transition hover:text-ink-900"
                  >
                    <SoundIcon className="h-3.5 w-3.5" />
                    озвучить
                  </span>
                </div>
              </div>
            ))}
          </div>
        </button>
      </div>
    </div>
  );
}
