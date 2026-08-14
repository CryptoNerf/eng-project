// Перенос ключа на второе устройство коротким одноразовым кодом.
//
// Сам ключ длинный и набирать его руками не нужно: устройство кладёт его в
// документ `pairings/{код}`, живущий десять минут, а второе устройство
// забирает и сразу удаляет запись. Код короткий, но его окно узкое и он
// сгорает после первого применения — перебирать почти нечего и почти некогда.

import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { newPairingCode, normalizeKey, PAIRING_TTL_MS } from './space';

export interface Pairing {
  code: string;
  expiresAt: number;
}

/** Публикует ключ под свежим кодом. */
export async function publishPairing(key: string): Promise<Pairing> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairingCode();
    const ref = doc(db, 'pairings', code);
    const snap = await getDoc(ref).catch(() => null);
    // код занят живой записью — берём другой
    if (snap?.exists() && Number(snap.data().exp || 0) > Date.now()) continue;
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    await setDoc(ref, { key: normalizeKey(key), exp: expiresAt });
    return { code, expiresAt };
  }
  throw new Error('Не удалось создать код. Попробуйте ещё раз.');
}

/** Забирает ключ по коду и гасит запись. null — код неверный или истёк. */
export async function claimPairing(code: string): Promise<string | null> {
  const ref = doc(db, 'pairings', normalizeKey(code));
  const snap = await getDoc(ref).catch(() => null);
  if (!snap?.exists()) return null;
  const data = snap.data();
  // запись удаляем в любом случае: истёкшая мусорит, использованная опасна
  await deleteDoc(ref).catch(() => {});
  if (Number(data.exp || 0) < Date.now()) return null;
  const key = String(data.key || '');
  return key ? normalizeKey(key) : null;
}

/** Досрочно гасит код — например, когда окно синхронизации закрыли. */
export async function revokePairing(code: string): Promise<void> {
  await deleteDoc(doc(db, 'pairings', normalizeKey(code))).catch(() => {});
}
