// Short-lived cache for heavy, read-only reports.
//
// Reports are built from many collections and cost tens to hundreds of milliseconds of
// database and CPU time each. When many people open the same report at once (a dashboard
// that every learner loads after signing in, an owner refreshing a report), each request
// used to rebuild it from scratch. Here:
//   • identical requests that arrive while the report is being built share that one build;
//   • a finished report is reused for `ttlMs` (a few seconds of staleness is fine for a
//     report — every write the user makes is visible again once the entry expires).
// Errors are never cached. The cache is per process (each cluster worker has its own).

const MAX_ENTRIES = 500;

const entries = new Map(); // key → { expiresAt, value }
const building = new Map(); // key → Promise

const prune = (now) => {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
  // Still full: drop the oldest entries (Map keeps insertion order).
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
};

/**
 * Wraps `load(args)` so its result is shared for `ttlMs`.
 * @param {string} name   report name, part of the cache key
 * @param {number} ttlMs  how long a built report is reused
 * @param {(args: object) => Promise<any>} load
 * @returns {(args: object) => Promise<any>}
 */
export function cachedReport(name, ttlMs, load) {
  return async (args = {}) => {
    const key = `${name}:${JSON.stringify(args)}`;
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const pending = building.get(key);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const value = await load(args);
        prune(Date.now());
        entries.set(key, { expiresAt: Date.now() + ttlMs, value });
        return value;
      } finally {
        building.delete(key);
      }
    })();
    building.set(key, promise);
    return promise;
  };
}
