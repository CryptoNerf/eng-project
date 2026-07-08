// Firebase Analytics (GA4) with a safe no-op fallback: ad blockers, older
// browsers and unsupported environments must never break the app.
import {
  getAnalytics,
  isSupported,
  logEvent,
  setUserId,
  type Analytics,
} from 'firebase/analytics';
import { app } from './firebase';

let analytics: Analytics | null = null;

isSupported()
  .then((ok) => {
    if (ok) analytics = getAnalytics(app);
  })
  .catch(() => {
    /* analytics unavailable — fine */
  });

type Params = Record<string, string | number | boolean>;

/** Fire an analytics event; silently does nothing if analytics is unavailable. */
export function track(event: string, params?: Params): void {
  try {
    if (analytics) logEvent(analytics, event, params);
  } catch {
    /* never let telemetry break the app */
  }
}

/** Tie events to the (anonymous) uid so DAU/retention are meaningful. */
export function identify(uid: string | null): void {
  try {
    if (analytics) setUserId(analytics, uid);
  } catch {
    /* ignore */
  }
}
