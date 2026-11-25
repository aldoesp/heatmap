import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildColourLut, DEFAULT_HEATMAP_COLOURS } from '../src/lib/heatmapColours.js';
import { createHeatmapDisplayCache, heatmapRasterKey } from '../src/lib/heatmapRasterCache.js';
import { createHeatmapRender, prepareHeatmapProbe, type HeatmapRenderInput, type HeatmapRenderResult } from '../src/lib/heatmapRender.js';
import type { HeatmapWorkerPort, HeatmapWorkerRequest, HeatmapWorkerResponse } from '../src/lib/heatmapWorkerClient.js';

const polygon = { id: 'zone', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
const base: HeatmapRenderInput = {
  plan: { id: 'plan', width: 40, height: 30 },
  metric: 'rssi', calculation: 'regularized', points: [{ x: .5, y: .5, value: 100 }],
  radius: 30, bands: [{ min: -Infinity, color: '#123456' }],
  lut: buildColourLut(DEFAULT_HEATMAP_COLOURS), showEstimated: true, polygons: [polygon],
  measurements: [[.1, .1, -50], [.9, .1, -60], [.1, .9, -70], [.9, .9, -80]].map(([x, y, rssi], index) => ({
    scan_point_id: String(index), plan_id: 'plan', survey_id: 'survey', x, y, rssi, quality: 0,
    band: '5GHz', bssid: '00:00:00:00:00:01', bssid_name: 'Test', ssid: 'Test', frequency_mhz: 5180,
  })),
  apPositions: [{ bssid: '00:00:00:00:00:01', x: .1, y: .1 }], accessPoints: [],
};
const input = (changes: Partial<HeatmapRenderInput> = {}) => ({ ...base, ...changes });
const modifyRows = (changes: Partial<HeatmapRenderInput['measurements'][number]>) => (
  base.measurements.map((row, index) => index ? row : { ...row, ...changes })
);
const varied = (rssi: number) => input({ measurements: modifyRows({ rssi }) });

function render(settings: HeatmapRenderInput): HeatmapRenderResult {
  const { image, metadata, durationMs } = createHeatmapRender(settings);
  return { image, metadata, durationMs };
}

class Port implements HeatmapWorkerPort {
  onmessage: HeatmapWorkerPort['onmessage'] = null;
  onerror: HeatmapWorkerPort['onerror'] = null;
  sent: HeatmapWorkerRequest[] = [];
  terminated = false;
  postMessage(message: HeatmapWorkerRequest) { this.sent.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  send(data: HeatmapWorkerResponse) { this.onmessage?.({ data }); }
  complete(result: HeatmapRenderResult) {
    this.send(structuredClone({ type: 'ready', result }, { transfer: [result.image.data.buffer] }));
  }
}

function setup(options?: Parameters<typeof createHeatmapDisplayCache>[1]) {
  const ports: Port[] = [];
  const cache = createHeatmapDisplayCache(() => {
    const port = new Port();
    ports.push(port);
    return port;
  }, options);
  async function load(settings: HeatmapRenderInput, response?: HeatmapRenderResult) {
    const count = ports.length;
    const lease = cache.acquire(settings);
    await Promise.resolve();
    if (ports.length > count) ports.at(-1)!.complete(response ?? render(settings));
    try { return await lease.result; }
    finally { lease.dispose(); }
  }
  return { cache, ports, load };
}

describe('clés de raster', () => {
  it('est déterministe, utilise la taille effective et ignore les données purement visuelles', () => {
    const key = heatmapRasterKey(base);
    assert.equal(heatmapRasterKey(structuredClone(base)), key);
    assert.equal(heatmapRasterKey(input({
      maxRasterDimension: 512, radius: 500, points: [],
      measurements: modifyRows({ ssid: 'Alias', bssid_name: 'Nom', quality: 99 }),
    })), key);
    assert.notEqual(heatmapRasterKey(input({ maxRasterDimension: 20 })), key);
  });

  it('change avec les mesures, le plan, le mode, la palette et les polygones', () => {
    const key = heatmapRasterKey(base);
    const lut = base.lut.slice();
    lut[0] ^= 1;
    for (const settings of [
      varied(-51),
      input({ measurements: modifyRows({ survey_id: 'autre' }) }),
      input({ measurements: modifyRows({ x: .12, band: '2.4GHz' }) }),
      input({ measurements: [...base.measurements].reverse() }),
      input({ plan: { ...base.plan, width: 41 } }),
      input({ polygons: [{ ...polygon, vertices: polygon.vertices.slice(1) }] }),
      input({ calculation: 'hybrid' }), input({ showEstimated: false }), input({ lut }),
    ]) assert.notEqual(heatmapRasterKey(settings), key);
  });

  it('retient les entrées de propagation pour l’hybride zoné et les paramètres de débit', () => {
    const hybrid = input({ calculation: 'hybrid' });
    assert.notEqual(heatmapRasterKey(hybrid), heatmapRasterKey({ ...hybrid, apPositions: [] }));
    assert.notEqual(heatmapRasterKey(hybrid), heatmapRasterKey({ ...hybrid, accessPoints: [{ id: 'ap', x: .4, y: .4, bssids: ['autre'] }] }));
    const speed = input({ metric: 'speed' });
    for (const change of [{ radius: 40 }, { points: [] }, { bands: [{ min: Infinity, color: '#123456' }] }]) {
      assert.notEqual(heatmapRasterKey(speed), heatmapRasterKey({ ...speed, ...change }));
    }
  });
});

describe('cache d’affichage', () => {
  it('retourne les mêmes images et métadonnées en régularisé, hybride et débit', async () => {
    const { cache, ports, load } = setup();
    for (const settings of [base, input({ calculation: 'hybrid' }), input({ metric: 'speed' })]) {
      const cold = await load(settings);
      const expected = render(settings);
      assert.deepEqual(cold.image, expected.image);
      assert.deepEqual(cold.metadata, expected.metadata);
      assert.deepEqual(await load(structuredClone(settings)), cold);
    }
    assert.equal(ports.length, 3);
    assert.deepEqual({ hits: cache.stats().hits, misses: cache.stats().misses }, { hits: 3, misses: 3 });
    const updated = await load(varied(-88));
    assert.equal(cache.stats().misses, 4);
    assert.notDeepEqual(updated.image, (await load(base)).image);
  });

  it('évince l’entrée la moins récemment consultée lorsque le nombre est atteint', async () => {
    const { cache, ports, load } = setup({ maxEntries: 2 });
    await load(base);
    await load(varied(-51));
    await load(base);
    await load(varied(-52));
    assert.equal(cache.stats().entries, 2);
    assert.equal(cache.stats().evictions, 1);
    assert.equal(ports.length, 3);
    await load(base);
    assert.equal(ports.length, 3);
    await load(varied(-51));
    assert.equal(ports.length, 4);
  });

  it('associe chaque raster au contenu envoyé même si les mesures changent pendant le calcul', async () => {
    const { cache, ports, load } = setup();
    const settings = structuredClone(base);
    const before = cache.acquire(settings);
    settings.measurements[0].rssi = -88;
    const after = cache.acquire(settings);
    for (const port of ports) {
      const build = port.sent[0];
      if (build.type !== 'build') assert.fail();
      port.complete(render(build.input));
    }
    assert.deepEqual((await before.result).image, render(base).image);
    assert.deepEqual((await after.result).image, render(settings).image);
    assert.notDeepEqual((await load(base)).image, (await load(settings)).image);
    assert.equal(cache.stats().entries, 2);
    before.dispose();
    after.dispose();
  });

  it('compte le buffer et les contours, respecte le budget et refuse une entrée trop grande', async () => {
    const measured = setup();
    const initial = await measured.load(base);
    const budget = measured.cache.stats().bytes;
    assert.ok(budget > initial.image.data.byteLength + initial.image.contours.length * 100);
    const { cache, ports, load } = setup({ maxBytes: budget + 128 });
    await load(base);
    await load(varied(-51));
    assert.equal(cache.stats().entries, 1);
    assert.equal(cache.stats().evictions, 1);
    const large = render(varied(-52));
    large.image.contours.push(...Array.from({ length: 1000 }, () => ({ level: -60, a: [1, 1] as [number, number], b: [2, 2] as [number, number] })));
    await load(varied(-52), large);
    assert.equal(cache.stats().entries, 1);
    assert.ok(cache.stats().bytes <= budget + 128);
    await load(varied(-51));
    assert.equal(ports.length, 3);
  });

  it('déduplique les calculs simultanés et isole les buffers transférés', async () => {
    const { cache, ports, load } = setup();
    const a = cache.acquire(base);
    const b = cache.acquire(structuredClone(base));
    await Promise.resolve();
    assert.equal(ports.length, 1);
    const workerResult = render(base);
    const expected = workerResult.image.data.slice();
    ports[0].complete(workerResult);
    assert.equal(workerResult.image.data.byteLength, 0);
    const [aResult, bResult] = await Promise.all([a.result, b.result]);
    structuredClone(aResult.image.data, { transfer: [aResult.image.data.buffer] });
    assert.deepEqual(bResult.image.data, expected);
    assert.deepEqual((await load(base)).image.data, expected);
    assert.equal(cache.stats().coalesced, 1);
    a.dispose();
    assert.equal(ports[0].terminated, false);
    b.dispose();
    assert.equal(ports[0].terminated, true);
  });

  it('annule un résultat obsolète et empêche un ancien worker de repeupler une clé', async () => {
    const { cache, ports } = setup();
    const old = cache.acquire(base);
    await Promise.resolve();
    const respond = ports[0].onmessage!;
    const canceled = assert.rejects(old.result, /interrompu/);
    old.dispose();
    await canceled;
    const current = cache.acquire(base);
    await Promise.resolve();
    respond({ data: { type: 'ready', result: render(base) } });
    assert.equal(cache.stats().entries, 0);
    ports[1].complete(render(base));
    await current.result;
    assert.equal(cache.stats().entries, 1);
    current.dispose();
  });

  it('annule seulement le consommateur qui part et ne conserve pas les erreurs ni un buffer détaché', async () => {
    const { cache, ports } = setup();
    const a = cache.acquire(base);
    const b = cache.acquire(base);
    await Promise.resolve();
    const canceled = assert.rejects(a.result, /interrompu/);
    a.dispose();
    assert.equal(ports[0].terminated, false);
    await canceled;
    ports[0].send({ type: 'error', message: 'Échec du calcul' });
    await assert.rejects(b.result, /Échec du calcul/);
    b.dispose();
    const retry = cache.acquire(base);
    await Promise.resolve();
    const detached = render(base);
    structuredClone(detached.image.data, { transfer: [detached.image.data.buffer] });
    ports[1].send({ type: 'ready', result: detached });
    await assert.rejects(retry.result, /Buffer de couverture invalide/);
    assert.equal(cache.stats().entries, 0);
    retry.dispose();
  });

  it('prépare la sonde une fois sur un hit, et envoie chaque export au worker', async () => {
    const { cache, ports, load } = setup();
    await load(base);
    const hit = cache.acquire(base);
    await hit.result;
    assert.equal(ports.length, 1);
    const probe = hit.sample(10, 10);
    const port = ports[1];
    const [prepare, request] = port.sent;
    assert.equal(prepare.type, 'prepare');
    assert.equal(request.type, 'probe');
    if (prepare.type !== 'prepare' || request.type !== 'probe') assert.fail();
    const sample = prepareHeatmapProbe(prepare.input)(request.x, request.y);
    port.send({ type: 'sample', id: request.id, sample });
    assert.deepEqual(await probe, createHeatmapRender(base).sample(10, 10));
    const second = hit.sample(12, 12);
    assert.equal(port.sent[2].type, 'probe');
    const before = cache.stats();
    for (let index = 0; index < 2; index++) {
      const exportInput = input({ maxRasterDimension: 2048 });
      const exported = hit.renderForExport(exportInput);
      await Promise.resolve();
      const request = port.sent.at(-1)!;
      if (request.type !== 'export') assert.fail();
      port.send({ type: 'export', id: request.id, result: render(request.input) });
      assert.deepEqual((await exported).image, render(exportInput).image);
    }
    assert.deepEqual(cache.stats(), before);
    hit.dispose();
    assert.equal((await second).status, 'NO_DATA');
  });

  it('interrompt l’export d’un consommateur sans interrompre la sonde partagée', async () => {
    const { cache, ports } = setup();
    const a = cache.acquire(base);
    const b = cache.acquire(base);
    await Promise.resolve();
    ports[0].complete(render(base));
    await Promise.all([a.result, b.result]);
    const exported = assert.rejects(a.renderForExport(base), /Export interrompu/);
    await Promise.resolve();
    assert.equal(ports[1].sent[0].type, 'export');
    a.dispose();
    await exported;
    assert.equal(ports[1].terminated, true);
    assert.equal(ports[0].terminated, false);
    b.dispose();
  });
});
