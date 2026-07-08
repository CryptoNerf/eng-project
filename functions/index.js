import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { gzipSync, gunzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchTranscript, parseVideoId } from './transcript.js';

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
      return p;
    })();
  }
  return cookiesReady;
}

// Firestore fields cap at ~1 MiB; skip caching pathological transcripts.
const MAX_CACHE_BYTES = 900_000;

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
      console.error('[ingest]', videoId, e.code || 'ERROR', e.message);
      const stderrTail = String(e.cause?.stderr || '').slice(-400);
      if (stderrTail) console.error('[ingest:stderr]', videoId, stderrTail);
      throw new HttpsError(
        CODE_MAP[e.code] || 'internal',
        e.message || 'Не удалось извлечь субтитры.',
      );
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
