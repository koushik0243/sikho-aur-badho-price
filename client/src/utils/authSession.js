// Session-lifetime utilities shared by all three portals (SuperAdmin, StoreOwner,
// Learner). Backs the three logout triggers requested:
//   1. 30 minutes of inactivity  → IDLE_TIMEOUT_MS + lastActivityAt in localStorage
//      (localStorage so it survives page reloads and a tab left open overnight).
//   2. Browser tab closed        → SESSION_ALIVE_KEY in sessionStorage, which the
//      browser clears automatically when the tab is closed.
//   3. Browser closed            → same sessionStorage marker (also cleared).
//
// The actual auth token stays in localStorage (many pages already read it directly
// from there for one-off requests) — these utilities layer expiry checks on top
// rather than moving where the token lives, keeping the change low-risk.

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const LAST_ACTIVITY_KEY = 'lastActivityAt';
const SESSION_ALIVE_KEY = 'sessionAlive';

const AUTH_LOCAL_KEYS = ['adminToken', 'BHARAT_TOKEN', 'authUser', 'authUserType', LAST_ACTIVITY_KEY];

/** Call right after a successful login/OTP-verify/account-activation. */
export function markSessionAlive() {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_ALIVE_KEY, '1');
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

/** Call on any user interaction (mouse move, key press, click, scroll, touch). */
export function touchActivity() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

/**
 * True when the session should be treated as expired:
 * - the tab/browser was closed and reopened (sessionStorage marker is gone), or
 * - more than IDLE_TIMEOUT_MS has passed since the last recorded activity.
 * Only meaningful when a token is actually present — callers should check that first.
 */
export function isSessionExpired() {
  if (typeof window === 'undefined') return false;

  if (!sessionStorage.getItem(SESSION_ALIVE_KEY)) return true;

  const lastActivityRaw = localStorage.getItem(LAST_ACTIVITY_KEY);
  const lastActivity = lastActivityRaw ? Number(lastActivityRaw) : null;
  if (!lastActivity || Number.isNaN(lastActivity)) return true;

  return Date.now() - lastActivity > IDLE_TIMEOUT_MS;
}

// ── The login token itself ──────────────────────────────────────────────────
// Besides inactivity, a login ends when its token does: the server issues it with an
// expiry (JWT `exp`, JWT_EXPIRE on the server) and rejects it afterwards. The portals check
// that time locally so an open page never keeps showing data on a dead login.

// Treat the token as expired a little early, so a request never leaves with seconds to go.
const EXPIRY_SKEW_MS = 5 * 1000;

/** This tab's stored login token (without "Bearer "), or null. */
export function getStoredToken() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('adminToken') || localStorage.getItem('BHARAT_TOKEN');
  if (!raw || raw === 'undefined' || raw === 'null') return null;
  const token = String(raw).trim().replace(/^"|"$/g, '');
  return (token.startsWith('Bearer ') ? token.slice(7).trim() : token) || null;
}

/** When the token expires (ms since epoch), from its `exp` claim; null if it carries none. */
export function tokenExpiresAt(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null; // not a readable JWT — the server will judge it
  }
}

/** True once the token's expiry time has passed (false if it has no expiry). */
export function isTokenExpired(token = getStoredToken()) {
  const expiresAt = tokenExpiresAt(token);
  return expiresAt !== null && Date.now() >= expiresAt - EXPIRY_SKEW_MS;
}

/** Clears every stored auth artifact (local + session storage). Safe to call anytime. */
export function clearStoredSession() {
  if (typeof window === 'undefined') return;
  AUTH_LOCAL_KEYS.forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem(SESSION_ALIVE_KEY);
}

// Why the user was sent to the login page (shown there once, see Components/Auth/AuthPage.js).
export const LOGOUT_REASONS = {
  expired: 'Your session has expired. Please sign in again.',
  invalid: 'Your session is no longer valid. Please sign in again.',
  idle: 'You were signed out after 30 minutes of inactivity, or because the browser was closed. Please sign in again.',
  changed: 'You signed in or out in another tab. Please sign in again to continue here.',
};

/**
 * Hard-logout: clears storage and sends the browser to /login via a full navigation
 * (not router.push) so every in-memory Redux/component state resets cleanly too.
 * @param {keyof LOGOUT_REASONS} [reason]  shown on the login page
 */
export function forceLogout(reason) {
  if (typeof window === 'undefined') return;
  clearStoredSession();
  goToLogin(reason);
}

/**
 * Sends the browser to /login WITHOUT clearing storage — for when another tab now holds a
 * different, valid login that must not be wiped (the login page then follows that login).
 */
export function goToLogin(reason) {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  window.location.href = reason && LOGOUT_REASONS[reason] ? `/login?reason=${reason}` : '/login';
}
