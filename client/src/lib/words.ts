import { COMMON_WORDS } from './common-words';
import { STOPWORDS } from './stopwords';
import { IRREGULAR, NO_LEMMA } from './irregular-forms';
import { PHRASE_INDEX } from './phrases';
import type { Card, Difficulty, Example, Transcript } from './types';

const RANK = new Map<string, number>(COMMON_WORDS.map((w, i) => [w, i]));

const EASY_MAX = 1000; // rank < this  -> easy
const MEDIUM_MAX = 3000; // rank < this -> medium, otherwise hard/rare

// Sentinel rank for words outside the frequency list. A finite number
// (not Infinity) so cards serialize cleanly to JSON/Firestore.
export const UNRANKED = 100000;

// Bump when the card-building pipeline changes meaningfully — decks built
// with an older version are rebuilt from the cached transcript on open.
export const CARDS_VERSION = 3;

const MAX_EXAMPLES = 5;

export function difficultyForRank(rank: number): Difficulty {
  if (rank < EASY_MAX) return 'easy';
  if (rank < MEDIUM_MAX) return 'medium';
  return 'hard';
}

/* ------------------------------ lemmatization ------------------------------ */

/**
 * Suffix-stripping candidates for a word, most specific first. Only used
 * when validated against the frequency list, so bad guesses are discarded.
 */
function suffixCandidates(w: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s.length >= 3) out.push(s);
  };

  // plurals / 3rd person: movies -> movie, boxes -> box, cats -> cat
  if (w.endsWith('ies') && w.length > 4) push(w.slice(0, -3) + 'y');
  if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1));
  if (w.endsWith('es')) push(w.slice(0, -2));

  // past: studied -> study, walked -> walk, loved -> love, stopped -> stop
  if (w.endsWith('ied') && w.length > 4) push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed') && !w.endsWith('eed')) {
    const base = w.slice(0, -2);
    push(base);
    push(w.slice(0, -1)); // loved -> love
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) push(base.slice(0, -1)); // stopped -> stop
  }

  // gerund: making -> make, going -> go, running -> run
  if (w.endsWith('ing') && w.length >= 6) {
    const base = w.slice(0, -3);
    push(base);
    push(base + 'e');
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) push(base.slice(0, -1)); // running -> run
  }

  return out;
}

/**
 * Canonical form for grouping: ran/running/runs → run. Irregular forms come
 * from a lookup table; regular suffixes are stripped only when the resulting
 * base is a known common word (validation keeps rare words untouched).
 */
export function lemmaOf(word: string): string {
  const w = word.replace(/'/g, '');
  const irr = IRREGULAR[w];
  if (irr) return irr;
  if (NO_LEMMA.has(w)) return word;
  for (const cand of suffixCandidates(w)) {
    if (RANK.has(cand) && !STOPWORDS.has(cand)) return cand;
  }
  return word;
}

/** Frequency rank of a word (after lemmatization). */
function rankForWord(lemma: string): number {
  return RANK.get(lemma.replace(/'/g, '')) ?? UNRANKED;
}

/** Lowercase and strip punctuation, keeping short function words intact. */
function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^[^a-z]+/, '')
    .replace(/[^a-z]+$/, '')
    .replace(/'s$/, '');
}

/** Normalize a raw token to a comparable word, or null if junk. */
export function normalizeWord(raw: string): string | null {
  const w = normalizeToken(raw);
  // junk filters: too short, or no vowel (subtitle fragments like "te", "th")
  if (w.length < 3) return null;
  if (!/[aeiouy]/.test(w)) return null;
  if (!/[a-z]/.test(w)) return null;
  return w;
}

/**
 * Longest multi-word unit starting at position i, or null. The first word is
 * matched by lemma ("figured out" → "figure out"); the rest must match
 * literally, since they're function words that never inflect.
 */
function matchPhraseAt(tokens: string[], i: number): string[] | null {
  const first = tokens[i];
  if (!first) return null;
  const keys = first === lemmaOf(first) ? [first] : [first, lemmaOf(first)];
  for (const key of keys) {
    const candidates = PHRASE_INDEX.get(key);
    if (!candidates) continue;
    for (const parts of candidates) {
      if (i + parts.length > tokens.length) continue;
      let ok = true;
      for (let k = 1; k < parts.length; k++) {
        if (tokens[i + k] !== parts[k]) {
          ok = false;
          break;
        }
      }
      if (ok) return parts;
    }
  }
  return null;
}

/* ------------------------------ transcript units ------------------------------ */

interface Unit {
  text: string;
  time: number;
  end: number;
}

/** Break the transcript into context units (sentences) with start/end times. */
function buildUnits(t: Transcript): Unit[] {
  let text = '';
  const offsets: { pos: number; start: number; end: number }[] = [];
  t.segments.forEach((s, i) => {
    if (i > 0) text += ' ';
    offsets.push({ pos: text.length, start: s.start, end: s.end });
    text += s.text;
  });

  const segAtPos = (pos: number) => {
    let seg = offsets[0];
    for (const o of offsets) {
      if (o.pos <= pos) seg = o;
      else break;
    }
    return seg;
  };

  const units: Unit[] = [];
  const re = /[^.!?…]+[.!?…]+|\S[^.!?…]*$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0].trim().replace(/\s+/g, ' ');
    if (!raw) continue;
    const startSeg = segAtPos(m.index);
    const endSeg = segAtPos(m.index + m[0].length - 1);
    units.push({ text: raw, time: startSeg?.start ?? 0, end: endSeg?.end ?? 0 });
  }

  // Fallback for lyrics / unpunctuated transcripts: use caption lines.
  if (units.length < Math.max(2, t.segments.length / 4)) {
    return t.segments
      .filter((s) => s.text.trim())
      .map((s) => ({ text: s.text.trim(), time: s.start, end: s.end }));
  }
  return units;
}

