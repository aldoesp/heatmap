import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApiCache } from '../src/lib/apiCache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const unexpectedLoader = async (): Promise<never> => assert.fail('Loader déjà partagé ou valeur en cache');

describe('stockage du cache API', () => {
  it('distingue les hits des misses et conserve les valeurs JSON falsy', async () => {
    const cache = createApiCache();
    assert.equal(cache.get('absent'), undefined);
    assert.equal(cache.has('absent'), false);
    for (const [key, value] of Object.entries({ null: null, false: false, zero: 0, empty: [] })) {
      assert.equal(cache.set(key, value), true);
      assert.equal(cache.has(key), true);
      assert.equal(cache.get(key), value);
      assert.equal((await cache.getOrFetch(key, unexpectedLoader)).value, value);
    }
    assert.equal(cache.stats().hits, 8);
    assert.equal(cache.stats().misses, 1);
  });

  it('applique le TTL à partir de l’admission, sans le prolonger à la lecture', async () => {
    let time = 0;
    const cache = createApiCache({ now: () => time });
    const pending = deferred<string>();
    const request = cache.getOrFetch('a', () => pending.promise, { ttlMs: 5 });
    time = 20;
    pending.resolve('a');
    await request;
    cache.set('b', 'b');
    time = 24;
    assert.equal(cache.get('a'), 'a');
    time = 25;
    assert.equal(cache.has('a'), false);
    time = 15_019;
    assert.equal(cache.get('b'), 'b');
    time = 15_020;
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.stats().expirations, 2);
  });

  it('évince la clé la moins récente et purge les expirations avant éviction', () => {
    let time = 0;
    const cache = createApiCache({ maxEntries: 2, now: () => time });
    cache.set('a', 'a', 2);
    cache.set('b', 'b');
    cache.get('a');
    time = 2;
    cache.set('c', 'c');
    assert.equal(cache.stats().expirations, 1);
    assert.equal(cache.stats().evictions, 0);
    cache.has('b');
    cache.set('d', 'd');
    assert.equal(cache.has('b'), true);
    assert.equal(cache.has('c'), false);
    assert.equal(cache.stats().evictions, 1);
  });

  it('respecte le budget UTF-8 total et ajuste la taille lors du remplacement', () => {
    const cache = createApiCache({ maxSizeBytes: 9 });
    cache.set('a', 'é'); // 1 octet de clé + 4 octets de JSON
    cache.set('b', []);
    assert.equal(cache.stats().estimatedSizeBytes, 8);
    cache.set('c', []);
    assert.equal(cache.has('a'), false);
    assert.equal(cache.stats().estimatedSizeBytes, 6);
    cache.set('c', 0);
    assert.equal(cache.stats().estimatedSizeBytes, 5);
    assert.equal(cache.stats().evictions, 1);
  });

  it('rejette les entrées inadmissibles et livre tout de même les résultats valides du loader', async () => {
    const cache = createApiCache({ maxEntrySizeBytes: 6, maxSizeBytes: 8 });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    assert.equal(cache.set('a', false), true);
    assert.equal(cache.set('a', 'énorme'), false);
    assert.equal(cache.set('b', cycle), false);
    assert.equal(cache.set('b', undefined), false);
    assert.equal(cache.set('b', 0, 0), false);
    const result = await cache.getOrFetch('a', async () => 'énorme');
    assert.equal(result.value, 'énorme');
    assert.equal(result.isCurrent(), true);
    assert.equal(cache.stats().rejectedEntries, 5);
    assert.equal(cache.stats().entries, 0);
    assert.equal(cache.invalidate('a'), 0);
    assert.equal(result.isCurrent(), false);

    const small = createApiCache({ maxSizeBytes: 1 });
    assert.equal(small.set('a', 0), false);
    assert.equal(small.stats().estimatedSizeBytes, 0);
  });

  it('mesure la taille à l’admission et réutilise cette mesure à la lecture', async () => {
    const cache = createApiCache();
    let serializations = 0;
    const value = { toJSON: () => { serializations++; return [1, 2]; } };
    await cache.getOrFetch('a', async () => value);
    cache.get('a');
    cache.has('a');
    await cache.getOrFetch('a', unexpectedLoader);
    assert.equal(cache.stats().estimatedSizeBytes, 6);
    assert.equal(serializations, 1);
  });
});

