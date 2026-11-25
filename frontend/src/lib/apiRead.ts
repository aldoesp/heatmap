import { apiCache, type ApiCacheFetchOptions } from './apiCache.js';

export const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');
export const READ_TIMEOUT_MS = 30_000;

type Selector = string | { prefix: string };
type ReadOptions = Pick<ApiCacheFetchOptions, 'forceRefresh' | 'signal'>;
type Invalidation = readonly Selector[] | 'all';

export function apiKey(...segments: string[]): string {
  // Une seule base et un seul contexte de cookies same-origin par instance.
  return ['api', API_BASE, ...segments].map(encodeURIComponent).join(':');
}

export function apiGroup(...segments: string[]): { prefix: string } {
  return { prefix: apiKey(...segments) + ':' };
}

let storeResponses = import.meta.env?.VITE_API_CACHE_ENABLED === 'true';
export type ApiReadSyncState = 'checking' | 'trusted' | 'unavailable';
let syncState: ApiReadSyncState = 'unavailable';
let initialSync: Promise<void> | undefined;
let releaseInitialSync: (() => void) | undefined;
const invalidationListeners = new Set<(selectors: Invalidation) => void>();

export function setApiReadSyncState(state: ApiReadSyncState) {
  if (syncState === state) return;
  syncState = state;
  if (state === 'checking') {
    initialSync = new Promise(resolve => { releaseInitialSync = resolve; });
  } else {
    releaseInitialSync?.();
    releaseInitialSync = undefined;
    initialSync = undefined;
  }
}

/** Permet d'activer le stockage explicitement, par exemple dans les tests. */
export function setApiCacheStorage(enabled: boolean) {
  if (storeResponses === enabled) return;
  storeResponses = enabled;
  invalidateApiReads('all');
}

export function invalidateApiReads(selectors: Invalidation) {
  if (selectors === 'all') apiCache.clear();
  else for (const selector of selectors) apiCache.invalidate(selector);
  for (const listener of invalidationListeners) listener(selectors);
}

/** Regroupe les garanties de validité des lectures d'un même chargement. */
export class ApiRead {
  readonly signal?: AbortSignal;
  readonly forceRefresh: boolean;
  private readonly keys = new Set<string>();
  private readonly checks: Array<() => boolean> = [];

  constructor(options: ReadOptions = {}) {
    this.signal = options.signal;
    this.forceRefresh = options.forceRefresh ?? false;
  }

  isCurrent(): boolean {
    return !this.signal?.aborted && this.checks.every(check => check());
  }

  isAffected(selectors: Invalidation): boolean {
    if (selectors === 'all') return this.keys.size > 0;
    for (const key of this.keys) {
      if (selectors.some(selector =>
        typeof selector === 'string' ? key === selector : key.startsWith(selector.prefix)
      )) return true;
    }
    return false;
  }

  async fetch<T>(key: string, loader: (forced: boolean) => Promise<T>, ttlMs: number): Promise<T> {
    while (initialSync) await initialSync;
    this.signal?.throwIfAborted();
    const forceRefresh = this.forceRefresh && !this.keys.has(key);
    this.keys.add(key);
    const pending = apiCache.getOrFetch(key, () => loader(forceRefresh), {
      forceRefresh,
      signal: this.signal,
      ttlMs: storeResponses && syncState === 'trusted' ? ttlMs : 0,
    });
    // getOrFetch a déjà remplacé une éventuelle requête ordinaire lors d'un forceRefresh.
    const errorIsCurrent = apiCache.captureCurrent(key);
    try {
      const result = await pending;
      this.checks.push(result.isCurrent);
      return result.value;
    } catch (error) {
      this.checks.push(errorIsCurrent);
      throw error;
    }
  }
}

export interface ApiReadHandlers<T> {
  start?(): void;
  success(value: T): void;
  error?(error: unknown): void;
  settled?(): void;
}

/** Ne publie que le chargement actif, y compris ses erreurs et ses résultats composés. */
export function watchApiRead<T>(load: (read: ApiRead) => Promise<T>, handlers: ApiReadHandlers<T>) {
  let controller: AbortController | undefined;
  let read: ApiRead | undefined;
  let disposed = false;
  let scheduled = false;
  let force = false;

  function schedule(forceRefresh = false) {
    if (disposed) return;
    controller?.abort();
    force ||= forceRefresh;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      const current = new AbortController();
      controller = current;
      const request = new ApiRead({ signal: current.signal, forceRefresh: force });
      read = request;
      force = false;
      handlers.start?.();

      function publish(callback: () => void) {
        if (controller !== current || current.signal.aborted) return;
        if (!request.isCurrent()) {
          schedule();
          return;
        }
        callback();
        handlers.settled?.();
      }
      void Promise.resolve().then(() => load(request)).then(
        value => publish(() => handlers.success(value)),
        error => publish(() => handlers.error?.(error)),
      );
    });
  }

  const onInvalidated = (selectors: Invalidation) => {
    if (read?.isAffected(selectors)) schedule();
  };
  invalidationListeners.add(onInvalidated);
  schedule();

  return {
    refresh: () => schedule(true),
    dispose() {
      disposed = true;
      controller?.abort();
      invalidationListeners.delete(onInvalidated);
    },
  };
}
