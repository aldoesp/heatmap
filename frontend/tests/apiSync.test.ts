import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiCache } from '../src/lib/apiCache.js';
import { ApiRead, invalidateApiReads, setApiCacheStorage, setApiReadSyncState, watchApiRead, type ApiReadSyncState } from '../src/lib/apiRead.js';
import { createApiSync } from '../src/lib/apiSync.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const revision = (value: number, instanceId = 'server') => Response.json({ instanceId, revision: value });

function setup(integrated = false) {
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  const network = new EventTarget();
  let online = true;
  let now = 0;
  let changeCount = 0;
  const timers = new Map<() => void, number>();
  const states: ApiReadSyncState[] = [];
  const calls: Array<{
    signal: AbortSignal;
    resolve(response: Response): void;
    reject(error: Error): void;
  }> = [];
  const sync = createApiSync({
    fetch(url, init) {
      assert.match(String(url), /\/api\/v1\/revision$/);
      assert.equal(init?.cache, 'no-store');
      const signal = init!.signal!;
      return new Promise((resolve, reject) => {
        calls.push({ signal, resolve, reject });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    document: visibility,
    network,
    isOnline: () => online,
    now: () => now,
    setTimer(callback, delay) {
      timers.set(callback, now + delay);
      return () => { timers.delete(callback); };
    },
    intervalMs: 5_000,
    setState(state) {
      states.push(state);
      if (integrated) setApiReadSyncState(state);
    },
    invalidate() {
      changeCount++;
      if (integrated) invalidateApiReads('all');
    },
  });

  return {
    ...sync, calls, timers, states,
    changes: () => changeCount,
    hidden(hidden: boolean) {
      visibility.hidden = hidden;
      visibility.dispatchEvent(new Event('visibilitychange'));
    },
    online(next: boolean) {
      online = next;
      network.dispatchEvent(new Event(next ? 'online' : 'offline'));
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1] - b[1])[0];
        if (!next || next[1] > end) break;
        const [callback, time] = next;
        timers.delete(callback);
        now = time;
        callback();
        await flush();
      }
      now = end;
    },
    async respond(response: Response) {
      calls.at(-1)!.resolve(response);
      await flush();
    },
  };
}

test('première révision, révision stable, plusieurs changements et redémarrage', async () => {
  const sync = setup();
  const release = sync.acquire();
  await sync.advance(0);
  await sync.respond(revision(2));
  await sync.advance(5_000);
  await sync.respond(revision(2));
  assert.equal(sync.changes(), 0);
  await sync.advance(5_000);
  await sync.respond(revision(5));
  assert.equal(sync.changes(), 1);
  await sync.advance(5_000);
  await sync.respond(revision(5, 'restarted'));
  assert.equal(sync.changes(), 2);
  release();
  assert.equal(sync.timers.size, 0);
});

test('les reçus locaux contigus excluent une relecture, une seule lacune suffit à actualiser', async () => {
  const sync = setup();
  const release = sync.acquire();
  await sync.advance(0);
  await sync.respond(revision(3));
  sync.recordLocalMutation('server:6:6');
  sync.recordLocalMutation('server:4:5');
  await sync.advance(5_000);
  await sync.respond(revision(6));
  assert.equal(sync.changes(), 0);

  sync.recordLocalMutation('server:8:9');
  await sync.advance(5_000);
  await sync.respond(revision(9));
  assert.equal(sync.changes(), 1);

  sync.recordLocalMutation('other:10:10');
  await sync.advance(5_000);
  await sync.respond(revision(10));
  assert.equal(sync.changes(), 2);
  release();
});

test('timeout, backoff progressif, Retry-After et rétablissement en mode dégradé', async () => {
  const sync = setup();
  const release = sync.acquire();
  await sync.advance(0);
  await sync.respond(revision(2));
  await sync.advance(5_000);
  await sync.advance(2_999);
  assert.equal(sync.calls[1].signal.aborted, false);
  await sync.advance(1);
  assert.equal(sync.calls[1].signal.aborted, true);
  assert.equal(sync.states.at(-1), 'unavailable');
  assert.equal(sync.changes(), 1);

  await sync.advance(4_999);
  assert.equal(sync.calls.length, 2);
  await sync.advance(1);
  sync.calls[2].reject(new Error('réseau'));
  await flush();
  await sync.advance(9_999);
  assert.equal(sync.calls.length, 3);
  await sync.advance(1);
  await sync.respond(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }));
  sync.online(true);
  await sync.advance(29_999);
  assert.equal(sync.calls.length, 4);
  await sync.advance(1);
  await sync.respond(revision(2));
  assert.equal(sync.states.at(-1), 'trusted');
  assert.equal(sync.changes(), 2);
  await sync.advance(5_000);
  assert.equal(sync.calls.length, 6);
  release();
});

