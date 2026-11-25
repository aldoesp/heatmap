import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createHeatmapRender } from '../src/lib/heatmapRender.js';
import { buildRssiMeshes } from '../src/lib/heatmapRssi.js';
import { buildRegularizedRssiField } from '../src/lib/regularizedRssi.js';
import { rasterizeRegularizedRssi } from '../src/lib/regularizedRaster.js';
import { chooseRasterSize } from '../src/lib/heatmapRaster.js';
import { input } from './phase2-fixture.js';

function measure<T>(fn: () => T) {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

const { plan, measurements, polygons, lut, showEstimated } = input;
const display = chooseRasterSize(plan.width, plan.height, 512);
const triangulate = measure(() => buildRssiMeshes(measurements, plan, { polygons }));
const field = measure(() => buildRegularizedRssiField(measurements, plan, polygons, triangulate.value.meshes));
const raster = measure(() => rasterizeRegularizedRssi(
  field.value, plan.width, plan.height, display.width, display.height, lut, showEstimated,
));
const render = measure(() => createHeatmapRender(input));
const hybrid = measure(() => createHeatmapRender({ ...input, calculation: 'hybrid' }));
const exported = measure(() => createHeatmapRender({ ...input, maxRasterDimension: 2048 }));
const images = { raster: raster.value, render: render.value.image, hybrid: hybrid.value.image, export: exported.value.image };

console.log(JSON.stringify({
  times: { triangulate: triangulate.ms, field: field.ms, raster: raster.ms, render: render.ms, hybrid: hybrid.ms, export: exported.ms },
  dimensions: { display: [display.width, display.height], export: [images.export.width, images.export.height] },
  hashes: Object.fromEntries(Object.entries(images).map(([name, image]) => [
    name, createHash('sha256').update(image.data).digest('hex'),
  ])),
  coveredPixels: images.raster.coveredPixels,
}, null, 2));
