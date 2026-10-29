import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpolateBarycentric,
  interpolatePreparedTriangle,
  prepareBarycentricTriangle,
  rssiAtPreparedTriangle,
  sampleTriangleMesh,
  triangulateRssi,
  type GeometryPoint,
  type InterpolationScope,
  type RssiMeasurement,
  type TriangleVertices,
  type TriangulationInput,
  type TriangulationResult,
} from '../src/lib/triangulation.js';

const SCOPE: InterpolationScope = {
  planId: 'plan-1',
  surveyId: null,
  bssid: 'aa:bb:cc:dd:ee:01',
  frequency_mhz: null,
  band: '2.4GHz',
};

function measurement(
  scanPointId: string,
  x: number,
  y: number,
  rssi: number,
  overrides: Partial<RssiMeasurement> = {}
): RssiMeasurement {
  return {
    scan_point_id: scanPointId,
    planId: SCOPE.planId,
    surveyId: SCOPE.surveyId,
    bssid: SCOPE.bssid,
    frequency_mhz: SCOPE.frequency_mhz,
    band: SCOPE.band,
    x,
    y,
    rssi,
    ...overrides,
  };
}

function makeInput(
  measurements: RssiMeasurement[],
  scope: InterpolationScope = SCOPE
): TriangulationInput {
  return {
    scope,
    plan: { id: scope.planId, width: 100, height: 100 },
    measurements,
  };
}

function gridMeasurements(
  size: number,
  step: number,
  start: number
): RssiMeasurement[] {
  const measurements: RssiMeasurement[] = [];
  for (let iy = 0; iy < size; iy += 1) {
    for (let ix = 0; ix < size; ix += 1) {
      measurements.push(
        measurement(
          `g${ix}-${iy}`,
          start + ix * step,
          start + iy * step,
          -50 - ((ix + iy) % 20)
        )
      );
    }
  }
  return measurements;
}

function expectReady(result: TriangulationResult) {
  assert.equal(result.status, 'READY');
  if (result.status !== 'READY') {
    throw new Error('Statut inattendu : le maillage devrait être READY.');
  }
  return result;
}

