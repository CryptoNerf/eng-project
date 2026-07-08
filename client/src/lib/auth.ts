import {
  EmailAuthProvider,
  GoogleAuthProvider,
  getRedirectResult,
  isSignInWithEmailLink,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailLink,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

const EMAIL_KEY = 'molly.emailForSignIn';

/**
 * Subscribe to auth state; silently create an anonymous account on first
 * visit. If auth is unreachable/disabled, reports null (app falls back to
 * localStorage mode). Also completes a pending Google link after a redirect
 * flow (desktop popup-blocked path).
 */
export function watchUser(cb: (user: User | null) => void): () => void {
  let triedAnon = false;

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
 * Upgrade the anonymous account to a Google account via popup (progress is
 * kept). Popups are the Firebase-recommended method when the app isn't hosted
 * on the auth domain. If the account already exists, switch to it. Falls back
 * to redirect only if the popup is blocked (desktop).
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
      if (cred) return (await signInWithCredential(auth, cred)).user;
    }
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await linkWithRedirect(user, provider);
      return user; // navigates away
    }
    throw e;
  }
}

/* ---------------- Email-link (passwordless) — reliable on iOS/PWA -------- */

/** Send a one-time sign-in link to the given email. */
export async function sendEmailLink(email: string): Promise<void> {
  const url = window.location.origin + window.location.pathname;
  await sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
  window.localStorage.setItem(EMAIL_KEY, email);
}

/** True if the current page URL is a Firebase email sign-in link. */
export function pendingEmailLink(): boolean {
  return isSignInWithEmailLink(auth, window.location.href);
}

/**
 * Complete an email-link sign-in if the URL carries one. Links to the current
 * anonymous account when possible (keeps progress); if that email already has
 * an account, signs into it instead. Returns true if a sign-in happened.
 */
export async function completeEmailLink(promptForEmail: () => string | null): Promise<boolean> {
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;
  const href = window.location.href;
  let email = window.localStorage.getItem(EMAIL_KEY) || '';
  if (!email) email = promptForEmail() || '';
  if (!email) return false;

  const cred = EmailAuthProvider.credentialWithLink(email, href);
  const user = auth.currentUser;
  try {
    if (user && user.isAnonymous) {
      await linkWithCredential(user, cred);
    } else {
      await signInWithEmailLink(auth, email, href);
    }
  } catch (e) {
    const err = e as { code?: string };
    if (
      err.code === 'auth/credential-already-in-use' ||
      err.code === 'auth/email-already-in-use'
    ) {
      await signInWithEmailLink(auth, email, href);
    } else {
      throw e;
    }
  } finally {
    window.localStorage.removeItem(EMAIL_KEY);
    // strip the oobCode query so a refresh doesn't re-trigger the flow
    window.history.replaceState({}, '', window.location.pathname);
  }
  return true;
}
