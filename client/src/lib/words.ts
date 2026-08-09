import { COMMON_WORDS } from './common-words';
import { STOPWORDS } from './stopwords';
import { IRREGULAR, NO_LEMMA } from './irregular-forms';
import { PHRASE_INDEX } from './phrases';
import type { Card, Difficulty, Example, Transcript } from './types';

const RANK = new Map<string, number>(COMMON_WORDS.map((w, i) => [w, i]));

export const EASY_MAX = 1000; // rank < this  -> easy
const MEDIUM_MAX = 3000; // rank < this -> medium, otherwise hard/rare

// Sentinel rank for words outside the frequency list. A finite number
// (not Infinity) so cards serialize cleanly to JSON/Firestore.
export const UNRANKED = 100000;

// Bump when the card-building pipeline changes meaningfully — decks built
// with an older version are rebuilt from the cached transcript on open.
export const CARDS_VERSION = 5;

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
 * base is a known word (validation keeps rare words untouched).
 *
 * `local` is the set of words the video itself uses. It rescues terminology
 * the frequency list has never heard of: "neurons" only collapses into
 * "neuron" because the video says "neuron" elsewhere. Callers that must
 * produce the SAME keys as the deck (watch mode) have to pass the same set.
 */
export function lemmaOf(word: string, local?: ReadonlySet<string>): string {
  const w = word.replace(/'/g, '');
  const irr = IRREGULAR[w];
  if (irr) return irr;
  if (NO_LEMMA.has(w)) return word;
  for (const cand of suffixCandidates(w)) {
    if (STOPWORDS.has(cand)) continue;
    if (RANK.has(cand) || local?.has(cand)) return cand;
  }
  return word;
}

/** Every real word the video says — evidence for the lemma guesses above. */
export function transcriptVocab(segments: Transcript['segments']): Set<string> {
  const out = new Set<string>();
  for (const s of segments) {
    for (const raw of s.text.split(/\s+/)) {
      const w = normalizeWord(raw);
      if (w) out.add(w);
    }
  }
  return out;
}

/** Frequency rank of a word (after lemmatization). */
function rankForWord(lemma: string): number {
  return RANK.get(lemma.replace(/'/g, '')) ?? UNRANKED;
}

/**
 * Frequency rank of a card id. Rank is a pure function of the id, so coverage
 * data never has to store it — the client recomputes it on read.
 */
export function rankOf(id: string): number {
  return id.includes(' ') ? rankForPhrase(id) : rankForWord(id);
}

/** The n-th most common English word, for the vocabulary test. */
export function wordAtRank(rank: number): string | undefined {
  return COMMON_WORDS[rank];
}

export const VOCAB_SIZE = COMMON_WORDS.length;

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
function matchPhraseAt(
  tokens: string[],
  i: number,
  local?: ReadonlySet<string>,
): string[] | null {
  const first = tokens[i];
  if (!first) return null;
  const lemma = lemmaOf(first, local);
  const keys = first === lemma ? [first] : [first, lemma];
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
  const cues: { pos: number; len: number; start: number; end: number }[] = [];
  t.segments.forEach((s, i) => {
    if (i > 0) text += ' ';
    cues.push({ pos: text.length, len: s.text.length, start: s.start, end: s.end });
    text += s.text;
  });

  // Auto-generated captions roll: a cue's stated end routinely runs ~2 s into
  // the next one (measured: every cue of a 1700-cue ASR track). Left alone,
  // every line stays lit long after it was spoken.
  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].end = Math.max(cues[i].start, Math.min(cues[i].end, cues[i + 1].start));
  }

  /**
   * Time of a character position, interpolated ACROSS its cue.
   *
   * A sentence normally begins in the middle of a cue, so inheriting the cue's
   * own start lit lines ~3 s early on average (p90 4.6 s). Splitting the cue's
   * duration by how far into its text the character sits removes that.
   */
  const timeAt = (pos: number): number => {
    let lo = 0;
    let hi = cues.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].pos <= pos) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const c = cues[idx];
    if (!c) return 0;
    const frac = Math.min(1, Math.max(0, (pos - c.pos) / Math.max(1, c.len)));
    return c.start + frac * (c.end - c.start);
  };

  const units: Unit[] = [];
  const re = /[^.!?…]+[.!?…]+|\S[^.!?…]*$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0].trim().replace(/\s+/g, ' ');
    if (!raw) continue;
    // skip the leading whitespace the regex may have swallowed
    const from = m.index + (m[0].length - m[0].trimStart().length);
    units.push({ text: raw, time: timeAt(from), end: timeAt(m.index + m[0].length) });
  }

  // Fallback for lyrics / unpunctuated transcripts: use caption lines, still
  // with the overlap trimmed off.
  if (units.length < Math.max(2, t.segments.length / 4)) {
    return t.segments
      .map((s, i) => ({ text: s.text.trim(), time: s.start, end: cues[i].end }))
      .filter((u) => u.text);
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
  const local = transcriptVocab(t.segments);
  const map = new Map<string, Acc>();

  for (const unit of units) {
    const raw = unit.text.split(/\s+/);
    const tokens = raw.map(normalizeToken);
    const keysInUnit = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i]) continue;

      // Multi-word units win over their parts: "kind of" is not "kind".
      const phrase = matchPhraseAt(tokens, i, local);
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
      const lemma = lemmaOf(w, local);
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

