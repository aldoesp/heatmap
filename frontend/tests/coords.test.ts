import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  imagePixelToPlanPixel,
  normalizedToPlanPixel,
  planPixelToImagePixel,
  planPixelToNormalized,
} from '../src/lib/coords.js';

describe('transformations de coordonnées', () => {
  it('convertit les coordonnées normalisées en pixels du plan (y en bas)', () => {
    assert.deepEqual(normalizedToPlanPixel(0.25, 0.75, 200, 100), {
      xPx: 50,
      yPx: 75,
    });
    assert.deepEqual(normalizedToPlanPixel(0, 0, 200, 100), {
      xPx: 0,
      yPx: 0,
    });
    assert.deepEqual(normalizedToPlanPixel(1, 1, 200, 100), {
      xPx: 200,
      yPx: 100,
    });
  });

  it('convertit les pixels du plan en coordonnées normalisées', () => {
    assert.deepEqual(planPixelToNormalized(50, 75, 200, 100), {
      x: 0.25,
      y: 0.75,
    });
  });

  it('inverse l’axe Y entre plan et image raster', () => {
    const bottom = planPixelToImagePixel(0, 0, 100, 50, 101, 51);
    const top = planPixelToImagePixel(0, 50, 100, 50, 101, 51);

    assert.deepEqual(bottom, { x: 0, y: 50 });
    assert.deepEqual(top, { x: 0, y: 0 });
  });

  it('fait un aller-retour plan → image → plan sans dérive', () => {
    const image = planPixelToImagePixel(37.5, 82.25, 200, 120, 101, 61);
    const plan = imagePixelToPlanPixel(image.x, image.y, 200, 120, 101, 61);

    assert.ok(Math.abs(plan.xPx - 37.5) < 1e-9);
    assert.ok(Math.abs(plan.yPx - 82.25) < 1e-9);
  });
});
