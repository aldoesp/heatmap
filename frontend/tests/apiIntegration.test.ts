import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createBssidRule, deleteBssidRule, deletePlan, deleteScanPoint, exportPlansZip,
  getHeatmap, getHeatmapForExport, getHeatmapGateway, getHeatmapSpeed, getHistory,
  getIperfStatus, getNetworks, getPlan, getScanDetail, getSettings, getStatus,
  importCsvSurvey, importSurveys, listAccessPoints, listBssidRules, listPlans,
  listScanPoints, listSeenBssids, patchSetting, previewSurveyImport, renamePlan,
  saveScanAtPoint, updateBssidRule, updateScanPoint,
} from '../src/lib/api.js';
import { apiCache } from '../src/lib/apiCache.js';
import { ApiRead, READ_TIMEOUT_MS, setApiCacheStorage, setApiReadSyncState, watchApiRead } from '../src/lib/apiRead.js';
import { ApiError } from '../src/types/api.js';

const json = (body: unknown, status = 200) => Response.json(body, { status });
const empty = () => new Response(null, { status: 204 });
const plan = (id = 'a', name = id) => ({
  id, name, imageUrl: '/uploads/plan.png', fileName: 'plan.png',
  width: 100, height: 100, sizeBytes: 123, metersPerPixel: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
});
const history = (id: string) => [{ id, scans: [] }];
const heat = (rssi: number) => [{ rssi }];
const file = new File(['data'], 'releves.csv');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (condition()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.ok(condition(), 'Le chargement attendu n’a pas abouti.');
}

beforeEach(() => {
  setApiReadSyncState('trusted');
  setApiCacheStorage(false);
  apiCache.clear();
});

test('stockage désactivé par défaut et déduplication maintenue pendant un GET', async t => {
  const first = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', () => first.promise);
  const a = listPlans();
  const b = listPlans();
  await until(() => fetch.mock.callCount() === 1);
  first.resolve(json([plan('a')]));
  assert.deepEqual(await a, [plan('a')]);
  assert.deepEqual(await b, [plan('a')]);
  fetch.mock.mockImplementation(async () => json([plan('b')]));
  assert.deepEqual(await listPlans(), [plan('b')]);
  assert.equal(fetch.mock.callCount(), 2);
});

test('navigation A → B → A et ouverture de deux vues concurrentes', async t => {
  let peak = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (input: string) => {
    peak++;
    const segments = input.split('/');
    const id = segments[4];
    return segments[5] === 'access-points' ? json([{ id }]) : json(plan(id));
  });
  async function visit(id: string) {
    const [p, aps] = await Promise.all([getPlan(id), listAccessPoints(id)]);
    assert.equal(p.name, id);
    assert.equal(aps[0].id, id);
  }
  for (const enabled of [false, true]) {
    setApiCacheStorage(enabled);
    const initial = peak;
    await Promise.all([visit('a'), visit('a')]);
    await visit('b');
    await visit('a');
    // 8 GET sans déduplication ni stockage, 6 avec déduplication, 4 avec stockage.
    assert.equal(peak - initial, enabled ? 4 : 6);
  }
  assert.equal(fetch.mock.callCount(), 10);
  setApiCacheStorage(false);
  await visit('a');
  assert.equal(fetch.mock.callCount(), 12);
});

test('clés de heatmap isolées par plan et par filtre, équivalences serveur normalisées', async t => {
  setApiCacheStorage(true);
  const fetch = t.mock.method(globalThis, 'fetch', async (input: string) => json([{ bssid_name: input }]));
  const value = async (...args: Parameters<typeof getHeatmap>) => (await getHeatmap(...args))[0].bssid_name;
  const unfiltered = await value('a:b');
  assert.equal(await value('a:b', { ssid: '', connected: false }), unfiltered);
  assert.notEqual(await value('a%3Ab'), unfiltered);
  const filters = { ssid: 'Réseau: A & B', bssid: 'AA:BB', band: '5' as const, connected: true };
  const filtered = await value('a:b', filters);
  assert.equal(await value('a:b', { ...filters, bssid: 'aa:bb' }), filtered);
  assert.notEqual(await value('a:b', { ...filters, band: '2.4' }), filtered);
  assert.notEqual(await value('a:b', { ...filters, ssid: 'réseau: A & B' }), filtered);
  assert.notEqual(await value('a:b', { ...filters, connected: false }), filtered);
  const url = new URL(filtered, 'https://heatmap.example');
  assert.equal(url.pathname, '/api/v1/plans/a%3Ab/heatmap');
  assert.equal(url.searchParams.get('ssid'), filters.ssid);
  assert.equal(url.searchParams.get('connected'), '1');
  assert.equal(fetch.mock.callCount(), 6);
});

