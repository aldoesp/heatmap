import { API_BASE, invalidateApiReads, setApiReadSyncState, type ApiReadSyncState } from './apiRead.js';

const DEFAULT_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 3_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_LOCAL_RECEIPTS = 128;
const REVISION_HEADER = 'X-Heatmap-Revision';

interface Revision {
  instanceId: string;
  revision: number;
}

interface SyncOptions {
  fetch: typeof fetch;
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  network: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  isOnline: () => boolean;
  now: () => number;
  setTimer: (callback: () => void, delay: number) => () => void;
  intervalMs: number;
  setState: (state: ApiReadSyncState) => void;
  invalidate: () => void;
}

function isRevision(value: unknown): value is Revision {
  if (typeof value !== 'object' || value === null) return false;
  const { instanceId, revision } = value as Partial<Revision>;
  return typeof instanceId === 'string' && instanceId.length > 0
    && typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;
}

export function createApiSync(options: SyncOptions) {
  let users = 0;
  let baseline: Revision | undefined;
  let trusted = false;
  let degraded = false;
  let failures = 0;
  let retryAt = 0;
  let cancelPoll: (() => void) | undefined;
  let active: { controller: AbortController; cancelTimeout: () => void } | undefined;
  let wakeAfterAbort = false;
  let receipts: Array<{ first: number; last: number }> = [];

  const canPoll = () => users > 0 && !options.document.hidden && options.isOnline();
  const invalidate = options.invalidate;

  function suspendStorage() {
    if (degraded) return;
    degraded = true;
    options.setState('unavailable');
    if (trusted) invalidate();
    trusted = false;
  }

  function onlyLocal(previous: Revision, next: Revision) {
    if (next.instanceId !== previous.instanceId || next.revision <= previous.revision) return false;
    let covered = previous.revision;
    for (const { first, last } of receipts) {
      if (first > covered + 1) break;
      covered = Math.max(covered, last);
      if (covered >= next.revision) return true;
    }
    return false;
  }

  function accept(next: Revision) {
    const refresh = degraded || (baseline !== undefined
      && (baseline.instanceId !== next.instanceId || baseline.revision !== next.revision)
      && !onlyLocal(baseline, next));
    receipts = baseline?.instanceId === next.instanceId
      ? receipts.filter(receipt => receipt.last > next.revision)
      : [];
    baseline = next;
    trusted = true;
    degraded = false;
    options.setState('trusted');
    if (refresh) invalidate();
  }

  function schedule(delay: number) {
    cancelPoll?.();
    cancelPoll = undefined;
    if (!canPoll() || active) return;
    cancelPoll = options.setTimer(() => {
      cancelPoll = undefined;
      if (canPoll()) void poll();
    }, Math.max(delay, retryAt - options.now()));
  }

  async function poll() {
    const controller = new AbortController();
    const cancelTimeout = options.setTimer(() => controller.abort(), TIMEOUT_MS);
    active = { controller, cancelTimeout };
    try {
      const response = await options.fetch(`${API_BASE}/api/v1/revision`, {
        cache: 'no-store', signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        const retryAfter = response.status === 429 ? response.headers.get('Retry-After') : null;
        if (retryAfter) {
          retryAt = /^\d+$/.test(retryAfter)
            ? options.now() + Number(retryAfter) * 1_000
            : Date.parse(retryAfter) || 0;
        }
        throw new Error('Révision du serveur indisponible.');
      }
      const next: unknown = await response.json();
      controller.signal.throwIfAborted();
      if (!isRevision(next)) throw new Error('Révision du serveur illisible.');
      failures = 0;
      retryAt = 0;
      accept(next);
    } catch {
      // Une suspension volontaire ne compte pas comme un échec réseau.
      if (canPoll() && !wakeAfterAbort) {
        failures = Math.min(failures + 1, 16);
        suspendStorage();
      }
    } finally {
      cancelTimeout();
      active = undefined;
      const interval = options.intervalMs;
      const delay = failures ? Math.max(interval, Math.min(interval * 2 ** (failures - 1), MAX_BACKOFF_MS)) : interval;
      schedule(wakeAfterAbort ? 0 : delay);
      wakeAfterAbort = false;
    }
  }

  function pause() {
    cancelPoll?.();
    cancelPoll = undefined;
    active?.cancelTimeout();
    active?.controller.abort();
  }

  function wake() {
    if (!canPoll()) {
      pause();
      if (!options.isOnline() || !baseline) suspendStorage();
      return;
    }
    if (active) {
      wakeAfterAbort ||= active.controller.signal.aborted;
      return;
    }
    schedule(0);
  }

  return {
    acquire() {
      if (++users === 1) {
        if (retryAt > options.now()) suspendStorage();
        else options.setState('checking');
        options.document.addEventListener('visibilitychange', wake);
        options.network.addEventListener('online', wake);
        options.network.addEventListener('offline', wake);
        wake();
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--users > 0) return;
        options.document.removeEventListener('visibilitychange', wake);
        options.network.removeEventListener('online', wake);
        options.network.removeEventListener('offline', wake);
        pause();
        suspendStorage();
        baseline = undefined;
        receipts = [];
        degraded = false;
        failures = 0;
      };
    },
    recordLocalMutation(header: string | null) {
      if (!trusted || !baseline || !header) return;
      const [instanceId, start, end] = header.split(':');
      const first = Number(start), last = Number(end);
      if (instanceId !== baseline.instanceId || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)
        || first <= 0 || last < first || last <= baseline.revision) return;
      receipts.push({ first, last });
      receipts.sort((a, b) => a.first - b.first);
      if (receipts.length > MAX_LOCAL_RECEIPTS) receipts.shift();
    },
  };
}

let sync: ReturnType<typeof createApiSync> | undefined;

export function startApiSync() {
  const interval = Number(import.meta.env?.VITE_API_SYNC_INTERVAL_MS);
  sync ??= createApiSync({
    fetch: (...args) => fetch(...args),
    document,
    network: window,
    isOnline: () => navigator.onLine,
    now: Date.now,
    setTimer(callback, delay) {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
    intervalMs: Number.isFinite(interval) && interval >= 1_000 ? interval : DEFAULT_INTERVAL_MS,
    setState: setApiReadSyncState,
    invalidate: () => invalidateApiReads('all'),
  });
  return sync.acquire();
}

export function recordLocalApiMutation(response: Response) {
  sync?.recordLocalMutation(response.headers.get(REVISION_HEADER));
}
