import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countDistinctVertices,
  isValidPolygon,
  polygonAreaPx2,
  polygonSelfIntersects,
} from '../src/lib/polygon.js';
import {
  clampCoord,
  dataToLatLng,
  latlngToData,
} from '../src/lib/coords.js';
import type { LatLng } from 'leaflet';

const PLAN = { width: 200, height: 100 };

describe('polygones de délimitation', () => {
  it('compte les sommets distincts et fusionne les doublons', () => {
    assert.equal(
      countDistinctVertices(
        [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.5, y: 0.9 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      3,
    );

    // Deux clics au même endroit (écart < 1 px) ne comptent qu'une fois.
    assert.equal(
      countDistinctVertices(
        [
          { x: 0.5, y: 0.5 },
          { x: 0.5 + 0.001, y: 0.5 },
          { x: 0.9, y: 0.9 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      2,
    );
  });

  it('calcule l’aire en pixels² du plan, quel que soit le sens du tracé', () => {
    const clockwise = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const counterClockwise = [...clockwise].reverse();

    assert.equal(polygonAreaPx2(clockwise, PLAN.width, PLAN.height), 20000);
    assert.equal(polygonAreaPx2(counterClockwise, PLAN.width, PLAN.height), 20000);
  });

  it('retourne une aire nulle pour moins de trois sommets', () => {
    assert.equal(polygonAreaPx2([], PLAN.width, PLAN.height), 0);
    assert.equal(
      polygonAreaPx2([{ x: 0.1, y: 0.1 }], PLAN.width, PLAN.height),
      0,
    );
    assert.equal(
      polygonAreaPx2(
        [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.9 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      0,
    );
  });

  it('valide un triangle non dégénéré', () => {
    assert.equal(
      isValidPolygon(
        [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.5, y: 0.9 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      true,
    );
  });

  it('refuse moins de trois sommets distincts', () => {
    assert.equal(
      isValidPolygon(
        [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.9 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );

    assert.equal(
      isValidPolygon(
        [
          { x: 0.2, y: 0.2 },
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.8 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );
  });

  it('refuse un tracé colinéaire', () => {
    assert.equal(
      isValidPolygon(
        [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.5 },
          { x: 0.9, y: 0.9 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );
  });

  it('refuse une aire pratiquement nulle', () => {
    assert.equal(
      isValidPolygon(
        [
          { x: 0.5, y: 0.5 },
          { x: 0.501, y: 0.5 },
          { x: 0.5, y: 0.501 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );
  });

  it('ne signale pas d’auto-intersection sur un polygone convexe ou concave', () => {
    assert.equal(
      polygonSelfIntersects(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );

    assert.equal(
      polygonSelfIntersects(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 0, y: 1 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );
  });

  it('détecte un tracé en croix (auto-intersection)', () => {
    assert.equal(
      polygonSelfIntersects(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      true,
    );
  });

  it('ignore les doublons consécutifs avant de tester les croisements', () => {
    assert.equal(
      polygonSelfIntersects(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );
  });

  it('ne teste pas d’auto-intersection sous quatre sommets', () => {
    assert.equal(
      polygonSelfIntersects(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
        PLAN.width,
        PLAN.height,
      ),
      false,
    );
  });

  it('borne les sommets aux limites de l’image du plan', () => {
    assert.deepEqual(clampCoord({ x: -0.2, y: 1.3 }), { x: 0, y: 1 });
    assert.deepEqual(clampCoord({ x: 0.4, y: 0.6 }), { x: 0.4, y: 0.6 });
  });

  it('reprojette un sommet normalisé à l’identique (zoom, déplacement, resize)', () => {
    for (const vertex of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.4321, y: 0.6789 },
    ]) {
      const latlng = dataToLatLng(vertex.x, vertex.y, PLAN.width, PLAN.height);
      const back = latlngToData(
        { lat: latlng[0], lng: latlng[1] } as unknown as LatLng,
        PLAN.width,
        PLAN.height,
      );
      assert.ok(Math.abs(back.x - vertex.x) < 1e-12);
      assert.ok(Math.abs(back.y - vertex.y) < 1e-12);
    }
  });
});