test('un nouveau scan invalide toutes ses mesures et conserve celles d’un autre plan', async t => {
  setApiCacheStorage(true);
  let revision = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      revision++;
      return json({ scan_id: 'new-scan', plan_id: 'a', survey_id: 'survey' }, 201);
    }
    if (path.includes('/history')) return json(history('point-' + revision));
    return json(heat(-80 + revision));
  });
  const readMeasurements = (id: string) => Promise.all([
    getHistory(id), getHeatmap(id), getHeatmap(id, { band: '5' }),
    getNetworks(id), getHeatmapSpeed(id), getHeatmapGateway(id),
  ]);
  const before = await readMeasurements('a');
  assert.deepEqual(await readMeasurements('ab'), before);
  assert.deepEqual(await listSeenBssids(), heat(-80));
  assert.equal((await saveScanAtPoint('point', 'a')).scan_id, 'new-scan');
  const after = await readMeasurements('a');
  assert.deepEqual(after, [history('point-1'), ...Array.from({ length: 5 }, () => heat(-79))]);
  assert.deepEqual(await readMeasurements('ab'), before);
  assert.deepEqual(await listSeenBssids(), heat(-79));
  assert.equal(fetch.mock.callCount(), 21);

  // Un appel sans plan connu invalide les mêmes familles dans tous les plans.
  await saveScanAtPoint('point');
  assert.deepEqual(await getHeatmap('ab'), heat(-78));
  assert.equal(fetch.mock.callCount(), 23);
});

test('les règles BSSID relisent historiques, radios et détails dans tous les plans', async t => {
  setApiCacheStorage(true);
  let alias = 'avant';
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') {
      alias = init.method;
      return init.method === 'DELETE' ? empty() : json({ id: 'rule', name: alias });
    }
    const row = { bssid_name: alias };
    return path.includes('/scan/scans/') ? json({ observations: [row] }) : json([row]);
  });
  const read = async () => {
    const [rules, seen, h, hm, networks, detail] = await Promise.all([
      listBssidRules(), listSeenBssids(), getHistory('a'), getHeatmap('a', { band: '5' }),
      getNetworks('b'), getScanDetail('scan', undefined, { planId: 'b', pointId: 'p' }),
    ]);
    return [rules, seen, h, hm, networks, detail.observations];
  };
  for (const [expected, write] of [
    ['avant', async () => {}],
    ['POST', () => createBssidRule({ bssid: 'aa:bb', name: '', blacklisted: false })],
    ['PATCH', () => updateBssidRule('rule', { blacklisted: true })],
    ['DELETE', () => deleteBssidRule('rule')],
  ] as const) {
    await write();
    assert.deepEqual(await read(), Array.from({ length: 6 }, () => [{ bssid_name: expected }]));
    assert.deepEqual(await getHeatmapSpeed('b'), [{ bssid_name: 'avant' }]);
  }
  assert.equal(fetch.mock.callCount(), 28);
});

