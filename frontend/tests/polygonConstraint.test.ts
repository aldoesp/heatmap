import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planPixelToImagePixel } from '../src/lib/coords.js';
import {
  buildRssiMeshes,
  findUncoveredZones,
  type RssiMeshBuildResult,
  type RssiPolygonConstraint,
} from '../src/lib/heatmapRssi.js';
import {
  rasterizeRssiMeshes,
  type RssiRaster,
} from '../src/lib/heatmapRaster.js';
import {
  buildZoneMask,
  pointInPolygonPx,
  toPolygonPixelVertices,
  triangleInsidePolygonPx,
} from '../src/lib/polygon.js';
import { RSSI_BANDS } from '../src/lib/signal.js';
import type { HeatmapRow } from '../src/types/api.js';

const PLAN = { id: 'plan-a', width: 100, height: 100 };

function row(
  scanPointId: string,
  x: number,
  y: number,
  rssi = -60
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
  };
}

const BOTTOM: RssiPolygonConstraint = {
  id: 'zone-bottom',
  vertices: [
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.45 },
    { x: 0.05, y: 0.45 },
  ],
};

const TOP: RssiPolygonConstraint = {
  id: 'zone-top',
  vertices: [
    { x: 0.3, y: 0.65 },
    { x: 0.7, y: 0.65 },
    { x: 0.7, y: 0.95 },
    { x: 0.3, y: 0.95 },
  ],
};

const BOTTOM_ROWS = [
  row('b1', 0.1, 0.1, -50),
  row('b2', 0.9, 0.1, -55),
  row('b3', 0.9, 0.4, -60),
  row('b4', 0.1, 0.4, -65),
];

const TOP_ROWS = [
  row('t1', 0.35, 0.7, -70),
  row('t2', 0.65, 0.7, -72),
  row('t3', 0.5, 0.9, -68),
];

function rasterize(model: RssiMeshBuildResult): RssiRaster {
  const raster = rasterizeRssiMeshes(
    model.meshes,
    PLAN.width,
    PLAN.height,
    101,
    101,
    RSSI_BANDS,
    0.75
  );
  assert.ok(raster);
  return raster;
}

function alphaAt(raster: RssiRaster, x: number, y: number): number {
  const image = planPixelToImagePixel(
    x * PLAN.width,
    y * PLAN.height,
    PLAN.width,
    PLAN.height,
    raster.width,
    raster.height
  );
  const ix = Math.max(0, Math.min(raster.width - 1, Math.round(image.x)));
  const iy = Math.max(0, Math.min(raster.height - 1, Math.round(image.y)));
  return raster.data[(iy * raster.width + ix) * 4 + 3];
}

function pixelVertices(polygon: RssiPolygonConstraint) {
  return toPolygonPixelVertices(polygon.vertices, PLAN.width, PLAN.height);
}

function assertAllTrianglesInside(
  model: RssiMeshBuildResult,
  polygon: RssiPolygonConstraint
): void {
  const pixels = pixelVertices(polygon);
  for (const mesh of model.meshes) {
    if (mesh.polygonId !== polygon.id) continue;
    for (const triangle of mesh.triangles) {
      assert.equal(
        triangleInsidePolygonPx(triangle.a, triangle.b, triangle.c, pixels),
        true,
        `triangle ${triangle.id} hors de ${polygon.id}`
      );
    }
  }
}

function assertPointsAreMeasurements(
  model: RssiMeshBuildResult,
  rows: HeatmapRow[]
): void {
  const measurementIds = new Set(rows.map((entry) => entry.scan_point_id));
  for (const mesh of model.meshes) {
    for (const point of mesh.points) {
      assert.ok(
        measurementIds.has(point.sourceId),
        `le point ${point.sourceId} doit être une mesure réelle`
      );
    }
  }
}

