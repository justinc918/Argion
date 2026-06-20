// cache.js
//
// Dumb in-memory TTL cache. No Redis, no DB -- this is a 20-hour hackathon.
// Keeps the server from hammering JPL faster than the fair-use ~60s rule.

const store = new Map(); // key -> { value, expiresAt }

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Fetch-or-cache helper: if fresh value exists, return it; otherwise call
// `fn`, cache the result, and return it. Concurrent callers during a single
// miss share the same in-flight promise so we don't double-fire requests.
const inFlight = new Map();

export async function cached(key, ttlMs, fn) {
  const hit = getCached(key);
  if (hit !== undefined) return hit;

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    try {
      const value = await fn();
      setCached(key, value, ttlMs);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}
