import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const YTDLP = process.env.YTDLP_PATH || path.join(__dirname, 'bin', 'yt-dlp');

// Languages we ask yt-dlp for, in preference order. Avoid the "en.*" glob,
// which also pulls auto-translated tracks and triggers HTTP 429.
const SUB_LANGS = 'en,en-US,en-GB,en-orig';
const MANUAL_PRIORITY = ['en', 'en-US', 'en-GB'];

/** Extract the 11-char video id from any common YouTube URL form. */
export function parseVideoId(input) {
  if (!input) return null;
  const raw = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return url.pathname.slice(1, 12) || null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const m = url.pathname.match(/\/(shorts|embed|v|live)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {
    // not a URL — fall through
  }
  const m = raw.match(/[a-zA-Z0-9_-]{11}/);
  return m ? m[0] : null;
}

/**
 * Fetch the English transcript for a YouTube video via yt-dlp.
 * Returns { videoId, title, author, thumbnail, duration, segments, text, language, auto }.
 * Each segment: { start (sec), end (sec), text }.
 */
export async function fetchTranscript(input) {
  const videoId = parseVideoId(input);
  if (!videoId) {
    throw withCode(new Error('Не удалось распознать ссылку на YouTube-видео.'), 'BAD_URL');
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'molly-'));
  try {
    const args = [
      '--quiet', '--no-warnings', '--no-playlist',
      '--skip-download',
      '--write-info-json',
      '--write-subs', '--write-auto-subs',
      '--sub-langs', SUB_LANGS,
      '--sub-format', 'json3',
      '--retries', '3', '--socket-timeout', '20',
      '-o', path.join(dir, '%(id)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    try {
      await execFileAsync(YTDLP, args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      // yt-dlp may exit non-zero because of a 429 on a side track while still
      // having written the info + the English subs we need. Only fail hard if
      // we can't find an info.json afterwards (checked below).
      const stderr = String(e.stderr || e.message || '');
      if (/Private video|Sign in to confirm|members-only|This video is unavailable|Video unavailable|removed/i.test(stderr)) {
        throw withCode(new Error('Видео недоступно (приватное, удалённое или с ограничением).'), 'NOT_FOUND', e);
      }
      // otherwise continue and let the file check decide
    }

    const files = await readdir(dir);
    const infoFile = files.find((f) => f.endsWith('.info.json'));
    let meta = {};
    let manualLangs = [];
    if (infoFile) {
      try {
        const info = JSON.parse(await readFile(path.join(dir, infoFile), 'utf8'));
        meta = info;
        manualLangs = Object.keys(info.subtitles || {});
      } catch {
        // ignore malformed info
      }
    }

    const subFile = pickSubtitleFile(files, videoId, manualLangs);
    if (!subFile) {
      if (!infoFile) {
        throw withCode(new Error('Не удалось получить данные видео. Проверьте ссылку и подключение.'), 'NOT_FOUND');
      }
      throw withCode(new Error('У этого видео нет английских субтитров.'), 'NO_TRANSCRIPT');
    }

    const json3 = JSON.parse(await readFile(path.join(dir, subFile.name), 'utf8'));
    const segments = parseJson3(json3);
    if (segments.length === 0) {
      throw withCode(new Error('Субтитры найдены, но оказались пустыми.'), 'EMPTY_TRANSCRIPT');
    }

    return {
      videoId,
      title: meta.title || 'Без названия',
      author: meta.uploader || meta.channel || '',
      thumbnail: meta.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: meta.duration || 0,
      language: subFile.lang,
      auto: subFile.auto,
      segments,
      text: segments.map((s) => s.text).join(' '),
    };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Choose the best English subtitle file: manual tracks before auto-generated. */
function pickSubtitleFile(files, videoId, manualLangs) {
  const candidates = files
    .filter((f) => f.startsWith(`${videoId}.`) && f.endsWith('.json3'))
    .map((name) => {
      const lang = name.slice(videoId.length + 1, -'.json3'.length);
      const isManual = manualLangs.includes(lang);
      return { name, lang, auto: !isManual };
    });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => rank(a, manualLangs) - rank(b, manualLangs));
  return candidates[0];
}

function rank(c, manualLangs) {
  if (manualLangs.includes(c.lang)) {
    const idx = MANUAL_PRIORITY.indexOf(c.lang);
    return idx === -1 ? 50 : idx; // 0..49 reserved for manual
  }
  // auto tracks: prefer the original ("-orig" / plain en) over translated
  if (/orig/.test(c.lang)) return 100;
  return 200;
}

/** Convert YouTube json3 caption events into clean timed segments. */
function parseJson3(data) {
  const events = data?.events || [];
  const out = [];
  let lastText = '';
  for (const ev of events) {
    if (!Array.isArray(ev.segs)) continue;
    let text = ev.segs.map((s) => s.utf8 || '').join('');
    text = cleanLine(text);
    if (!text) continue;
    if (isNonSpeech(text)) continue;
    if (text === lastText) continue; // collapse rolling duplicates
    lastText = text;
    const start = Number(ev.tStartMs || 0) / 1000;
    const dur = Number(ev.dDurationMs || 0) / 1000;
    out.push({ start, end: start + dur, text });
  }
  return out;
}

function cleanLine(s) {
  return s
    .replace(/\s+/g, ' ')
    .trim();
}

/** True for lines that are only sound cues like [Music], (Applause), ♪♪♪. */
function isNonSpeech(s) {
  const stripped = s.replace(/[\[\](){}♪#*_~\-\s]/g, '');
  if (!stripped) return true;
  return /^\[?\(?(music|applause|laughter|cheering|silence)\)?\]?$/i.test(s.trim());
}

function withCode(err, code, cause) {
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}
