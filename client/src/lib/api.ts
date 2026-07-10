import { httpsCallable } from 'firebase/functions';
import { fns } from './firebase';
import type { Transcript } from './types';

export { translateBatch } from './translate';

export class ApiError extends Error {
  code: string;
  constructor(message: string, code = 'ERROR') {
    super(message);
    this.code = code;
  }
}

// Cold ingest (yt-dlp + PoToken) can take ~30s; give it generous headroom.
const ingestCall = httpsCallable<
  { url: string; warmup?: boolean },
  Transcript & { cached?: boolean }
>(fns, 'ingest', { timeout: 150_000 });

/**
 * Fire-and-forget ping that boots a function instance while the user is
 * still typing/pasting the URL — the real request then skips the cold start.
 */
export function warmupIngest(): void {
  ingestCall({ url: '', warmup: true }).catch(() => {});
}

const FRIENDLY: Record<string, string> = {
  'functions/unauthenticated': 'Идёт вход… Подождите пару секунд и попробуйте снова.',
  'functions/internal': 'Не удалось получить субтитры. Попробуйте ещё раз.',
  'functions/deadline-exceeded': 'YouTube отвечает слишком долго. Попробуйте ещё раз.',
};

export async function fetchTranscript(url: string): Promise<Transcript> {
  try {
    const res = await ingestCall({ url });
    return res.data;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = err.code || 'ERROR';
    // HttpsError messages from our function are already user-facing Russian;
    // generic SDK codes get friendly fallbacks.
    const msg = FRIENDLY[code] || err.message || 'Что-то пошло не так. Попробуйте ещё раз.';
    throw new ApiError(msg, code.replace('functions/', '').toUpperCase());
  }
}
