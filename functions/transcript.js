import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const YTDLP = process.env.YTDLP_PATH || path.join(__dirname, 'bin', 'yt-dlp');

// bgutil PoToken provider (see scripts/setup-bgutil.js). When present, yt-dlp
// can mint BotGuard tokens and pass YouTube's bot-check from datacenter IPs.
const PLUGINS_DIR = path.join(__dirname, 'plugins');
const POT_SCRIPT = path.join(__dirname, 'bgutil', 'server', 'build', 'generate_once.js');
let potReady = null;
async function potArgs() {
  if (potReady === null) {
    potReady = await stat(POT_SCRIPT).then(() => true).catch(() => false);
  }
  return potReady
    ? ['--plugin-dirs', PLUGINS_DIR, '--extractor-args', `youtubepot-bgutilscript:script_path=${POT_SCRIPT}`]
    : [];
}

// Manual English tracks in preference order; auto tracks tried after.
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
 *
 * Two-phase to spend YouTube's tight per-IP timedtext quota carefully:
 *   1) fetch video info only (player request, no subtitles);
 *   2) pick the single best English track and download exactly that one,
 *      reusing the phase-1 info (no second player request).
 *
 * Returns { videoId, title, author, thumbnail, duration, segments, text,
 * language, auto }. Each segment: { start (sec), end (sec), text }.
 */
export async function fetchTranscript(input, opts = {}) {
  const videoId = parseVideoId(input);
  if (!videoId) {
    throw withCode(new Error('Не удалось распознать ссылку на YouTube-видео.'), 'BAD_URL');
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'molly-'));
  try {
    const base = [
      ...(opts.verbose ? ['-v'] : ['--quiet', '--no-warnings']),
      '--no-playlist',
      '--skip-download',
      '--retries', '3', '--socket-timeout', '20',
      '--retry-sleep', 'http:exp=1:10',
      '--js-runtimes', 'node', // yt-dlp defaults to deno-only; the container has node
      '--cache-dir', path.join(tmpdir(), 'yt-dlp-cache'), // FS is read-only outside /tmp
      ...(await potArgs()),
      ...(opts.cookiesFile ? ['--cookies', opts.cookiesFile] : []),
      ...(opts.playerClient
        ? ['--extractor-args', `youtube:player_client=${opts.playerClient}`]
        : []),
      '-o', path.join(dir, '%(id)s.%(ext)s'),
    ];

    /* ---------- phase 1: video info only ---------- */
    let infoStderr = '';
    try {
      const r = await run([...base, '--write-info-json', `https://www.youtube.com/watch?v=${videoId}`]);
      infoStderr = r.stderr;
    } catch (e) {
      const stderr = String(e.stderr || e.message || '');
      if (/Sign in to confirm/i.test(stderr)) {
        throw withCode(new Error('YouTube требует подтверждение (bot-check с этого IP).'), 'BOT_CHECK', e);
      }
      if (/Private video|members-only|This video is unavailable|Video unavailable|removed/i.test(stderr)) {
        throw withCode(new Error('Видео недоступно (приватное, удалённое или с ограничением).'), 'NOT_FOUND', e);
      }
      throw withCode(new Error('Не удалось получить данные видео. Проверьте ссылку.'), 'NOT_FOUND', e);
    }

    const infoPath = path.join(dir, `${videoId}.info.json`);
    let info;
    try {
      info = JSON.parse(await readFile(infoPath, 'utf8'));
    } catch {
      throw withCode(
        new Error('Не удалось получить данные видео. Проверьте ссылку и попробуйте ещё раз.'),
        'NOT_FOUND',
        { stderr: infoStderr },
      );
    }

    /* ---------- pick the single best English track ---------- */
    const manual = Object.keys(info.subtitles || {});
    const auto = Object.keys(info.automatic_captions || {});
    const track = pickTrack(manual, auto);
    if (!track) {
      throw withCode(new Error('У этого видео нет английских субтитров.'), 'NO_TRANSCRIPT');
    }

    /* ---------- phase 2: download exactly one track (info reused) ---------- */
    const subArgs = [
      ...base,
      '--load-info-json', infoPath,
      track.auto ? '--write-auto-subs' : '--write-subs',
      '--sub-langs', track.code,
      '--sub-format', 'json3',
    ];

    let segments = null;
    let lastErr = '';
    for (let attempt = 0; attempt < 2 && !segments; attempt++) {
      if (attempt > 0) await sleep(4000); // one retry: timedtext 429s are often transient
      try {
        const r = await run(subArgs);
        lastErr = r.stderr;
      } catch (e) {
        lastErr = String(e.stderr || e.message || '');
      }
      const subFile = (await readdir(dir)).find(
        (f) => f.startsWith(`${videoId}.`) && f.endsWith('.json3'),
      );
      if (subFile) {
        const json3 = JSON.parse(await readFile(path.join(dir, subFile), 'utf8'));
        segments = parseJson3(json3);
      }
    }

    if (!segments) {
      const rateLimited = /429|Too Many Requests/i.test(lastErr);
      throw withCode(
        new Error(
          rateLimited
            ? 'YouTube временно ограничил загрузку субтитров. Попробуйте через несколько минут.'
            : 'Не удалось скачать субтитры. Попробуйте ещё раз.',
        ),
        rateLimited ? 'RATE_LIMITED' : 'SUBS_FAILED',
        { stderr: lastErr },
      );
    }
    if (segments.length === 0) {
      throw withCode(new Error('Субтитры найдены, но оказались пустыми.'), 'EMPTY_TRANSCRIPT');
    }

    return {
      videoId,
      title: info.title || 'Без названия',
      author: info.uploader || info.channel || '',
      thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: info.duration || 0,
      language: track.code,
      auto: track.auto,
      segments,
      text: segments.map((s) => s.text).join(' '),
    };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function run(args) {
  return execFileAsync(YTDLP, args, {
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
    // HOME on /tmp: yt-dlp and the PoT node script both write caches there
    env: { ...process.env, HOME: tmpdir() },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Manual en variants first, then original auto track, then plain auto en. */
function pickTrack(manual, auto) {
  for (const code of MANUAL_PRIORITY) {
    if (manual.includes(code)) return { code, auto: false };
  }
  const anyManualEn = manual.find((l) => /^en/i.test(l));
  if (anyManualEn) return { code: anyManualEn, auto: false };
  if (auto.includes('en-orig')) return { code: 'en-orig', auto: true };
  if (auto.includes('en')) return { code: 'en', auto: true };
  return null;
}

/** Convert YouTube json3 caption events into clean timed segments. */
function parseJson3(data) {
  const events = data?.events || [];
  const out = [];
  let lastText = '';
  for (const ev of events) {
    if (!Array.isArray(ev.segs)) continue;
    let text = ev.segs.map((s) => s.utf8 || '').join('');
    text = text.replace(/\s+/g, ' ').trim();
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