test('visibilité, reconnexion, arrêt et remontage sans polling concurrent', async () => {
  const sync = setup();
  const first = sync.acquire();
  const second = sync.acquire();
  await sync.advance(0);
  sync.online(true);
  await sync.advance(200);
  assert.equal(sync.calls.length, 1);
  sync.hidden(true);
  sync.hidden(false);
  await flush();
  await sync.advance(0);
  assert.equal(sync.calls.length, 2);
  assert.equal(sync.calls[0].signal.aborted, true);
  await sync.respond(revision(0));

  sync.hidden(true);
  await sync.advance(60_000);
  assert.equal(sync.calls.length, 2);
  sync.hidden(false);
  await sync.advance(0);
  assert.equal(sync.calls.length, 3);

  sync.online(false);
  await sync.advance(60_000);
  assert.equal(sync.calls.length, 3);
  sync.online(true);
  await sync.advance(0);
  assert.equal(sync.calls.length, 4);

  first();
  first();
  assert.equal(sync.calls[3].signal.aborted, false);
  second();
  assert.equal(sync.calls[3].signal.aborted, true);
  assert.equal(sync.timers.size, 0);
  sync.online(true);
  sync.hidden(false);
  await sync.advance(60_000);
  assert.equal(sync.calls.length, 4);

  const third = sync.acquire();
  await sync.advance(0);
  await sync.respond(revision(1));
  assert.equal(sync.calls.length, 5);
  third();
  assert.equal(sync.timers.size, 0);
});

test('un remontage pendant Retry-After laisse les lectures en mode dégradé', async () => {
  const sync = setup();
  const first = sync.acquire();
  await sync.advance(0);
  await sync.respond(new Response(null, { status: 429, headers: { 'Retry-After': '25' } }));
  first();
  const second = sync.acquire();
  assert.equal(sync.states.at(-1), 'unavailable');
  await sync.advance(24_999);
  assert.equal(sync.calls.length, 1);
  await sync.advance(1);
  await sync.respond(revision(1));
  assert.equal(sync.states.at(-1), 'trusted');
  second();
});

test('la première vérification précède le stockage et le mode dégradé conserve la déduplication', async t => {
  setApiCacheStorage(true);
  const sync = setup(true);
  const release = sync.acquire();
  t.after(() => { release(); setApiCacheStorage(false); });
  let loads = 0;
  const read = () => new ApiRead().fetch('state', async () => ++loads, 15_000);
  const first = read();
  await sync.advance(0);
  assert.equal(loads, 0);
  await sync.respond(revision(0));
  assert.equal(await first, 1);
  assert.equal(await read(), 1);

  await sync.advance(5_000);
  await sync.respond(Response.json({ revision: 'invalid' }));
  assert.equal(apiCache.stats().entries, 0);
  assert.deepEqual(await Promise.all([read(), read()]), [2, 2]);
  assert.equal(await read(), 3);
  assert.equal(apiCache.stats().entries, 0);

  await sync.advance(5_000);
  await sync.respond(revision(0));
  assert.equal(await read(), 4);
  assert.equal(await read(), 4);
});

test('un GET retardé ne publie pas après une invalidation distante', async t => {
  setApiCacheStorage(true);
  const sync = setup(true);
  const release = sync.acquire();
  t.after(() => { release(); setApiCacheStorage(false); });
  await sync.advance(0);
  await sync.respond(revision(0));
  const published: string[] = [];
  let resolveOld!: (value: string) => void;
  let loads = 0;
  const old = new Promise<string>(resolve => { resolveOld = resolve; });
  const watcher = watchApiRead(
    read => read.fetch('remote', () => ++loads === 1 ? old : Promise.resolve('fresh'), 15_000),
    { success: value => published.push(value) },
  );
  t.after(watcher.dispose);
  await flush();
  await sync.advance(5_000);
  await sync.respond(revision(3));
  assert.deepEqual(published, ['fresh']);
  resolveOld('obsolete');
  await flush();
  assert.deepEqual(published, ['fresh']);
  assert.equal(loads, 2);
  assert.equal(apiCache.get('remote'), 'fresh');
  watcher.dispose();
});
