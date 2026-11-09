import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  measurementPointRadius,
  measurementPointToCanvas,
  selectVisibleMeasurementPoints,
} from '../src/lib/exportPoints.js';

const POINTS = [
  { x: 0.25, y: 0.1 },
  { x: 0.75, y: 0.9 },
];

describe('points de mesure de l’export PNG', () => {
  it('convertit les coordonnées normalisées et inverse l’axe Y', () => {
    assert.deepEqual(measurementPointToCanvas({ x: 0, y: 0 }, 100, 50), {
      x: 0,
      y: 50,
    });
    assert.deepEqual(measurementPointToCanvas({ x: 1, y: 1 }, 100, 50), {
      x: 100,
      y: 0,
    });
    assert.deepEqual(measurementPointToCanvas({ x: 0.5, y: 0.25 }, 100, 50), {
      x: 50,
      y: 37.5,
    });
  });

  it('respecte la visibilité des points', () => {
    assert.deepEqual(selectVisibleMeasurementPoints(true, POINTS), POINTS);
    assert.deepEqual(selectVisibleMeasurementPoints(false, POINTS), []);
  });

  it('adapte le rayon des points à la taille du PNG', () => {
    assert.equal(measurementPointRadius(400, 300), 3);
    assert.equal(measurementPointRadius(4000, 3000), 12);
    assert.equal(measurementPointRadius(10000, 8000), 18);
  });
});
