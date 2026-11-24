'use client';

import { useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../lib/constant';
import {
  touchActivity, isSessionExpired, forceLogout, goToLogin,
  getStoredToken, tokenExpiresAt, isTokenExpired,
} from '../utils/authSession';

// Ambient user-interaction events that count as "still here". Passive + capture so
// this never interferes with the app's own click/keyboard handlers.
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

// How often to re-check elapsed time. An interval (not a single long setTimeout) is
// used because setTimeout timers don't fire reliably across system sleep/hibernate —
// re-deriving "expired?" from wall-clock time on each tick is immune to that drift.
const CHECK_INTERVAL_MS = 30 * 1000;

// Only write the activity timestamp at most this often, even if the mouse never
// stops moving — avoids hammering localStorage on every pixel of movement.
const ACTIVITY_THROTTLE_MS = 5 * 1000;

// Ask the server whether the login is still good this often (and when the tab comes back
// into view, at most every SERVER_CHECK_MIN_GAP_MS). Catches what the token alone can't
// show: a deleted or deactivated account, or a token the server no longer accepts.
const SERVER_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const SERVER_CHECK_MIN_GAP_MS = 30 * 1000;

// setTimeout can't wait longer than ~24.8 days.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** GET /user/session with this tab's token; a 401 means the login is over. */
async function sessionIsValid(token) {
  try {
    await axios.get(`${API_URL}/user/session?t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` } });
    return true;
  } catch (err) {
    // Only a definite "no" ends the session — a network blip or server error must not.
    return err?.response?.status !== 401;
  }
}

/**
 * Keeps each portal (SuperAdmin / StoreOwner / Learner) from showing data on a login that
 * has ended. Sends the user to the login page when:
 *   • the login token expires (checked at the exact moment and every 30 s),
 *   • the server says the login is no longer valid (expired, tampered, account deleted or
 *     deactivated) — asked every 2 minutes and whenever the tab comes back into view,
 *   • the stored token no longer matches the one this page started with (signed out, or
 *     signed in as someone else, in another tab),
 *   • 30 minutes pass without activity, or the tab/browser was closed and reopened.
 * Mount once per portal shell — it no-ops if nothing is logged in.
 */
export default function useIdleLogout() {
  useEffect(() => {
    // The login this page was opened with.
    const startToken = getStoredToken();
    if (!startToken) return; // nothing to guard (the shell sends a signed-out visitor to login)

    // Catches the exact reported bug: opening the app after being idle past the
    // timeout (even without closing anything) should bounce straight to login.
    if (isSessionExpired()) { forceLogout('idle'); return; }
    if (isTokenExpired(startToken)) { forceLogout('expired'); return; }

    let ended = false;
    const end = (reason, clear = true) => {
      if (ended) return;
      ended = true;
      if (clear) forceLogout(reason); else goToLogin(reason);
    };

    /** Local checks: token still the same, not expired, not idle. True while all is well. */
    const checkLocally = () => {
      if (ended) return false;
      const current = getStoredToken();
      if (!current) { end('changed'); return false; }                     // signed out elsewhere
      if (current !== startToken) { end('changed', false); return false; } // another login now
      if (isTokenExpired(current)) { end('expired'); return false; }
      if (isSessionExpired()) { end('idle'); return false; }
      return true;
    };

    let lastServerCheck = 0;
    const checkWithServer = async () => {
      if (!checkLocally() || Date.now() - lastServerCheck < SERVER_CHECK_MIN_GAP_MS) return;
      lastServerCheck = Date.now();
      // Re-check after the request: a newer login in another tab must not be cleared.
      if (!(await sessionIsValid(startToken)) && getStoredToken() === startToken) end('invalid');
    };

    let lastWrite = 0;
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_THROTTLE_MS) return;
      lastWrite = now;
      touchActivity();
    };
    const handleReturn = () => { if (document.visibilityState !== 'hidden') checkWithServer(); };
    // Another tab changed the stored login (sign-out, or sign-in as another account).
    const handleStorage = (e) => {
      if (e.key === null || ['adminToken', 'BHARAT_TOKEN'].includes(e.key)) checkLocally();
    };

    // Exactly when the token runs out (the interval below covers sleep/hibernate).
    const expiresAt = tokenExpiresAt(startToken);
    const expiryTimer = expiresAt
      ? setTimeout(checkLocally, Math.min(MAX_TIMEOUT_MS, Math.max(0, expiresAt - Date.now())))
      : null;

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleReturn);
    window.addEventListener('focus', handleReturn);
    window.addEventListener('storage', handleStorage);
    const localTimer = setInterval(checkLocally, CHECK_INTERVAL_MS);
    const serverTimer = setInterval(checkWithServer, SERVER_CHECK_INTERVAL_MS);
    checkWithServer(); // once on open: a page restored from cache may hold a dead login

    return () => {
      ended = true;
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handleActivity));
      document.removeEventListener('visibilitychange', handleReturn);
      window.removeEventListener('focus', handleReturn);
      window.removeEventListener('storage', handleStorage);
      clearInterval(localTimer);
      clearInterval(serverTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, []);
}
