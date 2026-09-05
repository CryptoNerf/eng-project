import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { gzipSync, gunzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchInfo, fetchTranscript, parseVideoId } from './transcript.js';

initializeApp();
const db = getFirestore();

// cookies.txt (Netscape format) of a throwaway Google account — lets yt-dlp
// pass YouTube's bot-check from datacenter IPs. Managed via Secret Manager:
//   npx firebase-tools functions:secrets:set YT_COOKIES --data-file cookies.txt
const YT_COOKIES = defineSecret('YT_COOKIES');

let cookiesReady = null;
/** Materialize the cookies secret into /tmp once per instance; null if unset. */
function getCookiesFile() {
  if (!cookiesReady) {
    cookiesReady = (async () => {
      const raw = YT_COOKIES.value() || '';
      if (raw.trim().length < 100) return null; // placeholder or empty
      const p = path.join(tmpdir(), 'yt-cookies.txt');
      await writeFile(p, raw, 'utf8');
      reportCookieHealth(raw); // не ждём: диагностика не должна задерживать ответ
      return p;
    })();
  }
  return cookiesReady;
}

/**
 * Раз на инстанс проверяет, признаёт ли YouTube нашу сессию, и пишет это в лог.
 *
 * Куки умирают тихо: сроки в файле остаются годными, а сессию Google гасит на
 * своей стороне — и bot-check возвращается для всех пользователей сразу. Раньше
 * об этом сообщали сами пользователи; теперь строчка в логах появляется при
 * первом же холодном старте, и по ней можно повесить оповещение.
 */
async function reportCookieHealth(raw) {
  try {
    // Только куки, подходящие youtube.com: экспорт тащит их для всех доменов
    // Google, и одно имя встречается по разу на домен с разными значениями.
    const host = 'www.youtube.com';
    const jar = new Map();
    for (const line of raw.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const f = line.split('\t');
      if (f.length < 7) continue;
      const domain = f[0].replace(/^\./, '');
      if (host !== domain && !host.endsWith(`.${domain}`)) continue;
      jar.set(f[5], f[6]);
    }
    const res = await fetch('https://www.youtube.com/', {
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      },
    });
    const ok = /"LOGGED_IN":true/.test(await res.text());
    if (ok) console.log('[cookies] сессия YouTube жива');
    else console.error('[cookies] СЕССИЯ МЕРТВА — нужны свежие куки, иначе вернётся bot-check');
  } catch (e) {
    console.warn('[cookies] проверку выполнить не удалось:', e.message);
  }
}

// Firestore fields cap at ~1 MiB; skip caching pathological transcripts.
const MAX_CACHE_BYTES = 900_000;

// Bump when the cached video document gains a field worth backfilling.
// v2 added `chapters`.
const VIDEO_CACHE_V = 2;
// Videos cached before v2 get one cheap info-only fetch to pick chapters up.
// If that fails (bot-check, network), don't retry on every open.
const BACKFILL_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

const CODE_MAP = {
  BAD_URL: 'invalid-argument',
  NOT_FOUND: 'not-found',
  NO_TRANSCRIPT: 'failed-precondition',
  EMPTY_TRANSCRIPT: 'failed-precondition',
  BOT_CHECK: 'unavailable',
};

/**
 * Extract the English transcript of a YouTube video.
 * Global cache: each video is fetched from YouTube once ever (videos/{id}),
 * then served to all users from Firestore.
 */
export const ingest = onCall(
  {
    region: 'europe-west1',
    memory: '1GiB',
    timeoutSeconds: 120,
    maxInstances: 3,
    concurrency: 1, // yt-dlp + PoToken node process are memory-hungry
    cors: true,
    secrets: [YT_COOKIES],
  },
  async (request) => {
    // Warmup ping: boots the instance while the user is still typing the URL,
    // so the real request skips the cold start. Does no work.
    if (request.data?.warmup) {
      return { ok: true, warm: true };
    }
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Требуется вход в приложение.');
    }
    const videoId = parseVideoId(String(request.data?.url || ''));
    if (!videoId) {
      throw new HttpsError('invalid-argument', 'Не удалось распознать ссылку на YouTube-видео.');
    }

    // 1) global cache hit → free and instant
    const ref = db.collection('videos').doc(videoId);
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      const segments = JSON.parse(gunzipSync(d.gz).toString('utf8'));
      return {
        videoId,
        title: d.title,
        author: d.author,
        thumbnail: d.thumbnail,
        duration: d.duration,
        language: d.language,
        auto: d.auto,
        chapters: await chaptersFor(ref, videoId, d),
        segments,
        text: segments.map((s) => s.text).join(' '),
        cached: true,
      };
    }

    // 2) miss → yt-dlp via cookies, then cache for everyone
    let t;
    try {
      t = await fetchTranscript(videoId, { cookiesFile: await getCookiesFile() });
    } catch (e) {
      // Куки протухли или YouTube их не принял — одна попытка без них, на голом
      // PoToken. Шанс невелик, но пользователю она достаётся бесплатно, а
      // альтернатива — гарантированная ошибка.
      if (e.code === 'BOT_CHECK') {
        console.warn('[ingest]', videoId, 'bot-check с куками — пробуем без них');
        t = await fetchTranscript(videoId, {}).catch(() => null);
      }
      if (!t) {
        console.error('[ingest]', videoId, e.code || 'ERROR', e.message);
        const stderrTail = String(e.cause?.stderr || '').slice(-400);
        if (stderrTail) console.error('[ingest:stderr]', videoId, stderrTail);
        throw new HttpsError(
          CODE_MAP[e.code] || 'internal',
          e.message || 'Не удалось извлечь субтитры.',
        );
      }
      console.log('[ingest]', videoId, 'получилось без кук');
    }

    const gz = gzipSync(JSON.stringify(t.segments));
    if (gz.length <= MAX_CACHE_BYTES) {
      await ref
        .set({
          title: t.title,
          author: t.author,
          thumbnail: t.thumbnail,
          duration: t.duration,
          language: t.language,
          auto: t.auto,
          chapters: t.chapters || [],
          cv: VIDEO_CACHE_V,
          segmentsCount: t.segments.length,
          gz,
          createdAt: FieldValue.serverTimestamp(),
          addedBy: request.auth.uid,
        })
        .catch((err) => console.warn('[ingest] cache write failed:', err.message));
    }

    return { ...t, cached: false };
  },
);

/**
 * Chapters for a cached video. Documents written before VIDEO_CACHE_V have
 * none, so we backfill them with an info-only yt-dlp call — it spends a player
 * request but not the scarce timedtext quota. Best-effort: on failure the
 * client falls back to splitting the video by time.
 */
async function chaptersFor(ref, videoId, d) {
  if (Array.isArray(d.chapters)) return d.chapters;
  const tried = Number(d.chaptersTriedAt || 0);
  if (Date.now() - tried < BACKFILL_RETRY_MS) return [];
  try {
    const info = await fetchInfo(videoId, { cookiesFile: await getCookiesFile() });
    await ref.set(
      { chapters: info.chapters, cv: VIDEO_CACHE_V, chaptersTriedAt: Date.now() },
      { merge: true },
    );
    return info.chapters;
  } catch (e) {
    console.warn('[ingest] chapter backfill failed:', videoId, e.message);
    await ref.set({ chaptersTriedAt: Date.now() }, { merge: true }).catch(() => {});
    return [];
  }
}
