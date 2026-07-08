// Thin wrapper around the browser Web Speech API for English pronunciation.

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  // Prefer a natural en-US/en-GB voice
  cachedVoice =
    voices.find((v) => /en[-_]US/i.test(v.lang) && /natural|google|samantha/i.test(v.name)) ||
    voices.find((v) => /en[-_]US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null;
  return cachedVoice;
}

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(text: string, opts: { rate?: number } = {}): void {
  if (!isTtsSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = opts.rate ?? 0.95;
  const v = pickVoice();
  if (v) u.voice = v;
  synth.speak(u);
}

// Voices load asynchronously in some browsers — refresh the cache when ready.
if (isTtsSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickVoice();
  };
}
