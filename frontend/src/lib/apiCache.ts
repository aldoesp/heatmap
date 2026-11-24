export interface ApiCacheOptions {
  maxEntries?: number;
  maxSizeBytes?: number;
  maxEntrySizeBytes?: number;
  defaultTtlMs?: number;
  maxInFlightRequests?: number;
  now?: () => number;
}

export interface ApiCacheFetchOptions {
  ttlMs?: number;
  forceRefresh?: boolean;
  /** Annule uniquement l'attente de cet appelant. Le loader reste partagé. */
  signal?: AbortSignal;
}

export interface ApiCacheResult<T> {
  readonly value: T;
  /** À vérifier au moment d'utiliser value, même après la résolution. */
  isCurrent(): boolean;
}

type KeySelector = string | { prefix: string };

interface Entry {
  value: unknown;
  size: number;
  expiresAt: number;
}

interface Consumer {
  resolve(result: ApiCacheResult<unknown>): void;
  reject(error: unknown): void;
}

interface PendingRequest {
  promise: Promise<ApiCacheResult<unknown>>;
  forced: boolean;
  consumers: Set<Consumer>;
}

const encoder = new TextEncoder();
const MAX_INVALIDATION_RECORDS = 128;

function limit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function newCounters() {
  return {
    hits: 0,
    misses: 0,
    coalescedRequests: 0,
    evictions: 0,
    expirations: 0,
    invalidations: 0,
    rejectedEntries: 0,
    staleResultsDiscarded: 0,
  };
}

