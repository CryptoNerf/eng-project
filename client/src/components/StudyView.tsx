import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Example, StudyCard } from '../lib/types';
import { CheckIcon as KnownIcon } from './Icons';
import { track } from '../lib/analytics';
import { GRADES, type GradeKey } from '../lib/srs';
import { formatTime } from '../lib/words';
import { speak } from '../lib/tts';
import { CheckIcon, PlayIcon, SoundIcon, XIcon } from './Icons';

interface Props {
  cards: StudyCard[];
  onGrade: (card: StudyCard, grade: number) => void;
  onKnown: (card: StudyCard) => void;
  onPlayClip: (card: StudyCard, ex: Example) => void;
  onClose: () => void;
}

const BUTTONS: { key: GradeKey; label: string; hint: string; cls: string }[] = [
  { key: 'again', label: 'Не знаю', hint: '1', cls: 'bg-[#c2401f] text-white' },
  { key: 'hard', label: 'Трудно', hint: '2', cls: 'bg-[#f2d94c] text-ink-900' },
  { key: 'good', label: 'Знаю', hint: '3', cls: 'bg-[#cfe36e] text-ink-900' },
  { key: 'easy', label: 'Легко', hint: '4', cls: 'bg-ink-900 text-white' },
];

export function StudyView({ cards, onGrade, onKnown, onPlayClip, onClose }: Props) {
  const [queue, setQueue] = useState<StudyCard[]>(cards);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);

  const total = cards.length;
  const current = queue[0];
  const progress = useMemo(
    () => (total === 0 ? 100 : Math.round((done / total) * 100)),
    [done, total],
  );

  const completionTracked = useRef(false);
  useEffect(() => {
    if (!current && total > 0 && !completionTracked.current) {
      completionTracked.current = true;
      track('study_completed', { cards: total });
    }
  }, [current, total]);

  const markKnown = useCallback(() => {
    if (!current) return;
    onKnown(current);
    setRevealed(false);
    setQueue((q) => q.slice(1));
    setDone((d) => d + 1);
  }, [current, onKnown]);

  const grade = useCallback(
    (g: GradeKey) => {
      if (!current) return;
      onGrade(current, GRADES[g]);
      setRevealed(false);
      setQueue((q) => {
        const [, ...rest] = q;
        // "again" re-queues the card later in the session
        return g === 'again' ? [...rest, current] : rest;
      });
      if (g !== 'again') setDone((d) => d + 1);
    },
    [current, onGrade],
  );

  // Keyboard: space/enter to flip, 1-4 to grade
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (!current) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        grade(BUTTONS[Number(e.key) - 1].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, grade, onClose]);

  const ex = current?.examples[0];

  return (
    // transform-gpu: force an own compositing layer so 3D-flipped cards
    // (preserve-3d) can't paint through the overlay
    <div className="fixed inset-0 z-50 isolate flex transform-gpu flex-col bg-ink-900/80">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="h-3 flex-1 overflow-hidden border border-white/60 bg-transparent">
          <div
            className="h-full bg-[#f7dd4b] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-bold text-white">
          {done} / {total}
        </span>
        <button
          onClick={onClose}
          className="border border-white bg-transparent p-2 text-white transition hover:bg-white hover:text-ink-900"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
        {!current ? (
          <div className="animate-fade-up border-2 border-ink-900 bg-white p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border-2 border-ink-900 bg-[#cfe36e] text-ink-900">
              <CheckIcon className="h-8 w-8" />
            </div>
            <h3 className="text-2xl font-bold text-ink-900">Готово! 🎉</h3>
            <p className="mt-2 text-ink-500">
              Вы повторили {total} {total === 1 ? 'слово' : 'слов'}.
            </p>
            <button
              onClick={onClose}
              className="mt-6 border-2 border-ink-900 bg-ink-900 px-6 py-3 font-bold text-white transition hover:bg-ink-700"
            >
              Вернуться к карточкам
            </button>
          </div>
        ) : (
          <div className="flex max-h-full w-full max-w-xl flex-col animate-fade-up">
            <div
              onClick={() => !revealed && setRevealed(true)}
              className={`flex min-h-0 flex-1 flex-col overflow-y-auto border-2 border-ink-900 bg-white p-5 sm:p-8 ${
                !revealed ? 'cursor-pointer' : ''
              }`}
            >
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="flex items-center gap-3">
                  <span className="text-4xl font-bold lowercase tracking-tight text-ink-900">
                    {current.word}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      speak(current.word);
                    }}
                    className="border border-ink-900 p-2 text-ink-900 transition hover:bg-[#f7dd4b]"
                  >
                    <SoundIcon className="h-5 w-5" />
                  </button>
                </div>

                {revealed ? (
                  <div className="mt-4 w-full animate-fade-up">
                    <p className="text-2xl font-bold text-ink-900">
                      {current.translation || '—'}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markKnown();
                      }}
                      className="mx-auto mt-2 inline-flex items-center gap-1 border border-ink-900 px-2 py-0.5 text-[11px] font-bold text-ink-900 transition hover:bg-[#cfe36e]"
                      title="Убрать из изучения во всех видео"
                    >
                      <KnownIcon className="h-3 w-3" />
                      уже знаю
                    </button>
                    {ex && (
                      <div className="mt-5 border border-dashed border-ink-900 bg-white p-4 text-left">
                        <p className="leading-relaxed text-ink-800">{ex.en}</p>
                        {ex.ru && <p className="mt-1 text-sm text-ink-400">{ex.ru}</p>}
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPlayClip(current, ex);
                            }}
                            className="inline-flex items-center gap-1 border border-ink-900 px-2 py-0.5 text-xs font-bold text-ink-900 transition hover:bg-[#f7dd4b]"
                            title="Послушать фразу из видео"
                          >
                            <PlayIcon className="h-3 w-3" />
                            {formatTime(ex.time)}
                          </button>
                          <button
                            onClick={() => speak(ex.en)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-ink-400 hover:text-ink-900"
                          >
                            <SoundIcon className="h-3.5 w-3.5" />
                            озвучить
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-6 text-sm text-ink-400">
                    нажмите или пробел, чтобы показать перевод
                  </p>
                )}
              </div>
            </div>

            {/* Grade buttons — always visible below the (scrollable) card */}
            {revealed && (
              <div className="mt-3 grid shrink-0 grid-cols-4 gap-2 animate-fade-up">
                {BUTTONS.map((b) => (
                  <button
                    key={b.key}
                    onClick={() => grade(b.key)}
                    className={`flex flex-col items-center border-2 border-ink-900 py-2.5 text-sm font-bold transition hover:opacity-90 ${b.cls}`}
                  >
                    {b.label}
                    <span className="mt-0.5 text-[11px] font-normal opacity-70">{b.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
