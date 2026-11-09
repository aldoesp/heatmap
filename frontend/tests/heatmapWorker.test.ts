import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHeatmapRender, type HeatmapRenderInput } from '../src/lib/heatmapRender.js';
import { createHeatmapSession, type HeatmapWorkerPort, type HeatmapWorkerRequest, type HeatmapWorkerResponse } from '../src/lib/heatmapWorkerClient.js';
import { buildRssiMeshes } from '../src/lib/heatmapRssi.js';
import { buildRegularizedRssiField, fitRegularizedRssi } from '../src/lib/regularizedRssi.js';
import { rasterizeRegularizedRssi } from '../src/lib/regularizedRaster.js';
import { rasterizeRssiMeshes } from '../src/lib/heatmapRaster.js';
import { buildColourLut, DEFAULT_HEATMAP_COLOURS } from '../src/lib/heatmapColours.js';
import type { HeatmapRow } from '../src/types/api.js';

const row = (x: number, y: number, rssi: number): HeatmapRow => ({
  scan_point_id: `${x}:${y}`, plan_id: 'p', survey_id: null, x, y, rssi,
  bssid: 'aa:bb:cc:dd:ee:01', bssid_name: 'AP', ssid: 'Test', band: '5GHz', frequency_mhz: 5180, quality: 60,
});
const input = (extra: Partial<HeatmapRenderInput> = {}): HeatmapRenderInput => ({
  metric: 'rssi', calculation: 'regularized', plan: { id: 'p', width: 40, height: 30 },
  measurements: [row(.1, .1, -55), row(.9, .1, -75), row(.1, .9, -60), row(.9, .9, -85)],
  points: [], polygons: [], apPositions: [], accessPoints: [], radius: 10,
  bands: [{ min: 50, color: '#10b981' }, { min: -Infinity, color: '#ef4444' }],
  lut: buildColourLut(DEFAULT_HEATMAP_COLOURS), showEstimated: true, ...extra,
});

