import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRssiMeshes } from '../src/lib/heatmapRssi.js';
import type { HeatmapRow } from '../src/types/api.js';

const PLAN = { id: 'plan-a', width: 100, height: 80 };

function row(
  scanPointId: string,
  x: number,
  y: number,
  rssi: number,
  overrides: Partial<HeatmapRow> = {}
): HeatmapRow {
  return {
    scan_point_id: scanPointId,
    plan_id: 'plan-a',
    survey_id: null,
    x,
    y,
    bssid: 'aa:bb:cc:dd:ee:01',
    bssid_name: 'AP test',
    ssid: 'Test',
    band: '2.4GHz',
    frequency_mhz: 2412,
    rssi,
    quality: 50,
    ...overrides,
  };
}

const TRIANGLE_ROWS = [
  row('a', 0.1, 0.1, -50),
  row('b', 0.9, 0.1, -60),
  row('c', 0.5, 0.9, -70),
];

describe('construction des maillages RSSI de la heatmap', () => {
  it('construit un maillage par BSSID avec ses triangles', () => {
    const rows = [...TRIANGLE_ROWS, row('d', 0.2, 0.7, -65)];
    const result = buildRssiMeshes(rows, PLAN);

    assert.equal(result.status, 'READY');
    assert.equal(result.meshes.length, 1);
    assert.equal(result.meshes[0].triangles.length, 2);
    assert.equal(result.meshes[0].width, PLAN.width);
    assert.equal(result.meshes[0].height, PLAN.height);
    assert.equal(result.meshes[0].scope.bssid, 'aa:bb:cc:dd:ee:01');
    assert.equal(result.meshes[0].scope.surveyId, null);
    assert.equal(result.meshes[0].scope.band, '2.4GHz');
    assert.equal(result.meshes[0].scope.frequency_mhz, 2412);

    const pointA = result.meshes[0].points.find((point) => point.sourceId === 'a');
    assert.deepEqual(pointA && { x: pointA.xPx, y: pointA.yPx }, { x: 10, y: 8 });
  });

  it('recalcule les pixels quand le plan change', () => {
    const first = buildRssiMeshes(TRIANGLE_ROWS, {
      id: 'plan-a',
      width: 100,
      height: 80,
    });
    const second = buildRssiMeshes(
      TRIANGLE_ROWS.map((entry) => ({ ...entry, plan_id: 'plan-b' })),
      {
        id: 'plan-b',
        width: 200,
        height: 50,
      }
    );

    assert.equal(first.status, 'READY');
    assert.equal(second.status, 'READY');

    const firstA = first.meshes[0].points.find((point) => point.sourceId === 'a');
    const secondA = second.meshes[0].points.find((point) => point.sourceId === 'a');
    assert.deepEqual(firstA && { x: firstA.xPx, y: firstA.yPx }, { x: 10, y: 8 });
    assert.deepEqual(secondA && { x: secondA.xPx, y: secondA.yPx }, { x: 20, y: 5 });
    assert.equal(first.meshes[0].scope.planId, 'plan-a');
    assert.equal(second.meshes[0].scope.planId, 'plan-b');
  });

  it('gère un plan sans mesure', () => {
    const result = buildRssiMeshes([], PLAN);

    assert.equal(result.status, 'NO_DATA');
    assert.equal(result.meshes.length, 0);
    assert.equal(result.rowCount, 0);
  });

  it('gère une seule mesure', () => {
    const result = buildRssiMeshes(TRIANGLE_ROWS.slice(0, 1), PLAN);

    assert.equal(result.status, 'INSUFFICIENT_POINTS');
    assert.equal(result.meshes.length, 0);
  });

  it('ne produit aucune couche avec des mesures insuffisantes', () => {
    const result = buildRssiMeshes(TRIANGLE_ROWS.slice(0, 2), PLAN);

    assert.equal(result.status, 'INSUFFICIENT_POINTS');
    assert.equal(result.meshes.length, 0);
    assert.equal(result.skipped[0]?.status, 'INSUFFICIENT_POINTS');
  });

  it('ne produit aucune couche pour une triangulation dégénérée', () => {
    const result = buildRssiMeshes(
      [row('a', 0.1, 0.1, -50), row('b', 0.5, 0.5, -60), row('c', 0.9, 0.9, -70)],
      PLAN
    );

    assert.equal(result.status, 'COLLINEAR_POINTS');
    assert.equal(result.meshes.length, 0);
    assert.equal(result.skipped[0]?.status, 'COLLINEAR_POINTS');
  });

  it('signale une entrée invalide sans fabriquer de triangles', () => {
    const invalidPlan = buildRssiMeshes(TRIANGLE_ROWS, {
      id: 'plan-a',
      width: 0,
      height: 80,
    });

    assert.equal(invalidPlan.status, 'INVALID_INPUT');
    assert.equal(invalidPlan.meshes.length, 0);

    const invalidBand = buildRssiMeshes(
      TRIANGLE_ROWS.map((entry) => ({ ...entry, band: 'inconnue' })),
      PLAN
    );

    assert.equal(invalidBand.status, 'INVALID_INPUT');
    assert.equal(invalidBand.ignoredRowCount, 3);
    assert.equal(invalidBand.meshes.length, 0);
  });

  it("ignore les mesures d'un autre plan au lieu de les relabelliser", () => {
    const otherPlanRows = TRIANGLE_ROWS.map((entry) => ({
      ...entry,
      plan_id: 'plan-b',
    }));
    const result = buildRssiMeshes(otherPlanRows, PLAN);

    assert.equal(result.status, 'INVALID_INPUT');
    assert.equal(result.meshes.length, 0);
    assert.equal(result.ignoredRowCount, 3);
  });

  it('déduplique les coordonnées et ignore les mesures invalides', () => {
    const rows = [
      row('a', 0.1, 0.1, -50),
      row('a-duplicate', 0.1, 0.1, -40),
      row('b', 0.9, 0.1, -60),
      row('c', 0.5, 0.9, -70),
      row('invalid', 1.5, 0.2, -55),
    ];
    const result = buildRssiMeshes(rows, PLAN);

    assert.equal(result.status, 'READY');
    assert.equal(result.meshes.length, 1);
    assert.equal(result.meshes[0].points.length, 3);
    const duplicate = result.meshes[0].points.find(
      (point) => point.xPx === 10 && point.yPx === 8
    );
    assert.equal(duplicate?.rssi, -40);
    assert.equal(
      result.meshes[0].points.some((point) => point.sourceId === 'invalid'),
      false
    );
  });

  it('sépare les BSSID sans mélanger leurs mesures', () => {
    const otherRows = TRIANGLE_ROWS.map((entry) =>
      row(entry.scan_point_id, entry.x, entry.y, entry.rssi - 5, {
        bssid: 'aa:bb:cc:dd:ee:02',
        bssid_name: 'AP 2',
        frequency_mhz: 2437,
      })
    );
    const result = buildRssiMeshes([...TRIANGLE_ROWS, ...otherRows], PLAN);

    assert.equal(result.status, 'READY');
    assert.equal(result.meshes.length, 2);
    assert.deepEqual(
      result.meshes.map((mesh) => mesh.scope.bssid).sort(),
      ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02']
    );
  });
});