/**
 * How many word units the video speaks — the denominator behind «готовность».
 * Counted over the same sentence units and with the same phrase-swallowing as
 * card building, so a card's `count` is directly comparable to this total.
 */
export function countUnits(t: Transcript): number {
  return countUnitsOfLines(buildUnits(t), transcriptVocab(t.segments)).total;
}

/**
 * Tally word units across already-cut lines: how many are spoken in total, and
 * how often each of `keys` occurs. Chapters use this to score a slice of the
 * video against the deck the whole video produced.
 */
export function countUnitsOfLines(
  lines: { text: string }[],
  local: ReadonlySet<string>,
  keys?: ReadonlySet<string>,
): { total: number; counts: Map<string, number> } {
  let total = 0;
  const counts = new Map<string, number>();
  for (const line of lines) {
    for (const tok of annotateLine(line.text, local)) {
      if (!tok.key) continue;
      total++;
      if (keys && !keys.has(tok.key)) continue;
      counts.set(tok.key, (counts.get(tok.key) || 0) + 1);
    }
  }
  return { total, counts };
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
 * Split a subtitle line into segments, each tagged with a lookup key.
 *
 * Unlike card building, this tags EVERY real word — including function words
 * like "might" or "which" that never become cards. In watch mode the goal is
 * understanding the line, so any word must be tappable; the caller decides
 * which of them to highlight.
 */
export function annotateLine(
  line: string,
  local?: ReadonlySet<string>,
): { text: string; key: string | null }[] {
  const raw = line.split(/(\s+)/); // keep whitespace so the line renders intact
  const words = raw.filter((_, i) => i % 2 === 0);
  const gaps = raw.filter((_, i) => i % 2 === 1);
  const tokens = words.map(normalizeToken);

  const out: { text: string; key: string | null }[] = [];
  for (let i = 0; i < words.length; i++) {
    const phrase = matchPhraseAt(tokens, i, local);
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
    const t = tokens[i];
    const key = t.length >= 2 && /[a-z]/.test(t) ? lemmaOf(t, local) : null;
    out.push({ text: words[i], key });
    if (gaps[i]) out.push({ text: gaps[i], key: null });
  }
  return out;
}

export interface Line {
  text: string;
  start: number;
  end: number;
}

// Subtitle cues are cut by display timing, not by meaning. Rejoin them into
// sentences — but cap the length so one long unpunctuated stretch doesn't
// become a wall of text.
const MAX_LINE_CHARS = 220;

/**
 * Group raw subtitle cues into readable lines: full sentences where the
 * transcript is punctuated, merged cues where it isn't.
 */
export function buildLines(segments: Transcript['segments']): Line[] {
  const units = buildUnits({ segments } as Transcript);
  const out: Line[] = [];
  for (const u of units) {
    if (u.text.length <= MAX_LINE_CHARS) {
      out.push({ text: u.text, start: u.time, end: u.end });
      continue;
    }
    // split an over-long unit on commas/conjunctions, sharing its time span
    const chunks = splitLong(u.text);
    const span = (u.end - u.time) / Math.max(1, u.text.length);
    let offset = 0;
    for (const chunk of chunks) {
      const start = u.time + offset * span;
      offset += chunk.length;
      out.push({ text: chunk, start, end: u.time + offset * span });
    }
  }
  return out;
}

/** Break a long stretch at commas, falling back to word boundaries. */
function splitLong(text: string): string[] {
  const parts: string[] = [];
  let buf = '';
  for (const piece of text.split(/(?<=,)\s+/)) {
    if (buf && (buf + ' ' + piece).length > MAX_LINE_CHARS) {
      parts.push(buf);
      buf = piece;
    } else {
      buf = buf ? `${buf} ${piece}` : piece;
    }
  }
  if (buf) parts.push(buf);

  // still too long (no commas): hard-wrap on words
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= MAX_LINE_CHARS) {
      out.push(p);
      continue;
    }
    let line = '';
    for (const w of p.split(/\s+/)) {
      if (line && (line + ' ' + w).length > MAX_LINE_CHARS) {
        out.push(line);
        line = w;
      } else {
        line = line ? `${line} ${w}` : w;
      }
    }
    if (line) out.push(line);
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