/* ------------------------------ card building ------------------------------ */

interface Acc {
  lemma: string;
  forms: Set<string>;
  isPhrase: boolean;
  count: number;
  examples: Example[];
  seen: Set<string>;
}

/** Build vocabulary cards (no translations yet) from a transcript. */
export function buildCards(t: Transcript): Card[] {
  const units = buildUnits(t);
  const map = new Map<string, Acc>();

  for (const unit of units) {
    const raw = unit.text.split(/\s+/);
    const tokens = raw.map(normalizeToken);
    const keysInUnit = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i]) continue;

      // Multi-word units win over their parts: "kind of" is not "kind".
      const phrase = matchPhraseAt(tokens, i);
      if (phrase) {
        const key = phrase.join(' ');
        const surface = tokens.slice(i, i + phrase.length).join(' ');
        keysInUnit.add(key);
        let acc = map.get(key);
        if (!acc) {
          acc = {
            lemma: key,
            forms: new Set(),
            isPhrase: true,
            count: 0,
            examples: [],
            seen: new Set(),
          };
          map.set(key, acc);
        }
        acc.forms.add(surface);
        acc.count += 1;
        i += phrase.length - 1; // consume the phrase's tokens
        continue;
      }

      const w = normalizeWord(raw[i]);
      if (!w) continue;
      if (STOPWORDS.has(w.replace(/'/g, ''))) continue;
      const lemma = lemmaOf(w);
      if (STOPWORDS.has(lemma.replace(/'/g, ''))) continue;
      keysInUnit.add(lemma);
      let acc = map.get(lemma);
      if (!acc) {
        acc = {
          lemma,
          forms: new Set(),
          isPhrase: false,
          count: 0,
          examples: [],
          seen: new Set(),
        };
        map.set(lemma, acc);
      }
      acc.forms.add(w);
      acc.count += 1;
    }

    // attach this unit as an example to each unique entry it contains
    for (const key of keysInUnit) {
      const acc = map.get(key)!;
      if (acc.examples.length < MAX_EXAMPLES && !acc.seen.has(unit.text)) {
        acc.seen.add(unit.text);
        acc.examples.push({ en: unit.text, time: unit.time, end: unit.end });
      }
    }
  }

  const cards: Card[] = [];
  for (const acc of map.values()) {
    if (acc.examples.length === 0) continue;
    const rank = acc.isPhrase ? rankForPhrase(acc.lemma) : rankForWord(acc.lemma);
    let difficulty = difficultyForRank(rank);
    // An idiom built from common words is still non-obvious — never "easy".
    if (acc.isPhrase && difficulty === 'easy') difficulty = 'medium';
    cards.push({
      id: acc.lemma,
      word: acc.lemma,
      forms: [...acc.forms].sort(),
      isPhrase: acc.isPhrase || undefined,
      translation: '',
      examples: acc.examples,
      count: acc.count,
      rank,
      difficulty,
    });
  }

  // Default order: most frequent first (recurring words are worth learning).
  cards.sort((a, b) => b.count - a.count || a.rank - b.rank);
  return cards;
}

/** A phrase is as rare as its rarest content word (1-letter words aren't ranked). */
function rankForPhrase(phrase: string): number {
  let worst = 0;
  for (const part of phrase.split(' ')) {
    if (part.length < 2) continue;
    worst = Math.max(worst, rankForWord(part));
  }
  return worst;
}

/**
 * Split a subtitle line into segments, each tagged with the card key it
 * belongs to (phrases included) — powers word highlighting in watch mode.
 */
export function annotateLine(
  line: string,
): { text: string; key: string | null }[] {
  const raw = line.split(/(\s+)/); // keep whitespace so the line renders intact
  const words = raw.filter((_, i) => i % 2 === 0);
  const gaps = raw.filter((_, i) => i % 2 === 1);
  const tokens = words.map(normalizeToken);

  const out: { text: string; key: string | null }[] = [];
  for (let i = 0; i < words.length; i++) {
    const phrase = matchPhraseAt(tokens, i);
    if (phrase) {
      const end = i + phrase.length - 1;
      const text = words
        .slice(i, end + 1)
        .map((w, k) => w + (k < phrase.length - 1 ? gaps[i + k] ?? ' ' : ''))
        .join('');
      out.push({ text, key: phrase.join(' ') });
      if (gaps[end]) out.push({ text: gaps[end], key: null });
      i = end;
      continue;
    }
    const w = normalizeWord(words[i]);
    const lemma = w && !STOPWORDS.has(w.replace(/'/g, '')) ? lemmaOf(w) : null;
    out.push({ text: words[i], key: lemma && !STOPWORDS.has(lemma) ? lemma : null });
    if (gaps[i]) out.push({ text: gaps[i], key: null });
  }
  return out;
}

/* ------------------------------ misc helpers ------------------------------ */

/** End of an example phrase; estimated from length when not stored. */
export function exampleEnd(ex: Example): number {
  if (typeof ex.end === 'number' && ex.end > ex.time) return ex.end;
  const words = ex.en.split(/\s+/).length;
  return ex.time + Math.min(15, Math.max(3, 1.5 + words * 0.42));
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
