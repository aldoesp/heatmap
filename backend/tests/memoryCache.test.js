import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { createMemoryCache } from '../src/cache/memoryCache.js';

function setup(options) {
  let time = 10_000;
  const cache = createMemoryCache({ now: () => time, ...options });
  return { cache, advance: (ms) => { time += ms; } };
}

test('lit par référence et distingue une absence des valeurs falsy', () => {
  const { cache } = setup();
  assert.equal(cache.get('missing'), undefined);
  for (const [key, value] of Object.entries({ nil: null, off: false, zero: 0, empty: [] })) {
    assert.equal(cache.set(key, value), true);
    assert.equal(cache.get(key), value);
    assert.equal(cache.has(key), true);
  }
  assert.equal(cache.stats().hits, 4);
  assert.equal(cache.stats().misses, 1);
});

test('getOrSet appelle le loader uniquement sur un miss et propage ses erreurs', () => {
  const { cache } = setup();
  let calls = 0;
  const load = () => { calls++; return null; };
  assert.equal(cache.getOrSet('key', 500, load), null);
  assert.equal(cache.getOrSet('key', 500, load), null);
  assert.equal(calls, 1);
  const failure = new Error('Échec du chargement');
  assert.throws(() => cache.getOrSet('failure', 500, () => { throw failure; }), error => error === failure);
  assert.equal(cache.has('failure'), false);
  assert.equal(cache.getOrSet('failure', 500, () => 0), 0);
  assert.equal(cache.stats().misses, 3);
  assert.equal(cache.stats().rejectedEntries, 0);
});

test('expire à la limite exacte, avec le TTL par défaut ou après remplacement', () => {
  const { cache, advance } = setup({ defaultTtlMs: 5 });
  cache.set('default', 1);
  cache.set('override', 2, 10);
  advance(4);
  assert.equal(cache.get('default'), 1);
  cache.set('override', 3, 10);
  advance(1);
  assert.equal(cache.get('default'), undefined);
  assert.equal(cache.has('override'), true);
  advance(9);
  assert.equal(cache.has('override'), false);
  assert.equal(cache.stats().expirations, 2);
  assert.equal(cache.stats().estimatedSizeBytes, 0);
});

test('rejette undefined et les TTL non positifs ou invalides, même en remplacement', () => {
  const { cache } = setup();
  for (const ttl of [0, -1, NaN, Infinity, null, '10', Symbol('TTL')]) {
    assert.equal(cache.set('key', 1), true);
    assert.equal(cache.set('key', 2, ttl), false);
    assert.equal(cache.has('key'), false);
  }
  assert.equal(cache.getOrSet('undefined', 10, () => undefined), undefined);
  assert.equal(cache.has('undefined'), false);
  assert.equal(cache.stats().rejectedEntries, 8);
  assert.equal(cache.stats().estimatedSizeBytes, 0);
});

test('respecte le nombre maximal et promeut sur get et has', () => {
  const { cache } = setup({ maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('a'), true);
  cache.set('d', 4);
  assert.equal(cache.has('c'), false);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.stats().evictions, 2);
  assert.equal(cache.stats().entries, 2);
});

test('nettoie les expirations avant les évictions, même hors de la tête LRU', () => {
  const { cache, advance } = setup({ maxEntries: 2 });
  cache.set('live', 1, 100);
  cache.set('expired', 2, 1);
  advance(1);
  cache.set('new', 3, 100);
  assert.equal(cache.has('live'), true);
  assert.equal(cache.stats().expirations, 1);
  assert.equal(cache.stats().evictions, 0);
  assert.equal(cache.stats().entries, 2);
});

test('la limite mémoire impose une éviction même sous la limite d’entrées', () => {
  const { cache } = setup({ maxEntries: 100, maxSizeBytes: 410 });
  const value = Buffer.alloc(64);
  cache.set('a', value);
  const bytes = cache.stats().estimatedSizeBytes;
  assert.ok(bytes >= value.length);
  cache.set('b', value);
  cache.get('a');
  cache.set('c', value);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.stats().estimatedSizeBytes, bytes * 2);
  assert.equal(cache.stats().evictions, 1);
});