describe('polygones comme contraintes de la heatmap', () => {
  it('A. grand polygone inférieur : aucune couverture hors de la zone', () => {
    const model = buildRssiMeshes(BOTTOM_ROWS, PLAN, { polygons: [BOTTOM] });
    assert.equal(model.status, 'READY');
    assert.equal(model.meshes.length, 1);
    assert.equal(model.meshes[0].polygonId, BOTTOM.id);

    const raster = rasterize(model);
    assert.ok(alphaAt(raster, 0.5, 0.25) > 0, 'le bas doit être couvert');
    assert.equal(alphaAt(raster, 0.5, 0.8), 0);
    assert.equal(alphaAt(raster, 0.5, 0.55), 0, 'l’espace entre zones reste vide');
    assertAllTrianglesInside(model, BOTTOM);
    assertPointsAreMeasurements(model, BOTTOM_ROWS);
  });

  it('B. petit polygone supérieur : aucune couverture hors de la zone', () => {
    const model = buildRssiMeshes(TOP_ROWS, PLAN, { polygons: [TOP] });
    assert.equal(model.status, 'READY');
    assert.equal(model.meshes.length, 1);
    assert.equal(model.meshes[0].polygonId, TOP.id);

    const raster = rasterize(model);
    assert.ok(alphaAt(raster, 0.5, 0.8) > 0, 'le haut doit être couvert');
    assert.equal(alphaAt(raster, 0.5, 0.25), 0);
    assert.equal(alphaAt(raster, 0.5, 0.55), 0);
    assertAllTrianglesInside(model, TOP);
    assertPointsAreMeasurements(model, TOP_ROWS);
  });

  it('C. deux polygones indépendants : pas de triangle entre les zones', () => {
    const rows = [...BOTTOM_ROWS, ...TOP_ROWS];
    const model = buildRssiMeshes(rows, PLAN, { polygons: [BOTTOM, TOP] });

    assert.equal(model.status, 'READY');
    assert.equal(model.meshes.length, 2);
    assert.deepEqual(
      model.meshes.map((mesh) => mesh.polygonId).sort(),
      [BOTTOM.id, TOP.id].sort()
    );

    const bottomMesh = model.meshes.find((mesh) => mesh.polygonId === BOTTOM.id);
    const topMesh = model.meshes.find((mesh) => mesh.polygonId === TOP.id);
    assert.equal(bottomMesh?.points.length, BOTTOM_ROWS.length);
    assert.equal(topMesh?.points.length, TOP_ROWS.length);

    const raster = rasterize(model);
    assert.ok(alphaAt(raster, 0.5, 0.25) > 0);
    assert.ok(alphaAt(raster, 0.5, 0.8) > 0);
    assert.equal(alphaAt(raster, 0.5, 0.55), 0, 'l’espace non autorisé reste transparent');

    assertAllTrianglesInside(model, BOTTOM);
    assertAllTrianglesInside(model, TOP);
    assertPointsAreMeasurements(model, rows);

    // Sans contrainte, Delaunay relie bien les deux nuages de mesures.
    const unconstrained = buildRssiMeshes(rows, PLAN);
    assert.equal(unconstrained.meshes.length, 1);
    const forbidden = unconstrained.meshes[0].triangles.filter((triangle) => {
      const inBottom = triangleInsidePolygonPx(
        triangle.a,
        triangle.b,
        triangle.c,
        pixelVertices(BOTTOM)
      );
      const inTop = triangleInsidePolygonPx(
        triangle.a,
        triangle.b,
        triangle.c,
        pixelVertices(TOP)
      );
      return !inBottom && !inTop;
    });
    assert.ok(forbidden.length > 0, 'le maillage global doit créer des triangles interdits');
  });

  it('D. polygone concave : les triangles traversant l’échancrure sont rejetés', () => {
    const concave: RssiPolygonConstraint = {
      id: 'zone-u',
      vertices: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.6, y: 0.9 },
        { x: 0.6, y: 0.4 },
        { x: 0.4, y: 0.4 },
        { x: 0.4, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    };
    const rows = [
      row('l1', 0.15, 0.5, -50),
      row('l2', 0.35, 0.5, -52),
      row('l3', 0.35, 0.85, -54),
      row('l4', 0.15, 0.85, -56),
      row('r1', 0.65, 0.5, -58),
      row('r2', 0.85, 0.5, -60),
      row('r3', 0.85, 0.85, -62),
      row('r4', 0.65, 0.85, -64),
      row('d1', 0.2, 0.15, -66),
      row('d2', 0.8, 0.15, -68),
    ];

    const model = buildRssiMeshes(rows, PLAN, { polygons: [concave] });
    assert.equal(model.status, 'READY');
    assert.equal(model.meshes.length, 1);
    assertAllTrianglesInside(model, concave);

    const raster = rasterize(model);
    assert.ok(alphaAt(raster, 0.25, 0.7) > 0, 'le bras gauche doit être couvert');
    assert.ok(alphaAt(raster, 0.75, 0.7) > 0, 'le bras droit doit être couvert');
    assert.equal(alphaAt(raster, 0.5, 0.7), 0, 'l’échancrure reste transparente');

    const unconstrained = buildRssiMeshes(rows, PLAN);
    const pixels = pixelVertices(concave);
    const forbidden = unconstrained.meshes[0].triangles.filter(
      (triangle) =>
        !triangleInsidePolygonPx(triangle.a, triangle.b, triangle.c, pixels)
    );
    assert.ok(
      forbidden.length > 0,
      'Delaunay global doit produire des triangles traversant l’échancrure'
    );
    assert.ok(
      model.meshes[0].triangles.length < unconstrained.meshes[0].triangles.length
    );
  });

  it('E. polygone sans mesure : aucune couverture inventée', () => {
    const model = buildRssiMeshes(BOTTOM_ROWS, PLAN, {
      polygons: [BOTTOM, TOP],
    });
    assert.equal(model.meshes.length, 1);
    assert.equal(model.meshes[0].polygonId, BOTTOM.id);

    const topSkips = model.skipped.filter((entry) => entry.polygonId === TOP.id);
    assert.ok(topSkips.length > 0);
    assert.ok(topSkips.every((entry) => entry.status === 'INSUFFICIENT_POINTS'));

    const raster = rasterize(model);
    assert.ok(alphaAt(raster, 0.5, 0.25) > 0);
    assert.equal(alphaAt(raster, 0.5, 0.8), 0);
  });

  it('F. polygone avec une ou deux mesures : pas de triangulation', () => {
    for (const count of [1, 2]) {
      const rows = [...BOTTOM_ROWS, ...TOP_ROWS.slice(0, count)];
      const model = buildRssiMeshes(rows, PLAN, {
        polygons: [BOTTOM, TOP],
      });
      assert.equal(model.meshes.length, 1);
      assert.equal(model.meshes[0].polygonId, BOTTOM.id);

      const topSkips = model.skipped.filter(
        (entry) => entry.polygonId === TOP.id
      );
      assert.ok(topSkips.length > 0);
      assert.ok(
        topSkips.every((entry) => entry.status === 'INSUFFICIENT_POINTS')
      );

      const raster = rasterize(model);
      assert.ok(alphaAt(raster, 0.5, 0.25) > 0);
      assert.equal(alphaAt(raster, 0.5, 0.8), 0);
    }
  });

  it('G. triangle dont les sommets sont dedans mais qui traverse une limite', () => {
    const concavePixels = toPolygonPixelVertices(
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.6, y: 0.9 },
        { x: 0.6, y: 0.4 },
        { x: 0.4, y: 0.4 },
        { x: 0.4, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      PLAN.width,
      PLAN.height
    );
    const px = (x: number, y: number) => ({ xPx: x * 100, yPx: y * 100 });
    const a = px(0.2, 0.7);
    const b = px(0.8, 0.7);
    const c = px(0.5, 0.2);

    assert.equal(pointInPolygonPx(a.xPx, a.yPx, concavePixels), true);
    assert.equal(pointInPolygonPx(b.xPx, b.yPx, concavePixels), true);
    assert.equal(pointInPolygonPx(c.xPx, c.yPx, concavePixels), true);
    assert.equal(
      triangleInsidePolygonPx(a, b, c, concavePixels),
      false,
      'l’arête A-B traverse l’échancrure non autorisée'
    );
  });

  it('H. triangle dont le centre est dedans mais un sommet dehors', () => {
    const squarePixels = toPolygonPixelVertices(
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      PLAN.width,
      PLAN.height
    );
    const px = (x: number, y: number) => ({ xPx: x * 100, yPx: y * 100 });
    const a = px(0.2, 0.2);
    const b = px(0.8, 0.2);
    const c = px(0.5, 0.95);
    const centerX = (a.xPx + b.xPx + c.xPx) / 3;
    const centerY = (a.yPx + b.yPx + c.yPx) / 3;

    assert.equal(pointInPolygonPx(centerX, centerY, squarePixels), true);
    assert.equal(pointInPolygonPx(c.xPx, c.yPx, squarePixels), false);
    assert.equal(triangleInsidePolygonPx(a, b, c, squarePixels), false);
  });

  it('accepte un triangle entièrement contenu', () => {
    const squarePixels = toPolygonPixelVertices(
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      PLAN.width,
      PLAN.height
    );
    const px = (x: number, y: number) => ({ xPx: x * 100, yPx: y * 100 });
    assert.equal(
      triangleInsidePolygonPx(
        px(0.2, 0.2),
        px(0.8, 0.2),
        px(0.5, 0.8),
        squarePixels
      ),
      true
    );
  });
});