describe('triangulation RSSI', () => {
  it('construit un triangle à partir de trois points non colinéaires', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.5, 0.9, -70),
        ])
      )
    );

    assert.equal(result.mesh.points.length, 3);
    assert.equal(result.mesh.triangles.length, 1);
    assert.deepEqual(
      result.mesh.points.map((point) => point.sourceId).sort(),
      ['a', 'b', 'c']
    );
    assert.equal(result.dropped.length, 0);

    const sample = sampleTriangleMesh(result.mesh, 10, 10);
    assert.equal(sample.status, 'INTERPOLATED');
    if (sample.status !== 'INTERPOLATED') return;
    assert.equal(sample.rssi, -50);
    assert.ok(Math.abs(sample.lambdaA + sample.lambdaB + sample.lambdaC - 1) < 1e-9);
  });

  it('construit plusieurs triangles pour plusieurs points', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.9, 0.9, -70),
          measurement('d', 0.1, 0.9, -80),
        ])
      )
    );

    assert.equal(result.mesh.points.length, 4);
    assert.equal(result.mesh.triangles.length, 2);
  });

  it('interpole au barycentre avec une somme de poids égale à 1', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.5, 0.9, -70),
        ])
      )
    );

    const centroidX = (10 + 90 + 50) / 3;
    const centroidY = (10 + 10 + 90) / 3;
    const sample = sampleTriangleMesh(result.mesh, centroidX, centroidY);

    assert.equal(sample.status, 'INTERPOLATED');
    if (sample.status !== 'INTERPOLATED') return;

    assert.ok(Math.abs(sample.lambdaA - 1 / 3) < 1e-9);
    assert.ok(Math.abs(sample.lambdaB - 1 / 3) < 1e-9);
    assert.ok(Math.abs(sample.lambdaC - 1 / 3) < 1e-9);
    assert.ok(Math.abs(sample.lambdaA + sample.lambdaB + sample.lambdaC - 1) < 1e-9);
    assert.ok(Math.abs(sample.rssi - -60) < 1e-9);
  });

  it('ne retourne aucune valeur hors des triangles', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.5, 0.9, -70),
        ])
      )
    );

    const sample = sampleTriangleMesh(result.mesh, 95, 95);
    assert.deepEqual(sample, { status: 'OUTSIDE', rssi: null });
  });

  it('détecte les points colinéaires', () => {
    const result = triangulateRssi(
      makeInput([
        measurement('a', 0.1, 0.1, -50),
        measurement('b', 0.5, 0.5, -60),
        measurement('c', 0.9, 0.9, -70),
      ])
    );

    assert.equal(result.status, 'COLLINEAR_POINTS');
    if (result.status !== 'COLLINEAR_POINTS') return;
    assert.equal(result.distinctPointCount, 3);
  });

  it('fusionne les coordonnées dupliquées en gardant le meilleur RSSI', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('strong', 0.5, 0.5, -40),
          measurement('weak', 0.5, 0.5, -70),
        ])
      )
    );

    assert.equal(result.mesh.points.length, 3);
    assert.equal(result.mesh.triangles.length, 1);

    const duplicatePoint = result.mesh.points.find(
      (point) => point.xPx === 50 && point.yPx === 50
    );
    assert.ok(duplicatePoint);
    assert.equal(duplicatePoint.rssi, -40);
    assert.equal(duplicatePoint.sourceId, 'strong');
  });

  it('écarte les coordonnées invalides et continue avec les points valides', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.5, 0.9, -70),
          measurement('bad-x', 1.2, 0.5, -55),
          measurement('bad-y', 0.4, -0.1, -55),
        ])
      )
    );

    assert.equal(result.mesh.points.length, 3);
    assert.equal(result.dropped.length, 2);
    assert.ok(result.dropped.every((issue) => issue.code === 'INVALID_COORDINATE'));
  });

  it('écarte les RSSI invalides', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.5, 0.9, -70),
          measurement('bad-rssi', 0.2, 0.8, 5),
        ])
      )
    );

    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0]?.code, 'INVALID_RSSI');
  });

  it('refuse de mélanger plusieurs BSSID', () => {
    const result = triangulateRssi(
      makeInput([
        measurement('a', 0.1, 0.1, -50),
        measurement('b', 0.9, 0.1, -60),
        measurement('c', 0.5, 0.9, -70),
        measurement('other', 0.2, 0.8, -65, {
          bssid: 'aa:bb:cc:dd:ee:02',
        }),
      ])
    );

    assert.equal(result.status, 'INVALID_INPUT');
    if (result.status !== 'INVALID_INPUT') return;
    assert.ok(result.issues.some((issue) => issue.code === 'MIXED_SCOPE'));
  });

  it('refuse de mélanger plusieurs fréquences ou bandes', () => {
    const result = triangulateRssi(
      makeInput([
        measurement('a', 0.1, 0.1, -50),
        measurement('b', 0.9, 0.1, -60),
        measurement('c', 0.5, 0.9, -70),
        measurement('other-band', 0.2, 0.8, -65, {
          band: '5GHz',
          frequency_mhz: 5200,
        }),
      ])
    );

    assert.equal(result.status, 'INVALID_INPUT');
    if (result.status !== 'INVALID_INPUT') return;
    assert.ok(result.issues.some((issue) => issue.code === 'MIXED_SCOPE'));
  });

  it('gère un ensemble vide', () => {
    const result = triangulateRssi(makeInput([]));

    assert.equal(result.status, 'INSUFFICIENT_POINTS');
    if (result.status !== 'INSUFFICIENT_POINTS') return;
    assert.equal(result.distinctPointCount, 0);
  });

  it('gère un ensemble insuffisant', () => {
    const result = triangulateRssi(
      makeInput([
        measurement('a', 0.1, 0.1, -50),
        measurement('b', 0.9, 0.1, -60),
      ])
    );

    assert.equal(result.status, 'INSUFFICIENT_POINTS');
    if (result.status !== 'INSUFFICIENT_POINTS') return;
    assert.equal(result.distinctPointCount, 2);
  });

  it('refuse une requête non finie', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.5, 0.9, -70),
        ])
      )
    );

    assert.deepEqual(sampleTriangleMesh(result.mesh, Number.NaN, 50), {
      status: 'INVALID_QUERY',
      reason: 'Les coordonnées de requête doivent être finies.',
    });
  });
});