test('un loader renvoie une valeur trop volumineuse sans évincer les autres entrées', () => {
  const { cache } = setup({ maxSizeBytes: 1000, maxEntrySizeBytes: 200 });
  const oversized = Buffer.alloc(201);
  cache.set('other', 'ok');
  assert.equal(cache.getOrSet('large', 100, () => oversized), oversized);
  assert.equal(cache.has('large'), false);
  assert.equal(cache.get('other'), 'ok');
  assert.equal(cache.stats().rejectedEntries, 1);
  assert.equal(cache.stats().evictions, 0);
  assert.equal(createMemoryCache({ maxSizeBytes: 200 }).set('large', oversized), false);
});

test('le remplacement et les suppressions mettent à jour la taille', () => {
  const { cache } = setup();
  const reference = createMemoryCache();
  cache.set('entry', Buffer.alloc(1024));
  cache.set('entry', 'replacement');
  reference.set('entry', 'replacement');
  assert.equal(cache.get('entry'), 'replacement');
  assert.equal(cache.stats().entries, 1);
  assert.equal(cache.stats().estimatedSizeBytes, reference.stats().estimatedSizeBytes);
  assert.equal(cache.delete('entry'), true);
  assert.equal(cache.delete('entry'), false);
  assert.equal(cache.stats().estimatedSizeBytes, 0);

  for (const id of ['1', '10', '1:2']) cache.set(`plan:${encodeURIComponent(id)}:rows`, id);
  const before = cache.stats().estimatedSizeBytes;
  assert.equal(cache.invalidate('plan:1:'), 1);
  assert.equal(cache.has('plan:1:rows'), false);
  assert.equal(cache.has('plan:10:rows'), true);
  assert.equal(cache.has('plan:1%3A2:rows'), true);
  assert.ok(cache.stats().estimatedSizeBytes < before);
  assert.equal(cache.stats().invalidations, 1);
});

test('les instances sont indépendantes et clear libère la taille comptabilisée', () => {
  const { cache } = setup();
  const { cache: other } = setup();
  cache.set('key', 1);
  other.set('key', 2);
  assert.equal(cache.clear(), 1);
  assert.equal(cache.clear(), 0);
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().estimatedSizeBytes, 0);
  assert.equal(other.get('key'), 2);
});

test('resetStats remet les compteurs à zéro sans vider le cache', () => {
  const { cache, advance } = setup({ maxEntries: 1, maxSizeBytes: 512 });
  cache.set('first', 0, 10);
  cache.set('expires', 0, 1);
  const bytes = cache.stats().estimatedSizeBytes;
  cache.has('expires');
  cache.get('expires');
  cache.get('missing');
  advance(1);
  cache.delete('expires');
  cache.set('invalid', undefined);
  cache.set('clear', 1);
  cache.clear();
  cache.set('remains', 0);
  assert.deepEqual(cache.stats(), {
    hits: 1, misses: 1, hitRate: .5, evictions: 1, expirations: 1,
    invalidations: 1, rejectedEntries: 1, entries: 1, estimatedSizeBytes: bytes,
    maxEntries: 1, maxSizeBytes: 512,
  });
  cache.resetStats();
  assert.deepEqual(cache.stats(), {
    hits: 0, misses: 0, hitRate: 0, evictions: 0, expirations: 0,
    invalidations: 0, rejectedEntries: 0, entries: 1, estimatedSizeBytes: bytes,
    maxEntries: 1, maxSizeBytes: 512,
  });
});

test('estime les objets cycliques et les buffers partagés sans invoquer les accesseurs', () => {
  const { cache } = setup({ maxEntrySizeBytes: 1500 });
  const value = { data: Buffer.alloc(512), elements: [false, 'data', 5n] };
  value.self = value;
  value.slice = value.data.subarray(1);
  assert.equal(cache.set('item', value), true);
  assert.equal(cache.get('item'), value);
  let reads = 0;
  assert.equal(cache.set('getter', { get value() { reads++; return 'data'; } }), false);
  assert.equal(reads, 0);
});