/* ==========================================================================
   Validité des zones : un seul critère partagé par les deux couches
   --------------------------------------------------------------------------
   `buildZoneMask` est la porte d'entrée du masque IDW (CoverageOverlay) et de
   la contrainte de triangulation (buildRssiMeshes). Les tests ci-dessous
   vérifient qu'une zone refusée l'est des deux côtés, et documentent la
   convention « bord inclus » identique pour les deux couches.
   ========================================================================== */

function assertSameRaster(
  actual: RssiRaster,
  expected: RssiRaster,
  message: string
): void {
  assert.equal(actual.width, expected.width, `${message} : largeur`);
  assert.equal(actual.height, expected.height, `${message} : hauteur`);
  assert.equal(actual.data.length, expected.data.length, `${message} : taille`);
  for (let index = 0; index < actual.data.length; index += 1) {
    if (actual.data[index] !== expected.data[index]) {
      assert.fail(
        `${message} : divergence à l'octet ${index} (${actual.data[index]} ≠ ${expected.data[index]})`
      );
    }
  }
}

describe('zones invalides, zones qui se chevauchent et retour utilisateur', () => {
  // Ruban en 8 : deux arêtes qui se croisent, aire non nulle.
  const SELF_CROSSING: RssiPolygonConstraint = {
    id: 'zone-bowtie',
    vertices: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.9, y: 0.1 },
      { x: 0.1, y: 0.9 },
    ],
  };

  // Trois sommets alignés : aire nulle.
  const COLLINEAR: RssiPolygonConstraint = {
    id: 'zone-line',
    vertices: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.9, y: 0.1 },
    ],
  };

  const OVERLAP_BOTTOM: RssiPolygonConstraint = {
    id: 'zone-overlap-bottom',
    vertices: [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.55 },
      { x: 0.05, y: 0.55 },
    ],
  };

  const OVERLAP_TOP: RssiPolygonConstraint = {
    id: 'zone-overlap-top',
    vertices: [
      { x: 0.05, y: 0.45 },
      { x: 0.95, y: 0.45 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ],
  };

  it('I. zone auto-intersectée ou dégénérée : ni maillage RSSI ni masque IDW', () => {
    for (const invalid of [SELF_CROSSING, COLLINEAR]) {
      assert.equal(
        buildZoneMask(invalid.vertices, PLAN.width, PLAN.height),
        null,
        `${invalid.id} doit être refusée par le filtre commun`
      );
      const model = buildRssiMeshes(BOTTOM_ROWS, PLAN, { polygons: [invalid] });
      assert.equal(model.meshes.length, 0, `${invalid.id} ne doit produire aucun triangle`);
      assert.notEqual(model.status, 'READY');
      assert.equal(rasterize(model).coveredPixels, 0, 'aucun pixel coloré');
    }
  });

  it('J. une zone valide à côté d’une zone invalide : seule la valide compte', () => {
    const model = buildRssiMeshes(BOTTOM_ROWS, PLAN, {
      polygons: [BOTTOM, SELF_CROSSING, COLLINEAR],
    });
    assert.equal(model.meshes.length, 1);
    assert.equal(model.meshes[0].polygonId, BOTTOM.id);
    assert.ok(buildZoneMask(BOTTOM.vertices, PLAN.width, PLAN.height));
    assert.equal(
      buildZoneMask(SELF_CROSSING.vertices, PLAN.width, PLAN.height),
      null
    );
    assertAllTrianglesInside(model, BOTTOM);
  });

  it('K. deux zones qui se chevauchent : deux maillages, aucune valeur doublée', () => {
    const shared = [
      row('o1', 0.1, 0.47, -50),
      row('o2', 0.9, 0.47, -55),
      row('o3', 0.9, 0.53, -60),
      row('o4', 0.1, 0.53, -65),
    ];

    const both = buildRssiMeshes(shared, PLAN, {
      polygons: [OVERLAP_BOTTOM, OVERLAP_TOP],
    });
    assert.equal(both.meshes.length, 2, 'chaque zone reçoit son propre maillage');
    assert.deepEqual(
      both.meshes.map((mesh) => mesh.polygonId).sort(),
      [OVERLAP_BOTTOM.id, OVERLAP_TOP.id].sort()
    );
    for (const mesh of both.meshes) {
      assert.equal(mesh.points.length, shared.length);
    }
    assertAllTrianglesInside(both, OVERLAP_BOTTOM);
    assertAllTrianglesInside(both, OVERLAP_TOP);
    assertPointsAreMeasurements(both, shared);

    // Les deux zones couvrent la même bande avec les mêmes mesures : ajouter
    // le second maillage ne doit ni moyenner ni dupliquer la valeur affichée.
    const single = buildRssiMeshes(shared, PLAN, { polygons: [OVERLAP_BOTTOM] });
    assert.equal(single.meshes.length, 1);
    assertSameRaster(
      rasterize(both),
      rasterize(single),
      'la superposition ne doit pas changer les valeurs'
    );
  });

  it('L. une mesure dans une seule des deux zones n’alimente que son maillage', () => {
    const rows = [
      row('o1', 0.1, 0.47, -50),
      row('o2', 0.9, 0.47, -55),
      row('o3', 0.9, 0.53, -60),
      row('o4', 0.1, 0.53, -65),
      row('seul-en-bas', 0.5, 0.1, -70),
    ];

    const model = buildRssiMeshes(rows, PLAN, {
      polygons: [OVERLAP_BOTTOM, OVERLAP_TOP],
    });
    const bottom = model.meshes.find((mesh) => mesh.polygonId === OVERLAP_BOTTOM.id);
    const top = model.meshes.find((mesh) => mesh.polygonId === OVERLAP_TOP.id);
    assert.ok(bottom && top, 'les deux zones doivent être maillées');
    assert.equal(bottom.points.length, rows.length);
    assert.equal(top.points.length, rows.length - 1);
    assert.ok(
      !top.points.some((point) => point.sourceId === 'seul-en-bas'),
      'la zone du haut ne doit jamais recevoir la mesure du bas'
    );
    assertAllTrianglesInside(model, OVERLAP_BOTTOM);
    assertAllTrianglesInside(model, OVERLAP_TOP);
    assertPointsAreMeasurements(model, rows);
  });

  it('M. mesures exactement sur la frontière : bord inclus, sans extrapolation', () => {
    const zone: RssiPolygonConstraint = {
      id: 'zone-border',
      vertices: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ],
    };
    const rows = [
      row('b1', 0.2, 0.2, -50),
      row('b2', 0.8, 0.2, -55),
      row('b3', 0.8, 0.8, -60),
    ];
    const pixels = toPolygonPixelVertices(zone.vertices, PLAN.width, PLAN.height);

    // Convention « bord inclus », la même pour les deux couches : c'est le
    // prédicat de `pointInPolygonPx` qui sert à la fois au filtrage des
    // mesures (RSSI) et à l'inclusion des pixels (masque IDW).
    for (const measurement of rows) {
      assert.equal(
        pointInPolygonPx(
          measurement.x * PLAN.width,
          measurement.y * PLAN.height,
          pixels
        ),
        true,
        'le bord du polygone est inclus'
      );
    }
    assert.ok(buildZoneMask(zone.vertices, PLAN.width, PLAN.height));

    const model = buildRssiMeshes(rows, PLAN, { polygons: [zone] });
    assert.equal(model.status, 'READY');
    assert.equal(model.meshes.length, 1);
    assertAllTrianglesInside(model, zone);

    const raster = rasterize(model);
    assert.ok(
      alphaAt(raster, 0.6, 0.4) > 0,
      'le triangle à cheval sur la frontière est bien coloré'
    );
    assert.equal(
      alphaAt(raster, 0.25, 0.75),
      0,
      'pas de couverture au-delà des triangles valides, même dans la zone'
    );
  });

  it('N. zone avec une seule mesure : transparente, aucun RSSI inventé', () => {
    const zone: RssiPolygonConstraint = {
      id: 'zone-solo',
      vertices: [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.3 },
        { x: 0.7, y: 0.7 },
        { x: 0.3, y: 0.7 },
      ],
    };
    const model = buildRssiMeshes([row('solo', 0.5, 0.5, -50)], PLAN, {
      polygons: [zone],
    });
    assert.equal(model.meshes.length, 0);
    assert.ok(
      model.skipped.some(
        (entry) => entry.polygonId === zone.id && entry.status === 'INSUFFICIENT_POINTS'
      ),
      'la zone doit être signalée comme non maillée'
    );

    const raster = rasterize(model);
    assert.equal(raster.coveredPixels, 0, 'aucun pixel ne doit être coloré');
    for (const [x, y] of [
      [0.5, 0.5],
      [0.35, 0.35],
      [0.65, 0.65],
    ]) {
      assert.equal(alphaAt(raster, x, y), 0);
    }
  });

  it('O. le masque IDW et la triangulation acceptent exactement les mêmes zones', () => {
    const zones = [BOTTOM, SELF_CROSSING, COLLINEAR, TOP];
    const rows = [...BOTTOM_ROWS, ...TOP_ROWS];
    const model = buildRssiMeshes(rows, PLAN, { polygons: zones });

    const accepted = new Set(
      zones
        .filter((zone) => buildZoneMask(zone.vertices, PLAN.width, PLAN.height))
        .map((zone) => zone.id)
    );
    assert.deepEqual([...accepted].sort(), [BOTTOM.id, TOP.id].sort());

    for (const mesh of model.meshes) {
      assert.ok(mesh.polygonId && accepted.has(mesh.polygonId));
    }
    assert.ok(!model.meshes.some((mesh) => mesh.polygonId === SELF_CROSSING.id));
    assert.ok(!model.meshes.some((mesh) => mesh.polygonId === COLLINEAR.id));
  });

  it('P. seule la zone non maillée est signalée, avec sa raison', () => {
    const model = buildRssiMeshes(BOTTOM_ROWS, PLAN, { polygons: [BOTTOM, TOP] });
    const uncovered = findUncoveredZones(model, [BOTTOM, TOP], PLAN);
    assert.equal(uncovered.length, 1);
    assert.equal(uncovered[0].id, TOP.id);
    assert.equal(uncovered[0].zoneNumber, 2);
    assert.equal(uncovered[0].reason, 'pas assez de mesures valides');
  });

  it('Q. aucun signalement quand tout est maillée, sans zone, ou sans mesure', () => {
    const rows = [...BOTTOM_ROWS, ...TOP_ROWS];
    const full = buildRssiMeshes(rows, PLAN, { polygons: [BOTTOM, TOP] });
    assert.deepEqual(findUncoveredZones(full, [BOTTOM, TOP], PLAN), []);
    assert.deepEqual(findUncoveredZones(full, [], PLAN), []);

    const noRows = buildRssiMeshes([], PLAN, { polygons: [BOTTOM, TOP] });
    assert.deepEqual(findUncoveredZones(noRows, [BOTTOM, TOP], PLAN), []);
  });

  it('R. raison exacte quand aucun triangle n’est admis malgré des mesures dedans', () => {
    const openZone: RssiPolygonConstraint = {
      id: 'zone-u-ouvert',
      vertices: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.6, y: 0.9 },
        { x: 0.6, y: 0.4 },
        { x: 0.4, y: 0.4 },
        { x: 0.4, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    };
    const rows = [
      row('u1', 0.2, 0.85, -50),
      row('u2', 0.8, 0.85, -55),
      row('u3', 0.5, 0.2, -60),
    ];

    const model = buildRssiMeshes(rows, PLAN, { polygons: [openZone] });
    assert.equal(model.meshes.length, 0);
    assert.equal(model.status, 'OUTSIDE_ZONE');
    assert.ok(
      model.skipped.some(
        (entry) => entry.polygonId === openZone.id && entry.status === 'OUTSIDE_ZONE'
      )
    );

    const uncovered = findUncoveredZones(model, [openZone], PLAN);
    assert.equal(uncovered.length, 1);
    assert.equal(uncovered[0].reason, 'aucun triangle entièrement dans la zone');
  });

  it('S. une zone à la géométrie invalide est signalée comme telle', () => {
    const model = buildRssiMeshes(BOTTOM_ROWS, PLAN, {
      polygons: [BOTTOM, SELF_CROSSING],
    });
    const uncovered = findUncoveredZones(model, [BOTTOM, SELF_CROSSING], PLAN);
    assert.equal(uncovered.length, 1);
    assert.equal(uncovered[0].id, SELF_CROSSING.id);
    assert.equal(uncovered[0].reason, 'géométrie de zone invalide');
  });
});