function vertex(sourceId: string, xPx: number, yPx: number, rssi: number): GeometryPoint {
  return { sourceId, xPx, yPx, rssi };
}

function makeTriangle(rssiA = -50, rssiB = -60, rssiC = -70): TriangleVertices {
  return {
    a: vertex('a', 0, 0, rssiA),
    b: vertex('b', 100, 0, rssiB),
    c: vertex('c', 0, 100, rssiC),
  };
}

describe('interpolation barycentrique RSSI', () => {
  it('préserve exactement le RSSI réel à chacun des trois sommets', () => {
    const triangle = makeTriangle(-50, -60, -70);
    const cases = [
      { point: { xPx: 0, yPx: 0 }, expected: -50 },
      { point: { xPx: 100, yPx: 0 }, expected: -60 },
      { point: { xPx: 0, yPx: 100 }, expected: -70 },
    ];

    for (const { point, expected } of cases) {
      const result = interpolateBarycentric(point, triangle);
      assert.equal(result.status, 'INTERPOLATED');
      if (result.status !== 'INTERPOLATED') continue;
      assert.equal(result.rssi, expected);
      assert.ok(
        Math.abs(result.lambdaA + result.lambdaB + result.lambdaC - 1) <= 1e-9,
        'La somme des poids barycentriques doit valoir 1.'
      );
    }
  });

  it("calcule la moyenne pondérée au milieu d'une arête", () => {
    const triangle = makeTriangle(-50, -60, -70);
    const result = interpolateBarycentric({ xPx: 50, yPx: 0 }, triangle);

    assert.equal(result.status, 'INTERPOLATED');
    if (result.status !== 'INTERPOLATED') return;
    assert.ok(Math.abs(result.lambdaA - 0.5) <= 1e-9);
    assert.ok(Math.abs(result.lambdaB - 0.5) <= 1e-9);
    assert.ok(Math.abs(result.lambdaC) <= 1e-9);
    assert.ok(Math.abs(result.rssi - -55) <= 1e-9);
  });

  it("calcule le RSSI au centre du triangle avec les poids barycentriques", () => {
    const triangle = makeTriangle(-50, -60, -70);
    const result = interpolateBarycentric({ xPx: 100 / 3, yPx: 100 / 3 }, triangle);

    assert.equal(result.status, 'INTERPOLATED');
    if (result.status !== 'INTERPOLATED') return;
    assert.ok(Math.abs(result.lambdaA - 1 / 3) <= 1e-9);
    assert.ok(Math.abs(result.lambdaB - 1 / 3) <= 1e-9);
    assert.ok(Math.abs(result.lambdaC - 1 / 3) <= 1e-9);
    assert.ok(Math.abs(result.rssi - -60) <= 1e-9);
  });

  it('ne retourne aucune valeur hors du triangle', () => {
    const result = interpolateBarycentric({ xPx: 100, yPx: 100 }, makeTriangle());

    assert.deepEqual(result, { status: 'OUTSIDE', rssi: null });
  });

  it("ne retourne aucune interpolation pour un triangle dégénéré", () => {
    const degenerate: TriangleVertices = {
      a: vertex('a', 0, 0, -50),
      b: vertex('b', 50, 50, -60),
      c: vertex('c', 100, 100, -70),
    };
    const result = interpolateBarycentric({ xPx: 25, yPx: 25 }, degenerate);

    assert.deepEqual(result, { status: 'DEGENERATE', rssi: null });
  });

  it('interpole correctement des RSSI négatifs', () => {
    const triangle = makeTriangle(-30, -90, -120);
    const result = interpolateBarycentric({ xPx: 100 / 3, yPx: 100 / 3 }, triangle);

    assert.equal(result.status, 'INTERPOLATED');
    if (result.status !== 'INTERPOLATED') return;
    assert.ok(Math.abs(result.rssi - -80) <= 1e-9);
  });

  it('conserve une valeur constante quand les trois RSSI sont identiques', () => {
    const triangle = makeTriangle(-70, -70, -70);
    const result = interpolateBarycentric({ xPx: 10, yPx: 20 }, triangle);

    assert.equal(result.status, 'INTERPOLATED');
    if (result.status !== 'INTERPOLATED') return;
    assert.ok(Math.abs(result.rssi - -70) <= 1e-9);
  });

  it('rejette des entrées invalides sans inventer de valeur', () => {
    const invalidPoint = interpolateBarycentric({ xPx: Number.NaN, yPx: 0 }, makeTriangle());
    assert.equal(invalidPoint.status, 'INVALID');
    assert.equal(invalidPoint.rssi, null);

    const invalidRssi = interpolateBarycentric(
      { xPx: 10, yPx: 10 },
      makeTriangle(-50, -60, -128)
    );
    assert.equal(invalidRssi.status, 'INVALID');
    assert.equal(invalidRssi.rssi, null);
  });
});


