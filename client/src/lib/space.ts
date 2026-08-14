// Синхронизация без аккаунта.
//
// У приложения нет входа: данные принадлежат не человеку, а «пространству»,
// адрес которого выводится из длинного случайного ключа, живущего в браузере.
// Ни почты, ни имени, ни OAuth — приложению нечего знать о том, кто вы.
//
// Ключ длинный (120 бит) намеренно: адрес пространства даёт и чтение, и
// ЗАПИСЬ, а перебрать короткий адрес стоило бы копейки и стёрло бы данные всем
// сразу. Человеку его набирать не нужно — для переноса на второе устройство
// есть короткий одноразовый код, который живёт десять минут и сгорает после
// первого использования.

const KEY_STORAGE = 'molly.space.v1';

// Crockford Base32: I, L, O и U исключены, а при вводе O читается как 0,
// I и L — как 1. Именно эти пары глазами не различаются.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_CHARS = 24; // ≈120 бит
const CODE_CHARS = 6; // ≈30 бит, но только на 10 минут и на одно применение

export const PAIRING_TTL_MS = 10 * 60 * 1000;

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  // отбрасываем остаток от деления, иначе первые символы алфавита выпадали бы
  // чаще остальных
  for (let i = 0; i < n; i++) {
    let b = bytes[i];
    while (b >= 256 - (256 % ALPHABET.length)) {
      const extra = new Uint8Array(1);
      crypto.getRandomValues(extra);
      b = extra[0];
    }
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

export function newSpaceKey(): string {
  return randomChars(KEY_CHARS);
}

export function newPairingCode(): string {
  return randomChars(CODE_CHARS);
}

/** Убирает пробелы, дефисы и приводит к алфавиту ключа. */
export function normalizeKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function isValidKey(raw: string): boolean {
  const k = normalizeKey(raw);
  return k.length === KEY_CHARS && [...k].every((c) => ALPHABET.includes(c));
}

export function isValidCode(raw: string): boolean {
  const c = normalizeKey(raw);
  return c.length === CODE_CHARS && [...c].every((ch) => ALPHABET.includes(ch));
}

/** Ключ читается человеком группами по четыре. */
export function formatKey(key: string): string {
  return (key.match(/.{1,4}/g) || []).join('-');
}

export function formatCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/**
 * Адрес пространства — SHA-256 от ключа. Сам ключ на сервер не попадает
 * никогда: даже имея полную копию базы, из адреса его не восстановить.
 */
export async function spaceIdFor(key: string): Promise<string> {
  const data = new TextEncoder().encode(`molly-space:${normalizeKey(key)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------ local storage ------------------------------ */

export function loadSpaceKey(): string | null {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    return raw && isValidKey(raw) ? normalizeKey(raw) : null;
  } catch {
    return null;
  }
}

export function saveSpaceKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, normalizeKey(key));
  } catch {
    /* приватный режим — синхронизация не переживёт вкладку, приложение да */
  }
}

/** Ключ этого браузера; создаётся при первом запуске. */
export function ensureSpaceKey(): string {
  const existing = loadSpaceKey();
  if (existing) return existing;
  const key = newSpaceKey();
  saveSpaceKey(key);
  return key;
}
