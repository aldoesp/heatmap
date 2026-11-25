import { Buffer } from 'node:buffer';

const MIB = 1024 * 1024;

function counters() {
  return { hits: 0, misses: 0, evictions: 0, expirations: 0, invalidations: 0, rejectedEntries: 0 };
}

// Estimates retained data and references on writes only. Shared objects and
// Buffer backing stores are counted once per entry, including cyclic graphs.
function estimateValue(value, budget) {
  const pending = [value];
  const seen = new WeakSet();
  let bytes = 0;
  while (pending.length && bytes <= budget) {
    const item = pending.pop();
    if (item === null || item === undefined || typeof item === 'boolean') {
      bytes += 8;
    } else if (typeof item === 'string') {
      bytes += 16 + item.length * 2;
    } else if (typeof item === 'number') {
      bytes += 8;
    } else if (typeof item === 'bigint') {
      bytes += 24 + Math.ceil(item.toString(16).length / 2);
    } else if (typeof item === 'object') {
      if (seen.has(item)) continue;
      seen.add(item);
      if (Buffer.isBuffer(item)) {
        bytes += 64;
        if (!seen.has(item.buffer)) {
          seen.add(item.buffer);
          bytes += item.buffer.byteLength;
        }
        continue;
      }
      const array = Array.isArray(item);
      const prototype = Object.getPrototypeOf(item);
      if (!array && prototype !== Object.prototype && prototype !== null) return Infinity;
      bytes += 32 + (array ? item.length * 8 : 0);
      if (bytes > budget) break;
      for (const key of Object.keys(item)) {
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (!Object.hasOwn(property, 'value')) return Infinity;
        bytes += 16 + key.length * 2;
        if (bytes > budget) break;
        pending.push(property.value);
      }
    } else {
      return Infinity;
    }
  }
  return bytes;
}

function assertKey(key) {
  if (typeof key !== 'string') throw new TypeError('La clé ou le préfixe doit être une chaîne.');
}

/**
 * Cache synchrone. Les valeurs sont partagées par référence et réservées à la
 * lecture. Convention de clés : segments encodés avec encodeURIComponent,
 * séparés par « : ». Pour invalider un groupe, terminer le préfixe par « : ».
 */
export function createMemoryCache({
  maxEntries = 300,
  maxSizeBytes = 64 * MIB,
  maxEntrySizeBytes = 8 * MIB,
  defaultTtlMs = 60_000,
  now = Date.now,
} = {}) {
  for (const [name, value] of Object.entries({ maxEntries, maxSizeBytes, maxEntrySizeBytes, defaultTtlMs })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} doit être un entier positif ou nul.`);
  }
  if (typeof now !== 'function') throw new TypeError('now doit être une fonction.');

  const entries = new Map();
  let counts = counters();
  let estimatedSizeBytes = 0;

  function remove(key, entry) {
    entries.delete(key);
    estimatedSizeBytes -= entry.size;
  }

  function expire(key, entry, time) {
    if (entry.expiresAt > time) return false;
    remove(key, entry);
    counts.expirations++;
    return true;
  }

  function lookup(key) {
    assertKey(key);
    const entry = entries.get(key);
    if (!entry || expire(key, entry, now())) return undefined;
    entries.delete(key);
    entries.set(key, entry);
    return entry;
  }

  function get(key) {
    const entry = lookup(key);
    if (!entry) {
      counts.misses++;
      return undefined;
    }
    counts.hits++;
    return entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    assertKey(key);
    const time = now();
    const previous = entries.get(key);
    if (previous && !expire(key, previous, time)) remove(key, previous);

    const expiresAt = typeof ttlMs === 'number' ? time + ttlMs : NaN;
    const budget = Math.min(maxSizeBytes, maxEntrySizeBytes);
    const overhead = 64 + key.length * 2;
    const size = value === undefined || !Number.isFinite(expiresAt) || expiresAt <= time ||
        !maxEntries || overhead > budget
      ? Infinity
      : overhead + estimateValue(value, budget - overhead);
    if (size > budget) {
      counts.rejectedEntries++;
      return false;
    }

    if (entries.size >= maxEntries || estimatedSizeBytes + size > maxSizeBytes) {
      for (const [expiredKey, entry] of entries) expire(expiredKey, entry, time);
      for (const [oldestKey, entry] of entries) {
        if (entries.size < maxEntries && estimatedSizeBytes + size <= maxSizeBytes) break;
        remove(oldestKey, entry);
        counts.evictions++;
      }
    }
    entries.set(key, { value, expiresAt, size });
    estimatedSizeBytes += size;
    return true;
  }

  return {
    get,
    set,
    getOrSet(key, ttlMs, loader) {
      const value = get(key);
      if (value !== undefined) return value;
      const loaded = loader();
      set(key, loaded, ttlMs);
      return loaded;
    },
    has(key) {
      return lookup(key) !== undefined;
    },
    delete(key) {
      assertKey(key);
      const entry = entries.get(key);
      if (!entry || expire(key, entry, now())) return false;
      remove(key, entry);
      return true;
    },
    invalidate(prefix) {
      assertKey(prefix);
      let removed = 0;
      for (const [key, entry] of entries) {
        if (!key.startsWith(prefix)) continue;
        remove(key, entry);
        removed++;
      }
      counts.invalidations += removed;
      return removed;
    },
    clear() {
      const removed = entries.size;
      entries.clear();
      estimatedSizeBytes = 0;
      counts.invalidations += removed;
      return removed;
    },
    stats() {
      const { hits, misses } = counts;
      return {
        ...counts,
        hitRate: hits + misses ? hits / (hits + misses) : 0,
        entries: entries.size,
        estimatedSizeBytes,
        maxEntries,
        maxSizeBytes,
      };
    },
    resetStats() {
      counts = counters();
    },
  };
}

export const memoryCache = createMemoryCache();
