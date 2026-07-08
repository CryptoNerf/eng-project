import {
  GoogleAuthProvider,
  getRedirectResult,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

/**
 * Subscribe to auth state; silently create an anonymous account on first
 * visit. If auth is unreachable/disabled, reports null (app falls back to
 * localStorage mode). Also completes a pending Google link after a redirect
 * flow (mobile PWA path).
 */
export function watchUser(cb: (user: User | null) => void): () => void {
  let triedAnon = false;

  // Completes linkWithRedirect started on a previous page load (mobile).
  getRedirectResult(auth).catch(async (e) => {
    const err = e as { code?: string };
    if (err.code === 'auth/credential-already-in-use') {
      const cred = GoogleAuthProvider.credentialFromError(e as never);
      if (cred) await signInWithCredential(auth, cred).catch(() => {});
    }
  });

  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      cb(user);
      return;
    }
    if (!triedAnon) {
      triedAnon = true;
      try {
        await signInAnonymously(auth); // fires onAuthStateChanged again
        return;
      } catch (e) {
        console.warn('Анонимный вход недоступен, работаем локально:', e);
      }
    }
    cb(null);
  });
}

/**
 * Upgrade the anonymous account to a Google account (progress is kept).
 * Popup first; environments that block popups (installed PWA on iOS/Android)
 * fall back to a full-page redirect. If this Google account is already a
 * user, switch to it instead.
 */
export async function linkGoogle(): Promise<User> {
  const user = auth.currentUser;
  if (!user) throw new Error('Нет активной сессии.');
  const provider = new GoogleAuthProvider();
  try {
    const cred = await linkWithPopup(user, provider);
    return cred.user;
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'auth/credential-already-in-use') {
      const cred = GoogleAuthProvider.credentialFromError(e as never);
      if (cred) {
        const res = await signInWithCredential(auth, cred);
        return res.user;
      }
    }
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/operation-not-supported-in-this-environment' ||
      err.code === 'auth/cancelled-popup-request'
    ) {
      await linkWithRedirect(user, provider); // page navigates away
      return user; // unreachable in practice
    }
    throw e;
  }
}
