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

/** Mobile browsers and installed PWAs: a popup gets backgrounded when Google's
 * 2FA sends the user to another app (YouTube), which breaks the flow. A
 * full-page redirect survives app-switching, so prefer it there. */
function prefersRedirect(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari legacy standalone flag
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  const mobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  return standalone || mobileUA;
}

/**
 * Upgrade the anonymous account to a Google account (progress is kept).
 * On mobile/PWA go straight to a full-page redirect; on desktop use a popup
 * and fall back to redirect if it's blocked. If this Google account is
 * already a user, switch to it instead.
 */
export async function linkGoogle(): Promise<User> {
  const user = auth.currentUser;
  if (!user) throw new Error('Нет активной сессии.');
  const provider = new GoogleAuthProvider();

  if (prefersRedirect()) {
    await linkWithRedirect(user, provider); // page navigates away; result handled on return
    return user; // unreachable in practice
  }

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