describe('audit mathématique de l’interpolation', () => {
  it('ne conserve que des triangles d’aire strictement positive', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          measurement('a', 0.1, 0.1, -50),
          measurement('b', 0.9, 0.1, -60),
          measurement('c', 0.5, 0.9, -70),
          measurement('d', 0.2, 0.7, -65),
        ])
      )
    );

    assert.ok(result.mesh.triangles.length > 0);
    for (const triangle of result.mesh.triangles) {
      assert.ok(Number.isFinite(triangle.area2));
      assert.ok(triangle.area2 > 0);
    }
  });

  it('préserve exactement les sommets d’un triangle quelconque', () => {
    const triangle: TriangleVertices = {
      a: vertex('a', 17.3, 23.9, -51),
      b: vertex('b', 913.7, 154.2, -63),
      c: vertex('c', 401.1, 877.4, -78),
    };
    const cases = [
      { point: { xPx: triangle.a.xPx, yPx: triangle.a.yPx }, expected: triangle.a.rssi },
      { point: { xPx: triangle.b.xPx, yPx: triangle.b.yPx }, expected: triangle.b.rssi },
      { point: { xPx: triangle.c.xPx, yPx: triangle.c.yPx }, expected: triangle.c.rssi },
    ];

    for (const { point, expected } of cases) {
      const result = interpolateBarycentric(point, triangle);
      assert.equal(result.status, 'INTERPOLATED');
      if (result.status !== 'INTERPOLATED') continue;
      assert.ok(Object.is(result.rssi, expected));
    }
  });

  it('garde le RSSI interpolé dans l’intervalle des trois sommets', () => {
    const triangle = makeTriangle(-50, -60, -70);
    const min = -70;
    const max = -50;

    for (let a = 0; a <= 10; a += 1) {
      for (let b = 0; b <= 10 - a; b += 1) {
        const lambdaA = a / 10;
        const lambdaB = b / 10;
        const lambdaC = 1 - lambdaA - lambdaB;
        const point = {
          xPx: lambdaA * triangle.a.xPx + lambdaB * triangle.b.xPx + lambdaC * triangle.c.xPx,
          yPx: lambdaA * triangle.a.yPx + lambdaB * triangle.b.yPx + lambdaC * triangle.c.yPx,
        };
        const result = interpolateBarycentric(point, triangle);

        assert.equal(result.status, 'INTERPOLATED');
        if (result.status !== 'INTERPOLATED') continue;
        assert.ok(Math.abs(result.lambdaA + result.lambdaB + result.lambdaC - 1) <= 1e-9);
        assert.ok(result.rssi >= min - 1e-9);
        assert.ok(result.rssi <= max + 1e-9);
      }
    }
  });

  it('ne calcule aucune valeur pour des points extérieurs au triangle', () => {
    const triangle = makeTriangle();
    const outside = [
      { xPx: 100.0001, yPx: 0 },
      { xPx: 0, yPx: 100.0001 },
      { xPx: -0.0001, yPx: 0 },
      { xPx: 50.0001, yPx: 50.0001 },
      { xPx: 100, yPx: 100 },
    ];

    for (const point of outside) {
      assert.deepEqual(interpolateBarycentric(point, triangle), {
        status: 'OUTSIDE',
        rssi: null,
      });
    }
  });

  it('rejette un triangle dont les sommets sont colinéaires', () => {
    const collinear: TriangleVertices = {
      a: vertex('a', 10, 10, -50),
      b: vertex('b', 40, 40, -60),
      c: vertex('c', 90, 90, -70),
    };
    assert.deepEqual(interpolateBarycentric({ xPx: 30, yPx: 30 }, collinear), {
      status: 'DEGENERATE',
      rssi: null,
    });
  });

  it('refuse un plan différent du périmètre du maillage', () => {
    const result = triangulateRssi({
      ...makeInput([
        measurement('a', 0.1, 0.1, -50),
        measurement('b', 0.9, 0.1, -60),
        measurement('c', 0.5, 0.9, -70),
      ]),
      plan: { id: 'other-plan', width: 100, height: 100 },
    });

    assert.equal(result.status, 'INVALID_INPUT');
    if (result.status !== 'INVALID_INPUT') return;
    assert.ok(result.issues.some((issue) => issue.code === 'INVALID_PLAN'));
  });
});


