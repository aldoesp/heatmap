import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRssiTick,
  rssiLegendLayout,
  rssiLegendThresholds,
  selectLegendTicks,
} from '../src/lib/rssiLegend.js';

describe('légende RSSI de l’export PNG', () => {
  it('reprend les seuils de signal de l’application', () => {
    assert.deepEqual(rssiLegendThresholds(), [-100, -85, -75, -67, -55, -40]);
  });

  it('garde les extrémités et limite le nombre de libellés', () => {
    const values = rssiLegendThresholds();
    assert.deepEqual(selectLegendTicks(values, 6), values);
    const compact = selectLegendTicks(values, 3);
    assert.ok(compact.length <= 3);
    assert.equal(compact[0], values[0]);
    assert.equal(compact[compact.length - 1], values[values.length - 1]);
  });

  it('adapte la hauteur de légende aux dimensions du PNG', () => {
    const small = rssiLegendLayout(400, 300);
    const medium = rssiLegendLayout(2000, 1500);
    const large = rssiLegendLayout(10000, 8000);
    assert.ok(small.legendHeight < medium.legendHeight);
    assert.ok(medium.legendHeight < large.legendHeight);
    assert.ok(small.padding >= 12);
    assert.ok(large.titleSize <= 55);
  });

  it('affiche les dBm avec un signe moins lisible', () => {
    assert.equal(formatRssiTick(-100), '−100');
    assert.equal(formatRssiTick(-40), '−40');
  });
});