test('note, activation, suppression de point et suppression de plan respectent leurs dépendances', async t => {
  setApiCacheStorage(true);
  let revision = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') { revision++; return empty(); }
    if (init?.method === 'PATCH') { revision++; return json({ id: 'p' }); }
    if (path.includes('/scan/scans/')) return json({ id: String(revision), observations: [] });
    if (path === '/api/v1/plans') return json([plan(String(revision))]);
    return json([{ id: String(revision) }]);
  });
  const p = { planId: 'a', pointId: 'p' };
  const otherPoint = { planId: 'a', pointId: 'q' };
  const independent = { planId: 'b', pointId: 'p' };
  const detail = (scope: typeof p) => getScanDetail(scope.pointId + scope.planId, undefined, scope);
  assert.equal((await listPlans())[0].id, '0');
  for (const scope of [p, otherPoint, independent]) assert.equal((await detail(scope)).id, '0');
  assert.equal((await listScanPoints('a'))[0].id, '0');
  assert.equal((await getHeatmap('a'))[0].scan_point_id, undefined);
  await updateScanPoint('a', 'p', { note: 'note' });
  assert.equal((await listScanPoints('a'))[0].id, '1');
  assert.deepEqual(await getHeatmap('a'), [{ id: '0' }]);
  await updateScanPoint('a', 'p', { is_enabled: 0 });
  assert.deepEqual(await getHeatmap('a'), [{ id: '2' }]);
  await deleteScanPoint('a', 'p');
  assert.equal((await detail(p)).id, '3');
  assert.equal((await detail(otherPoint)).id, '0');
  assert.equal((await detail(independent)).id, '0');
  await deletePlan('a');
  assert.equal((await listPlans())[0].id, '4');
  assert.equal((await detail(otherPoint)).id, '4');
  assert.equal((await detail(independent)).id, '0');
  assert.equal(fetch.mock.callCount(), 15);
});

test('prévisualisation, exports et statuts ne sont pas mis en cache', async t => {
  setApiCacheStorage(true);
  let calls = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string) => {
    calls++;
    if (path.endsWith('export.zip?planIds=a')) return new Response(String(calls));
    return path === '/api/v1/plans' ? json([plan()]) : path.includes('/heatmap') ? json(heat(-calls)) : json({});
  });
  await listPlans();
  await previewSurveyImport(file);
  await previewSurveyImport(file);
  assert.deepEqual(await listPlans(), [plan()]);
  assert.equal(await (await exportPlansZip(['a'])).text(), '4');
  assert.equal(await (await exportPlansZip(['a'])).text(), '5');
  await getStatus();
  await getStatus();
  await getIperfStatus();
  await getIperfStatus();
  const signal = new AbortController().signal;
  assert.deepEqual(await getHeatmapForExport('a', {}, signal), heat(-10));
  assert.deepEqual(await getHeatmapForExport('a', {}, signal), heat(-11));
  assert.equal(fetch.mock.callCount(), 11);
});

test('imports ZIP/CSV et import CSV partiel vident toutes les familles', async t => {
  setApiCacheStorage(true);
  let revision = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      revision++;
      return revision === 3 ? json({ message: 'CSV partiel' }, 422) : json({ planId: String(revision) }, 201);
    }
    if (path === '/api/v1/plans') return json([plan(String(revision))]);
    if (path === '/api/v1/settings') return json({ scan_mode: String(revision) });
    return json(history(String(revision)));
  });
  for (const op of [
    async () => {},
    () => importSurveys(file, {}),
    () => importCsvSurvey(file),
    () => assert.rejects(importCsvSurvey(file), { message: 'CSV partiel' }),
  ]) {
    await op();
    const [plans, settings, h] = await Promise.all([listPlans(), getSettings(), getHistory('a')]);
    assert.equal(plans[0].name, String(revision));
    assert.equal(settings.scan_mode, String(revision));
    assert.equal(h[0].id, String(revision));
  }
  assert.equal(fetch.mock.callCount(), 15);
});

