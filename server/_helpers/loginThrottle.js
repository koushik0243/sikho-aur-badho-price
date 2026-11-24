// Brute-force protection for password logins. Only FAILED attempts count, so a burst of
// genuine logins (e.g. a whole organization signing in at 9 am) is never slowed down.
//   • per account (email / phone): 5 failures in 15 min → that account is blocked for 15 min
//   • per IP address:             30 failures in 15 min → that IP is blocked for 15 min
// Kept in memory, per server process (enough to stop password guessing; it resets on restart).

const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { account: 5, ip: 30 };
const MAX_ENTRIES = 50000; // bound memory if someone sprays random identifiers

const failures = new Map(); // key → { count, firstAt, blockedUntil }

function entry(key, now) {
    let e = failures.get(key);
    if (!e || (now - e.firstAt > WINDOW_MS && (!e.blockedUntil || now > e.blockedUntil))) {
        e = { count: 0, firstAt: now, blockedUntil: 0 };
        if (failures.size >= MAX_ENTRIES) failures.delete(failures.keys().next().value);
        failures.set(key, e);
    }
    return e;
}

const keysFor = (identifier, ip) => [
    ['account', `a:${String(identifier || '').trim().toLowerCase()}`],
    ['ip', `i:${ip || 'unknown'}`],
];

/** Throws 429 while this account or IP is blocked. Call before checking the password. */
export function assertLoginAllowed(identifier, ip) {
    const now = Date.now();
    for (const [, key] of keysFor(identifier, ip)) {
        const e = failures.get(key);
        if (e?.blockedUntil && now < e.blockedUntil) {
            const minutes = Math.ceil((e.blockedUntil - now) / 60000);
            const err = new Error(`Too many failed login attempts. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
            err.statusCode = 429;
            throw err;
        }
    }
}

/** Records a wrong password / unknown account. */
export function recordLoginFailure(identifier, ip) {
    const now = Date.now();
    for (const [kind, key] of keysFor(identifier, ip)) {
        const e = entry(key, now);
        e.count += 1;
        if (e.count >= LIMITS[kind]) e.blockedUntil = now + WINDOW_MS;
    }
}

/** A successful login clears the account's failures (not the IP's). */
export function recordLoginSuccess(identifier) {
    failures.delete(keysFor(identifier, null)[0][1]);
}
