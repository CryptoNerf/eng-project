import { COMMON_WORDS } from './common-words';
import { STOPWORDS } from './stopwords';
import type { Card, Difficulty, Example, Transcript } from './types';

const RANK = new Map<string, number>(COMMON_WORDS.map((w, i) => [w, i]));

const EASY_MAX = 1000; // rank < this  -> easy
const MEDIUM_MAX = 3000; // rank < this -> medium, otherwise hard/rare

// Sentinel rank for words outside the frequency list. A finite number
// (not Infinity) so cards serialize cleanly to JSON/Firestore.
export const UNRANKED = 100000;

const MAX_EXAMPLES = 5;

export function difficultyForRank(rank: number): Difficulty {
  if (rank < EASY_MAX) return 'easy';
  if (rank < MEDIUM_MAX) return 'medium';
  return 'hard';
}

/** Candidate base forms used only to look up frequency rank (not for display). */
function lemmaCandidates(w: string): string[] {
  const c = [w];
  if (w.endsWith('ies') && w.length > 4) c.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) c.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) c.push(w.slice(0, -1));
  if (w.endsWith('ied') && w.length > 4) c.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed') && w.length > 3) {
    c.push(w.slice(0, -2)); // walked -> walk
    c.push(w.slice(0, -1)); // loved -> love
  }
  if (w.endsWith('ing') && w.length > 4) {
    c.push(w.slice(0, -3)); // going -> go (also running -> runn, harmless)
    c.push(w.slice(0, -3) + 'e'); // making -> make
  }
  if (w.endsWith('ly') && w.length > 3) c.push(w.slice(0, -2)); // quickly -> quick
  return c;
}

/** Best (lowest) frequency rank across a word's likely base forms. */
function rankForWord(word: string): number {
  const plain = word.replace(/'/g, '');
  let best = UNRANKED;
  for (const cand of lemmaCandidates(plain)) {
    const r = RANK.get(cand);
    if (r !== undefined && r < best) best = r;
  }
  return best;
}

/** Normalize a raw token to a comparable word, or null if not a real word. */
export function normalizeWord(raw: string): string | null {
  let w = raw.toLowerCase().replace(/[’`]/g, "'");
  // strip surrounding punctuation but keep inner apostrophes/hyphens
  w = w.replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
  // drop possessive
  w = w.replace(/'s$/, '');
  if (w.length < 2) return null;
  if (!/[a-z]/.test(w)) return null;
  return w;
}

interface Unit {
  text: string;
  time: number;
}

/** Break the transcript into context units (sentences) carrying a timestamp. */
function buildUnits(t: Transcript): Unit[] {
  let text = '';
  const offsets: { pos: number; time: number }[] = [];
  t.segments.forEach((s, i) => {
    if (i > 0) text += ' ';
    offsets.push({ pos: text.length, time: s.start });
    text += s.text;
  });

  const timeForPos = (pos: number): number => {
    let time = 0;
    for (const o of offsets) {
      if (o.pos <= pos) time = o.time;
      else break;
    }
    return time;
  };

  const units: Unit[] = [];
  const re = /[^.!?…]+[.!?…]+|\S[^.!?…]*$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0].trim().replace(/\s+/g, ' ');
    if (raw) units.push({ text: raw, time: timeForPos(m.index) });
  }

  // Fallback for lyrics / unpunctuated transcripts: use caption lines.
  if (units.length < Math.max(2, t.segments.length / 4)) {
    return t.segments
      .filter((s) => s.text.trim())
      .map((s) => ({ text: s.text.trim(), time: s.start }));
  }
  return units;
}

interface Acc {
  word: string;
  count: number;
  examples: Example[];
  seen: Set<string>;
}

/** Build vocabulary cards (no translations yet) from a transcript. */
export function buildCards(t: Transcript): Card[] {
  const units = buildUnits(t);
  const map = new Map<string, Acc>();

  for (const unit of units) {
    const tokens = unit.text.split(/\s+/);
    const wordsInUnit = new Set<string>();
    for (const tok of tokens) {
      const w = normalizeWord(tok);
      if (!w) continue;
      if (STOPWORDS.has(w.replace(/'/g, ''))) continue;
      wordsInUnit.add(w);
      let acc = map.get(w);
      if (!acc) {
        acc = { word: w, count: 0, examples: [], seen: new Set() };
        map.set(w, acc);
      }
      acc.count += 1;
    }
    // attach this unit as an example to each unique word it contains
    for (const w of wordsInUnit) {
      const acc = map.get(w)!;
      if (acc.examples.length < MAX_EXAMPLES && !acc.seen.has(unit.text)) {
        acc.seen.add(unit.text);
        acc.examples.push({ en: unit.text, time: unit.time });
      }
    }
  }

  const cards: Card[] = [];
  for (const acc of map.values()) {
    if (acc.examples.length === 0) continue;
    const rank = rankForWord(acc.word);
    cards.push({
      id: acc.word,
      word: acc.word,
      translation: '',
      examples: acc.examples,
      count: acc.count,
      rank,
      difficulty: difficultyForRank(rank),
    });
  }

  // Default order: most frequent first (recurring words are worth learning).
  cards.sort((a, b) => b.count - a.count || a.rank - b.rank);
  return cards;
}

export function formatTime(sec: number): string {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function youtubeUrlAt(videoId: string, sec: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(sec))}s`;
}