test('les écritures ambiguës invalident avant le décodage et ne sont jamais rejouées', async t => {
  setApiCacheStorage(true);
  let revision = 0;
  const brokenBody = deferred<string>();
  const fetch = t.mock.method(globalThis, 'fetch', async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      revision++;
      if (revision === 1) {
        const response = new Response(null, { status: 200 });
        response.json = () => brokenBody.promise.then(JSON.parse);
        return response;
      }
      if (revision === 2) throw new TypeError('Connexion perdue');
      return json({ message: 'Écriture incertaine' }, 502);
    }
    return json(plan('a', String(revision)));
  });
  assert.equal((await getPlan('a')).name, '0');
  const write = renamePlan('a', '1');
  await until(() => revision === 1);
  assert.equal((await getPlan('a')).name, '1');
  brokenBody.resolve('{');
  await assert.rejects(write, { code: 'invalid-json' });
  await assert.rejects(renamePlan('a', '2'), { code: 'network' });
  assert.equal((await getPlan('a')).name, '2');
  await assert.rejects(renamePlan('a', '3'), { status: 502 });
  assert.equal((await getPlan('a')).name, '3');
  assert.equal(fetch.mock.callCount(), 7);
});

test('un GET malformé, non JSON, en erreur HTTP ou réseau reste hors cache', async t => {
  setApiCacheStorage(true);
  const responses = [
    () => { throw new TypeError('Connexion perdue'); },
    () => json({ message: 'Indisponible' }, 503),
    () => new Response('[]', { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => json({}),
    () => json([null]),
    () => json(history('fresh')),
  ];
  let next = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses[next++]());
  for (const code of ['network', undefined, 'invalid-json', 'invalid-json', 'invalid-shape', 'invalid-shape']) {
    await assert.rejects(getHistory('a'), (error: unknown) => error instanceof ApiError && error.code === code);
  }
  assert.deepEqual(await getHistory('a'), history('fresh'));
  assert.deepEqual(await getHistory('a'), history('fresh'));
  assert.equal(fetch.mock.callCount(), 7);
});

test('forceRefresh remplace un GET normal, rejoint le GET forcé et contourne le cache HTTP', async t => {
  setApiCacheStorage(true);
  const ordinary = deferred<Response>();
  const forced = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) =>
    init.cache === 'reload' ? forced.promise : ordinary.promise,
  );
  const oldRead = new ApiRead();
  const old = getPlan('a', oldRead);
  await until(() => fetch.mock.callCount() === 1);
  const first = getPlan('a', new ApiRead({ forceRefresh: true }));
  const joined = getPlan('a', new ApiRead({ forceRefresh: true }));
  await until(() => fetch.mock.callCount() === 2);
  forced.resolve(json(plan('a', 'récent')));
  assert.equal((await first).name, 'récent');
  assert.equal((await joined).name, 'récent');
  ordinary.resolve(json(plan('a', 'ancien')));
  assert.equal((await old).name, 'ancien');
  assert.equal(oldRead.isCurrent(), false);
  assert.equal((await getPlan('a')).name, 'récent');
  assert.equal(fetch.mock.callCount(), 2);
});

test('un consommateur annulé laisse le GET partagé finir avec son propre délai réseau', async t => {
  const shared = deferred<Response>();
  const timeout = new AbortController();
  const deadline = t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  const fetch = t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    init.signal?.addEventListener('abort', () => shared.reject(init.signal?.reason), { once: true });
    return shared.promise;
  });
  const consumer = new AbortController();
  const stopped = getPlan('a', new ApiRead({ signal: consumer.signal }));
  const other = getPlan('a');
  await until(() => fetch.mock.callCount() === 1);
  consumer.abort();
  await assert.rejects(stopped, { name: 'AbortError' });
  assert.equal(timeout.signal.aborted, false);
  assert.equal(deadline.mock.calls[0].arguments[0], READ_TIMEOUT_MS);
  timeout.abort();
  await assert.rejects(other, { code: 'network' });
  fetch.mock.mockImplementation(async () => json(plan()));
  assert.equal((await getPlan('a')).name, 'a');
  assert.equal(fetch.mock.callCount(), 2);
});