describe('audit de la variante numérique de rasterisation', () => {
  it('reste équivalente à l’interpolation de référence', () => {
    const triangle = makeTriangle(-50, -60, -70);
    const prepared = prepareBarycentricTriangle(triangle);
    assert.equal(prepared.status, 'READY');
    if (prepared.status !== 'READY') return;

    for (let x = -10; x <= 110; x += 5) {
      for (let y = -10; y <= 110; y += 5) {
        const reference = interpolatePreparedTriangle({ xPx: x, yPx: y }, prepared);
        const fast = rssiAtPreparedTriangle(x, y, prepared);

        if (reference.status === 'INTERPOLATED') {
          assert.ok(fast !== null);
          assert.ok(Math.abs(fast - reference.rssi) <= 1e-9);
        } else {
          assert.equal(fast, null);
        }
      }
    }
  });
});

describe('support des triangles', () => {
  it('marque tous les triangles d’une grille régulière comme supportés', () => {
    const result = expectReady(
      triangulateRssi(makeInput(gridMeasurements(4, 0.05, 0.1)))
    );

    assert.ok(result.mesh.triangles.length > 0);
    for (const triangle of result.mesh.triangles) {
      assert.equal(triangle.supported, true);
    }
  });

  it('marque comme non supportés les triangles reliant un point très éloigné', () => {
    const result = expectReady(
      triangulateRssi(
        makeInput([
          ...gridMeasurements(4, 0.05, 0.1),
          measurement('far', 0.95, 0.9, -90),
        ])
      )
    );

    const touchesFar = (triangle: (typeof result.mesh.triangles)[number]) =>
      triangle.a.sourceId === 'far' ||
      triangle.b.sourceId === 'far' ||
      triangle.c.sourceId === 'far';

    const withFar = result.mesh.triangles.filter(touchesFar);
    const withoutFar = result.mesh.triangles.filter(
      (triangle) => !touchesFar(triangle)
    );

    assert.ok(withFar.length > 0);
    for (const triangle of withFar) {
      assert.equal(triangle.supported, false);
    }

    assert.ok(withoutFar.length > 0);
    for (const triangle of withoutFar) {
      assert.equal(triangle.supported, true);
    }
  });
});