describe('requêtes partagées du cache API', () => {
  it('partage la promesse et exécute un seul loader pour trois appels simultanés', async () => {
    const cache = createApiCache();
    const pending = deferred<number>();
    let calls = 0;
    const a = cache.getOrFetch('a', () => { calls++; return pending.promise; });
    const b = cache.getOrFetch('a', unexpectedLoader);
    const c = cache.getOrFetch('a', unexpectedLoader);
    assert.equal(a, b);
    assert.equal(b, c);
    assert.equal(cache.stats().inFlightRequests, 1);
    pending.resolve(42);
    const results = await Promise.all([a, b, c]);
    assert.equal(calls, 1);
    assert.deepEqual(results.map(result => [result.value, result.isCurrent()]), [[42, true], [42, true], [42, true]]);
    assert.equal(cache.stats().inFlightRequests, 0);
    assert.equal(cache.stats().hits, 0);
    assert.equal(cache.stats().misses, 3);
    assert.equal(cache.stats().coalescedRequests, 2);
  });

  it('propage le rejet partagé, nettoie la requête et permet une nouvelle tentative', async () => {
    const cache = createApiCache();
    const pending = deferred<string>();
    const a = cache.getOrFetch('a', () => pending.promise);
    const b = cache.getOrFetch('a', unexpectedLoader);
    const failure = new Error('Échec réseau');
    pending.reject(failure);
    await Promise.all([assert.rejects(a, error => error === failure), assert.rejects(b, error => error === failure)]);
    assert.equal(cache.has('a'), false);
    assert.equal(cache.stats().inFlightRequests, 0);
    assert.equal((await cache.getOrFetch('a', async () => 'ok')).value, 'ok');
    assert.equal(cache.get('a'), 'ok');
  });

  it('annule seulement l’attente du consommateur et ignore un signal déjà annulé', async () => {
    const cache = createApiCache();
    const pending = deferred<string>();
    const controller = new AbortController();
    const liveController = new AbortController();
    const a = cache.getOrFetch('a', () => pending.promise, { signal: controller.signal });
    const b = cache.getOrFetch('a', unexpectedLoader, { signal: liveController.signal });
    controller.abort();
    await assert.rejects(a, { name: 'AbortError' });
    await assert.rejects(cache.getOrFetch('b', unexpectedLoader, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(cache.stats().misses, 2);
    assert.equal(cache.stats().inFlightRequests, 1);
    pending.resolve('ok');
    assert.equal((await b).value, 'ok');
    assert.equal(cache.get('a'), 'ok');
  });

  it('borne les loaders actifs, même détachés, et libère leur capacité à la fin', async () => {
    const cache = createApiCache({ maxInFlightRequests: 1 });
    const pending = deferred<string>();
    const a = cache.getOrFetch('a', () => pending.promise);
    assert.equal(cache.getOrFetch('a', unexpectedLoader), a);
    cache.clear();
    await assert.rejects(cache.getOrFetch('a', unexpectedLoader), /Limite de requêtes/);
    await assert.rejects(cache.getOrFetch('b', unexpectedLoader), /Limite de requêtes/);
    assert.equal(cache.stats().inFlightRequests, 1);
    pending.resolve('ancien');
    assert.equal((await a).isCurrent(), false);
    assert.equal((await cache.getOrFetch('b', async () => 'ok')).value, 'ok');
  });
});

describe('invalidation du cache API', () => {
  it('ignore A quand elle se résout après B, lancée après invalidation', async () => {
    const cache = createApiCache();
    const old = deferred<string>();
    const a = cache.getOrFetch('a', () => old.promise);
    await Promise.resolve();
    assert.equal(cache.invalidate('a'), 1);
    const b = await cache.getOrFetch('a', async () => 'nouveau');
    old.resolve('ancien');
    assert.equal((await a).isCurrent(), false);
    assert.equal(b.isCurrent(), true);
    assert.equal(cache.get('a'), 'nouveau');
    assert.equal(cache.stats().staleResultsDiscarded, 1);
  });

  it('conserve la promesse de B quand A se termine pendant B', async () => {
    const cache = createApiCache();
    const old = deferred<string>();
    const next = deferred<string>();
    const a = cache.getOrFetch('a', () => old.promise);
    assert.equal(cache.delete('a'), true);
    const b = cache.getOrFetch('a', () => next.promise);
    old.reject(new Error('Ancien échec'));
    await assert.rejects(a, /Ancien échec/);
    assert.equal(cache.stats().inFlightRequests, 1);
    assert.equal(cache.getOrFetch('a', unexpectedLoader), b);
    next.resolve('nouveau');
    assert.equal((await b).value, 'nouveau');
    assert.equal(cache.stats().inFlightRequests, 0);
  });

  it('actualise une entrée existante et remplace une requête ordinaire par une requête forcée partagée', async () => {
    const cache = createApiCache();
    cache.set('a', 'cache');
    const hit = await cache.getOrFetch('a', unexpectedLoader);
    const updated = await cache.getOrFetch('a', async () => 'actualisé', { forceRefresh: true });
    assert.equal(updated.value, 'actualisé');
    assert.equal(hit.isCurrent(), false);

    const old = deferred<string>();
    const next = deferred<string>();
    const a = cache.getOrFetch('b', () => old.promise);
    const b = cache.getOrFetch('b', () => next.promise, { forceRefresh: true });
    assert.equal(cache.getOrFetch('b', unexpectedLoader, { forceRefresh: true }), b);
    assert.equal(cache.getOrFetch('b', unexpectedLoader), b);
    old.resolve('ancien');
    assert.equal((await a).isCurrent(), false);
    assert.equal(cache.getOrFetch('b', unexpectedLoader), b);
    next.resolve('nouveau');
    assert.equal((await b).value, 'nouveau');
  });

  it('invalide tout un groupe sans confondre les clés d’un périmètre voisin', async () => {
    const cache = createApiCache();
    const pending = deferred<string>();
    const a = await cache.getOrFetch('heatmap:plan:1:rssi', async () => 'rssi');
    const b = cache.getOrFetch('heatmap:plan:1:speed', () => pending.promise);
    const c = await cache.getOrFetch('heatmap:plan:10:rssi', async () => 'autre');
    const group = { prefix: 'heatmap:plan:1:' };
    assert.equal(cache.invalidate(group), 2);
    group.prefix = 'heatmap:plan:10:';
    assert.equal(a.isCurrent(), false);
    assert.equal(c.isCurrent(), true);
    assert.equal(cache.has('heatmap:plan:1:rssi'), false);
    assert.equal(cache.has('heatmap:plan:10:rssi'), true);
    assert.equal(cache.invalidate('heatmap:plan:1'), 0);
    pending.resolve('débit');
    assert.equal((await b).isCurrent(), false);
  });

  it('vide les entrées, détache les loaders et invalide même un hit en attente de consommation', async () => {
    const cache = createApiCache();
    cache.set('a', 'a');
    const hit = cache.getOrFetch('a', unexpectedLoader);
    const pending = deferred<string>();
    const a = cache.getOrFetch('b', () => pending.promise);
    assert.equal(cache.clear(), 2);
    assert.equal(cache.stats().estimatedSizeBytes, 0);
    const b = await cache.getOrFetch('b', async () => 'nouveau');
    pending.resolve('ancien');
    assert.equal((await hit).isCurrent(), false);
    assert.equal((await a).isCurrent(), false);
    assert.equal(b.isCurrent(), true);
  });

  it('protège un set explicite contre un loader déjà démarré', async () => {
    const cache = createApiCache();
    const pending = deferred<string>();
    const a = cache.getOrFetch('a', () => pending.promise);
    cache.set('a', 'nouveau');
    pending.resolve('ancien');
    assert.equal((await a).isCurrent(), false);
    assert.equal(cache.get('a'), 'nouveau');
  });

  it('borne le journal de validité sans écarter un loader encore courant', async () => {
    const cache = createApiCache();
    const olderResult = await cache.getOrFetch('a', async () => 'a');
    const pending = deferred<string>();
    const request = cache.getOrFetch('b', () => pending.promise);
    for (let index = 0; index < 129; index++) cache.invalidate(`unrelated:${index}`);
    assert.equal(olderResult.isCurrent(), false);
    pending.resolve('b');
    assert.equal((await request).isCurrent(), true);
    assert.equal(cache.get('b'), 'b');
  });

  it('isole le contenu, les requêtes et les invalidations entre instances', async () => {
    const a = createApiCache();
    const b = createApiCache();
    const [left, right] = await Promise.all([
      a.getOrFetch('a', async () => 'gauche'),
      b.getOrFetch('a', async () => 'droite'),
    ]);
    a.clear();
    assert.equal(left.isCurrent(), false);
    assert.equal(right.isCurrent(), true);
    assert.equal(b.get('a'), 'droite');
    assert.equal(b.stats().invalidations, 0);
  });
});

it('calcule les statistiques et réinitialise seulement les compteurs cumulés', async () => {
  let time = 0;
  const cache = createApiCache({ maxEntries: 2, maxEntrySizeBytes: 5, now: () => time });
  cache.set('e', 0, 1);
  time = 1;
  cache.get('e');
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  cache.set('d', 'grand');
  cache.delete('c');
  const pending = deferred<number>();
  const request = cache.getOrFetch('k', () => pending.promise);
  assert.equal(cache.getOrFetch('k', unexpectedLoader), request);
  cache.invalidate('k');
  pending.resolve(4);
  await request;
  const active = cache.getOrFetch('k', async () => 5);

  assert.deepEqual(cache.stats(), {
    hits: 1, misses: 4, hitRate: 0.2, coalescedRequests: 1, evictions: 1,
    expirations: 1, invalidations: 2, rejectedEntries: 1, staleResultsDiscarded: 1,
    entries: 1, inFlightRequests: 1, estimatedSizeBytes: 2,
  });
  cache.resetStats();
  assert.deepEqual(cache.stats(), {
    hits: 0, misses: 0, hitRate: 0, coalescedRequests: 0, evictions: 0,
    expirations: 0, invalidations: 0, rejectedEntries: 0, staleResultsDiscarded: 0,
    entries: 1, inFlightRequests: 1, estimatedSizeBytes: 2,
  });
  await active;
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('k'), 5);
});