describe('calcul transféré dans le worker', () => {
  it('conserve les pixels, isolignes, zones et valeurs de la sonde du calcul régularisé', () => {
    const data = input({ polygons: [{ id: 'zone', vertices: [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }] }] });
    const meshes = buildRssiMeshes(data.measurements, data.plan, { polygons: data.polygons }).meshes;
    const field = buildRegularizedRssiField(data.measurements, data.plan, data.polygons, meshes);
    const expected = rasterizeRegularizedRssi(field, 40, 30, 40, 30, data.lut);
    const actual = createHeatmapRender(data);
    assert.deepEqual(actual.image, expected);
    for (const [x, y] of [[0, 0], [10, 10], [30, 20]]) assert.deepEqual(actual.sample(x, y), field.sample(x, y));
    assert.deepEqual(actual.metadata.bssids, ['aa:bb:cc:dd:ee:01']);
    assert.deepEqual(actual.metadata.uncoveredZones, []);
  });

  it('conserve le rendu hybride sans zones et gère un maillage vide', () => {
    const data = input({ calculation: 'hybrid' });
    const meshes = buildRssiMeshes(data.measurements, data.plan).meshes;
    const expected = rasterizeRssiMeshes(meshes, 40, 30, 40, 30, data.lut, .75);
    assert.deepEqual(createHeatmapRender(data).image.data, expected!.data);
    assert.equal(createHeatmapRender(input({ calculation: 'hybrid', measurements: [] })).image.coveredPixels, 0);
  });

  it('respecte les bandes de débit, le masque et les coordonnées image', () => {
    const data = input({ metric: 'speed', points: [{ x: .5, y: .75, value: 100 }],
      polygons: [{ id: 'upper', vertices: [{ x: 0, y: .5 }, { x: 1, y: .5 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }] });
    const render = createHeatmapRender(data);
    const top = (7 * 40 + 20) * 4, bottom = (25 * 40 + 20) * 4;
    assert.deepEqual([...render.image.data.slice(top, top + 4)], [16, 185, 129, 191]);
    assert.equal(render.image.data[bottom + 3], 0);
    assert.deepEqual(render.sample(20, 20), { status: 'NO_DATA', rssi: null });
  });

  it('utilise 512 px par défaut et la limite demandée pour l’export', () => {
    const plan = { id: 'p', width: 1200, height: 600 };
    const display = createHeatmapRender(input({ plan, calculation: 'hybrid' }));
    const exported = createHeatmapRender(
      input({ plan, calculation: 'hybrid', maxRasterDimension: 1024 }),
    );
    assert.deepEqual(
      [display.image.width, display.image.height],
      [512, 256],
    );
    assert.deepEqual(
      [exported.image.width, exported.image.height],
      [1024, 512],
    );
  });

  it('garde les quatre voisins les plus proches pour un grand relevé colinéaire', () => {
    const nodes = Array.from({ length: 20 }, (_, x) => ({ x, y: 0, value: -40 - x * 2 }));
    assert.ok(Math.abs(fitRegularizedRssi(nodes, 100)(3.5, 0)! + 47) < 1e-10);
  });
});

class FakeWorker implements HeatmapWorkerPort {
  onmessage: HeatmapWorkerPort['onmessage'] = null;
  onerror: HeatmapWorkerPort['onerror'] = null;
  sent: HeatmapWorkerRequest[] = [];
  terminated = false;
  postMessage(message: HeatmapWorkerRequest) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  receive(data: HeatmapWorkerResponse) { this.onmessage?.({ data }); }
}

describe('cycle de vie du worker', () => {
  it('ignore un résultat ancien après changement de filtre', () => {
    const port = new FakeWorker(); let ready = 0;
    const session = createHeatmapSession(port, input(), () => ready++, assert.fail);
    const queued = port.onmessage!;
    session.dispose();
    queued({ data: { type: 'ready', result: createHeatmapRender(input()) } });
    assert.equal(ready, 0);
    assert.equal(port.terminated, true);
  });

  it('associe les réponses de sonde même si elles arrivent dans un autre ordre', async () => {
    const port = new FakeWorker();
    const session = createHeatmapSession(port, input(), () => {}, assert.fail);
    port.receive({ type: 'ready', result: createHeatmapRender(input()) });
    const first = session.sample(1, 1), second = session.sample(2, 2);
    port.receive({ type: 'sample', id: 2, sample: { status: 'INTERPOLATED', rssi: -80, confidence: 1 } });
    port.receive({ type: 'sample', id: 1, sample: { status: 'INTERPOLATED', rssi: -60, confidence: 1 } });
    assert.equal((await first).rssi, -60); assert.equal((await second).rssi, -80);
    session.dispose();
  });

  it('termine les requêtes en attente à la fermeture et ne relance aucun travail', async () => {
    const port = new FakeWorker();
    const session = createHeatmapSession(port, input(), () => {}, assert.fail);
    port.receive({ type: 'ready', result: createHeatmapRender(input()) });
    const pending = session.sample(2, 2);
    session.dispose();
    assert.equal((await pending).status, 'NO_DATA');
    const count = port.sent.length;
    assert.equal((await session.sample(3, 3)).status, 'NO_DATA');
    assert.equal(port.sent.length, count);
  });

  it('signale les erreurs du worker et libère les requêtes de sonde', async () => {
    const port = new FakeWorker(); let message = '';
    const session = createHeatmapSession(port, input(), () => {}, error => { message = error; });
    port.receive({ type: 'ready', result: createHeatmapRender(input()) });
    const pending = session.sample(2, 2);
    port.onerror!({ message: 'worker unavailable' });
    assert.equal((await pending).status, 'NO_DATA');
    assert.equal(message, 'worker unavailable'); assert.equal(port.terminated, true);
  });

  it('demande un raster d’export séparé sans remplacer le rendu interactif', async () => {
    const port = new FakeWorker();
    const session = createHeatmapSession(port, input(), () => {}, assert.fail);
    port.receive({ type: 'ready', result: createHeatmapRender(input()) });
    const promise = session.renderForExport(input({ maxRasterDimension: 2048 }));
    const request = port.sent.find((message) => message.type === 'export');
    assert.ok(request && request.type === 'export');
    assert.equal(request.input.maxRasterDimension, 2048);
    const exported = createHeatmapRender(input());
    port.receive({ type: 'export', id: request.id, result: exported });
    assert.deepEqual((await promise).image.data, exported.image.data);
    port.receive({
      type: 'sample',
      id: 999,
      sample: { status: 'INTERPOLATED', rssi: -60, confidence: 1 },
    });
    session.dispose();
  });

  it('isole les erreurs d’export et rejette les exports interrompus', async () => {
    const port = new FakeWorker();
    const session = createHeatmapSession(port, input(), () => {}, assert.fail);
    const failed = session.renderForExport(input());
    const failedRequest = port.sent.find((message) => message.type === 'export');
    assert.ok(failedRequest && failedRequest.type === 'export');
    port.receive({
      type: 'export-error',
      id: failedRequest.id,
      message: 'mémoire insuffisante',
    });
    await assert.rejects(failed, /mémoire insuffisante/);

    const interrupted = session.renderForExport(input());
    session.dispose();
    await assert.rejects(interrupted, /Export interrompu/);
  });
});