function subscribe(request: PendingRequest, signal?: AbortSignal): Promise<ApiCacheResult<unknown>> {
  if (!signal) return request.promise;
  return new Promise((resolve, reject) => {
    function cleanup() {
      request.consumers.delete(consumer);
      signal?.removeEventListener('abort', abort);
    }
    function abort() {
      consumer.reject(signal?.reason);
    }
    const consumer: Consumer = {
      resolve(result) {
        cleanup();
        resolve(result);
      },
      reject(error) {
        cleanup();
        reject(error);
      },
    };
    request.consumers.add(consumer);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Cache de valeurs JSON partagées par référence. Traiter les valeurs en lecture seule.
 * Joindre des segments encodés avec encodeURIComponent séparés par `:`.
 * Utiliser un séparateur final pour les groupes, par exemple `heatmap:plan:1:`.
 * Réserver chaque clé à un seul type de réponse.
 */
export function createApiCache(options: ApiCacheOptions = {}) {
  const maxEntries = limit(options.maxEntries, 100);
  const maxSizeBytes = limit(options.maxSizeBytes, 16 * 1024 * 1024);
  const maxEntrySizeBytes = limit(options.maxEntrySizeBytes, 2 * 1024 * 1024);
  const maxInFlightRequests = limit(options.maxInFlightRequests, 100);
  const defaultTtlMs = options.defaultTtlMs ?? 15_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const requests = new Map<string, PendingRequest>();
  // Protège aussi les résultats déjà livrés, y compris après une éviction.
  const invalidationHistory: Array<{ revision: number; selector: KeySelector }> = [];
  let revision = 0;
  let oldestVerifiableRevision = 0;
  let estimatedSizeBytes = 0;
  let inFlightRequests = 0;
  let counters = newCounters();

  function remove(key: string): boolean {
    const entry = entries.get(key);
    if (!entry) return false;
    estimatedSizeBytes -= entry.size;
    entries.delete(key);
    return true;
  }

  function isLive(key: string, entry: Entry, time: number): boolean {
    if (entry.expiresAt > time) return true;
    remove(key);
    counters.expirations++;
    return false;
  }

  function sweepExpired(time: number) {
    for (const [key, entry] of entries) isLive(key, entry, time);
  }

  function lookup(key: string): Entry | undefined {
    const entry = entries.get(key);
    if (!entry || !isLive(key, entry, now())) return undefined;
    entries.delete(key);
    entries.set(key, entry);
    return entry;
  }

  function measure(key: string, value: unknown, ttlMs: number): number | undefined {
    if (!maxEntries || !Number.isFinite(ttlMs) || ttlMs <= 0) return undefined;
    try {
      const json = JSON.stringify(value);
      if (json === undefined) return undefined;
      // Taille UTF-8 estimée à l'admission. Le tas JS et ses surcoûts varient.
      const size = encoder.encode(json).byteLength + encoder.encode(key).byteLength;
      if (size <= maxEntrySizeBytes && size <= maxSizeBytes) return size;
    } catch {
      // Une valeur impossible à sérialiser peut rester utilisable par l'appelant.
    }
  }

  function admit(key: string, value: unknown, ttlMs: number, size: number | undefined): boolean {
    if (size === undefined) {
      counters.rejectedEntries++;
      return false;
    }
    const time = now();
    sweepExpired(time);
    for (const oldest of entries.keys()) {
      if (entries.size < maxEntries && estimatedSizeBytes + size <= maxSizeBytes) break;
      remove(oldest);
      counters.evictions++;
    }
    entries.set(key, { value, size, expiresAt: time + ttlMs });
    estimatedSizeBytes += size;
    return true;
  }

  function matches(key: string, selector: KeySelector): boolean {
    return typeof selector === 'string' ? key === selector : key.startsWith(selector.prefix);
  }

  function recordInvalidation(selector: KeySelector) {
    invalidationHistory.push({ revision: ++revision, selector });
    if (invalidationHistory.length > MAX_INVALIDATION_RECORDS) {
      oldestVerifiableRevision = invalidationHistory.shift()!.revision;
    }
  }

  function resultFor(key: string, value: unknown, discarded = false): ApiCacheResult<unknown> {
    const resultRevision = revision;
    return {
      value,
      isCurrent: () => !discarded && resultRevision >= oldestVerifiableRevision
        && !invalidationHistory.some(record => record.revision > resultRevision && matches(key, record.selector)),
    };
  }

  function detach(key: string): boolean {
    const removed = remove(key);
    return requests.delete(key) || removed;
  }

  function invalidate(selector: KeySelector): number {
    if (typeof selector !== 'string' && selector.prefix === '') return clear();
    // Capturer le préfixe pour que le journal ne dépende pas d'une mutation appelante.
    recordInvalidation(typeof selector === 'string' ? selector : { prefix: selector.prefix });
    let count = 0;
    if (typeof selector === 'string') {
      count = Number(detach(selector));
    } else {
      for (const key of new Set([...entries.keys(), ...requests.keys()])) {
        if (matches(key, selector) && detach(key)) count++;
      }
    }
    counters.invalidations += count;
    return count;
  }

  function clear(): number {
    const count = new Set([...entries.keys(), ...requests.keys()]).size;
    entries.clear();
    requests.clear();
    estimatedSizeBytes = 0;
    invalidationHistory.length = 0;
    oldestVerifiableRevision = ++revision;
    counters.invalidations += count;
    return count;
  }

  function start(key: string, loader: () => Promise<unknown>, ttlMs: number, forced: boolean): PendingRequest {
    async function run(): Promise<ApiCacheResult<unknown>> {
      try {
        const value = await Promise.resolve().then(loader);
        const size = requests.get(key) === request ? measure(key, value, ttlMs) : undefined;
        if (requests.get(key) !== request) {
          counters.staleResultsDiscarded++;
          return resultFor(key, value, true);
        }
        admit(key, value, ttlMs, size);
        return resultFor(key, value);
      } finally {
        inFlightRequests--;
        if (requests.get(key) === request) requests.delete(key);
      }
    }

    inFlightRequests++;
    const request: PendingRequest = { forced, consumers: new Set(), promise: run() };
    requests.set(key, request);
    void request.promise.then(
      result => { for (const consumer of request.consumers) consumer.resolve(result); },
      error => { for (const consumer of request.consumers) consumer.reject(error); },
    );
    return request;
  }

  return {
    get<T>(key: string): T | undefined {
      const entry = lookup(key);
      if (entry) counters.hits++;
      else counters.misses++;
      return entry?.value as T | undefined;
    },
    has(key: string): boolean {
      return lookup(key) !== undefined;
    },
    set<T>(key: string, value: T, ttlMs = defaultTtlMs): boolean {
      const size = measure(key, value, ttlMs);
      recordInvalidation(key);
      detach(key);
      return admit(key, value, ttlMs, size);
    },
    getOrFetch<T>(key: string, loader: () => Promise<T>, fetchOptions: ApiCacheFetchOptions = {}): Promise<ApiCacheResult<T>> {
      const { ttlMs = defaultTtlMs, forceRefresh = false, signal } = fetchOptions;
      if (signal?.aborted) return Promise.reject(signal.reason);

      const entry = forceRefresh ? undefined : lookup(key);
      if (entry) {
        counters.hits++;
        return Promise.resolve(resultFor(key, entry.value) as ApiCacheResult<T>);
      }
      counters.misses++;
      const request = requests.get(key);
      if (request && (!forceRefresh || request.forced)) {
        counters.coalescedRequests++;
        return subscribe(request, signal) as Promise<ApiCacheResult<T>>;
      }
      if (inFlightRequests >= maxInFlightRequests) {
        return Promise.reject(new Error('Limite de requêtes API en cours atteinte.'));
      }
      if (forceRefresh) invalidate(key);
      return subscribe(start(key, loader, ttlMs, forceRefresh), signal) as Promise<ApiCacheResult<T>>;
    },
    delete(key: string): boolean {
      return invalidate(key) !== 0;
    },
    invalidate,
    clear,
    stats() {
      sweepExpired(now());
      const { hits, misses } = counters;
      return {
        ...counters,
        hitRate: hits + misses ? hits / (hits + misses) : 0,
        entries: entries.size,
        inFlightRequests,
        estimatedSizeBytes,
      };
    },
    resetStats() {
      counters = newCounters();
    },
  };
}

export const apiCache = createApiCache();
