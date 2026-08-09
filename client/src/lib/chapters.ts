// Chapters: the other half of «готовность».
//
// A one-hour lecture needs ~107 new words to reach 90% comprehension — weeks
// of study, so nobody starts. The same hour cut into its author's chapters
// needs 8–15 words per chapter: one sitting, after which you can immediately
// watch those five minutes and understand them. The learn → rewatch loop
// closes the same evening instead of next month.
//
// YouTube's own chapters ride along in the info.json the ingest function
// already downloads, so they cost nothing extra. Videos without them are split
// by time on sentence boundaries.

import type { Card, Chapter, Segment } from './types';
import { buildLines, countUnitsOfLines, EASY_MAX, transcriptVocab } from './words';
import type { Coverage } from './coverage';

/** Shorter videos are one sitting already — chapters would just add noise. */
const MIN_VIDEO_SEC = 8 * 60;
/** Author chapters this short carry almost no vocabulary; fold them forward. */
const MIN_CHAPTER_SEC = 60;
/** Target size when we have to split the video ourselves. */
const AUTO_CHAPTER_SEC = 7 * 60;

/** Worth offering the chapter view at all? Short videos are one sitting. */
export function canSplitIntoChapters(duration: number): boolean {
  return duration >= MIN_VIDEO_SEC;
}

export interface ChapterInfo {
  chapter: Chapter;
  coverage: Coverage;
}

/**
 * Chapters worth showing: the author's where they exist, otherwise an even
 * split. Empty when the video is short enough to take in one go.
 */
export function resolveChapters(
  chapters: Chapter[] | undefined,
  segments: Segment[],
  duration: number,
): Chapter[] {
  const total = duration || segments.at(-1)?.end || 0;
  if (total < MIN_VIDEO_SEC) return [];

  const authored = mergeShort((chapters || []).filter((c) => c.end > c.start), total);
  if (authored.length >= 2) return authored;

  return autoChapters(segments, total);
}

/** Fold sub-minute chapters into their neighbour — they carry no vocabulary. */
function mergeShort(chapters: Chapter[], total: number): Chapter[] {
  const out: Chapter[] = [];
  for (const c of [...chapters].sort((a, b) => a.start - b.start)) {
    const prev = out.at(-1);
    if (prev && c.end - c.start < MIN_CHAPTER_SEC) {
      prev.end = c.end;
      continue;
    }
    out.push({ ...c });
  }
  // a short opening chapter has no previous to join — hand it to the next one
  if (out.length > 1 && out[0].end - out[0].start < MIN_CHAPTER_SEC) {
    out[1].start = out[0].start;
    out.shift();
  }
  const last = out.at(-1);
  if (last && total) last.end = Math.max(last.end, total);
  return out;
}

/** Even split on sentence boundaries — never mid-thought. */
function autoChapters(segments: Segment[], total: number): Chapter[] {
  const lines = buildLines(segments);
  if (lines.length < 2) return [];
  const parts = Math.max(2, Math.round(total / AUTO_CHAPTER_SEC));
  const step = total / parts;

  const out: Chapter[] = [];
  let start = lines[0].start;
  for (const line of lines) {
    if (line.start - start >= step && out.length < parts - 1) {
      out.push({ title: `Часть ${out.length + 1}`, start, end: line.start });
      start = line.start;
    }
  }
  out.push({ title: `Часть ${out.length + 1}`, start, end: total });
  return out.length >= 2 ? out : [];
}

/**
 * Per-chapter coverage, using the deck's own cards so a word learned anywhere
 * counts everywhere. A chapter owns the sentences that START inside it.
 */
export function analyzeChapters(
  segments: Segment[],
  chapters: Chapter[],
  cards: Card[],
): ChapterInfo[] {
  const local = transcriptVocab(segments);
  const learnable = new Set(cards.filter((c) => c.rank >= EASY_MAX).map((c) => c.id));
  const lines = buildLines(segments);

  return chapters.map((chapter) => {
    const mine = lines.filter((l) => l.start >= chapter.start && l.start < chapter.end);
    const { total, counts } = countUnitsOfLines(mine, local, learnable);
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const inChapter = entries.reduce((s, [, n]) => s + n, 0);
    return {
      chapter,
      coverage: {
        total,
        base: total - inChapter,
        ids: entries.map(([id]) => id),
        counts: entries.map(([, n]) => n),
      },
    };
  });
}