test('la publication composée redémarre après mutation et ignore le succès GET obsolète', async t => {
  setApiCacheStorage(true);
  const oldHeat = deferred<Response>();
  let saved = false;
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') { saved = true; return json({ scan_id: 'new' }, 201); }
    if (path.endsWith('/history')) return json(history(saved ? 'new' : 'old'));
    return saved ? json(heat(-40)) : oldHeat.promise;
  });
  const published: unknown[] = [];
  const errors: unknown[] = [];
  const view = watchApiRead(
    read => Promise.all([getHistory('a', read), getHeatmap('a', undefined, read)]),
    { success: value => published.push(value), error: error => errors.push(error) },
  );
  t.after(view.dispose);
  await until(() => fetch.mock.callCount() === 2);
  await saveScanAtPoint('p', 'a');
  await until(() => published.length === 1);
  oldHeat.resolve(json(heat(-70)));
  await until(() => apiCache.stats().inFlightRequests === 0);
  assert.deepEqual(published, [[history('new'), heat(-40)]]);
  assert.deepEqual(errors, []);
  assert.deepEqual(await getHeatmap('a'), heat(-40));
  assert.equal(fetch.mock.callCount(), 5);
});

test('un changement rapide de plan/BSSID et un démontage ignorent les erreurs et succès retardés', async t => {
  const old = deferred<Response>();
  const middle = deferred<Response>();
  const final = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string) =>
    path.includes('/a/') ? old.promise : path.endsWith('bssid=b') ? middle.promise : final.promise,
  );
  const published: unknown[] = [];
  const errors: unknown[] = [];
  const mount = (id: string, bssid: string) => watchApiRead(
    read => getHeatmap(id, { bssid }, read),
    { success: value => published.push(value), error: error => errors.push(error) },
  );
  const a = mount('a', 'a');
  t.after(a.dispose);
  await until(() => fetch.mock.callCount() === 1);
  a.dispose();
  const b = mount('b', 'b');
  t.after(b.dispose);
  await until(() => fetch.mock.callCount() === 2);
  b.dispose();
  const c = mount('b', 'c');
  t.after(c.dispose);
  await until(() => fetch.mock.callCount() === 3);
  final.resolve(json(heat(-30)));
  await until(() => published.length === 1);
  old.reject(new Error('erreur retardée'));
  middle.resolve(json(heat(-80)));
  await until(() => apiCache.stats().inFlightRequests === 0);
  assert.deepEqual(published, [heat(-30)]);
  assert.deepEqual(errors, []);
  assert.equal(fetch.mock.callCount(), 3);
});

test('un GET détaché par une actualisation forcée ne publie pas son erreur tardive', async t => {
  setApiCacheStorage(true);
  const old = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) =>
    init.cache === 'reload' ? json({ scan_mode: 'live' }) : old.promise,
  );
  const published: string[] = [];
  const errors: unknown[] = [];
  const view = watchApiRead(getSettings, {
    success: settings => published.push(settings.scan_mode),
    error: error => errors.push(error),
  });
  t.after(view.dispose);
  await until(() => fetch.mock.callCount() === 1);
  assert.equal((await getSettings(new ApiRead({ forceRefresh: true }))).scan_mode, 'live');
  old.reject(new Error('erreur retardée'));
  await until(() => published.length === 1);
  assert.deepEqual(published, ['live']);
  assert.deepEqual(errors, []);
  assert.equal(fetch.mock.callCount(), 2);
});

test('le mécanisme de reload force la lecture et une mutation de paramètres relit la valeur visible', async t => {
  setApiCacheStorage(true);
  let mode = 'test';
  const fetch = t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    if (init.method === 'PATCH') {
      mode = JSON.parse(String(init.body)).value;
      return json({ key: 'scan_mode', value: mode });
    }
    return json({ scan_mode: mode });
  });
  const published: string[] = [];
  const view = watchApiRead(getSettings, { success: settings => published.push(settings.scan_mode) });
  t.after(view.dispose);
  await until(() => published.length === 1);
  mode = 'other';
  view.refresh();
  await until(() => published.length === 2);
  await patchSetting('scan_mode', 'live');
  await until(() => published.length === 3);
  assert.deepEqual(published, ['test', 'other', 'live']);
  assert.equal(fetch.mock.callCount(), 4);
  assert.equal(fetch.mock.calls[1].arguments[1]?.cache, 'reload');
});
