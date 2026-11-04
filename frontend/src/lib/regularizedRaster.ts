import type { HybridField } from './rssiHybridField.js';
import { lutColourForRssi } from './heatmapColours.js';
import type { RssiRaster } from './heatmapRaster.js';

export interface RssiContour { level: number; a: [number, number]; b: [number, number] }
export interface RegularizedRaster extends RssiRaster { contours: RssiContour[] }

/** Marching squares in raster coordinates; never connects across missing data. */
export function rssiContours(values: Float32Array, width: number, height: number, levels = [-85, -75, -67, -55]): RssiContour[] {
  const lines: RssiContour[] = [];
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const v = [values[y * width + x], values[y * width + x + 1], values[(y + 1) * width + x + 1], values[(y + 1) * width + x]];
    if (!v.every(Number.isFinite)) continue;
    const corners: [number, number][] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    for (const level of levels) {
      const crossings: [number, number][] = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if ((v[i] < level) === (v[j] < level)) continue;
        const t = (level - v[i]) / (v[j] - v[i]);
        crossings.push([corners[i][0] + (corners[j][0] - corners[i][0]) * t, corners[i][1] + (corners[j][1] - corners[i][1]) * t]);
      }
      if (crossings.length === 4 && (v.reduce((a, b) => a + b, 0) / 4 >= level) === (v[0] < level)) crossings.push(crossings.shift()!);
      for (let i = 0; i + 1 < crossings.length; i += 2) lines.push({ level, a: crossings[i], b: crossings[i + 1] });
    }
  }
  return lines;
}

export function rasterizeRegularizedRssi(field: HybridField, planWidth: number, planHeight: number, width: number, height: number, lut: Uint8ClampedArray, showEstimated = true): RegularizedRaster {
  const values = new Float32Array(width * height).fill(NaN), data = new Uint8ClampedArray(width * height * 4);
  let coveredPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sample = field.sample(x / (width - 1) * planWidth, (1 - y / (height - 1)) * planHeight);
    if (sample.status === 'NO_DATA' || !showEstimated && sample.status === 'EXTRAPOLATED') continue;
    const i = y * width + x, offset = i * 4;
    values[i] = sample.rssi;
    const color = lutColourForRssi(lut, sample.rssi);
    const hatch = sample.status === 'EXTRAPOLATED' && (x + y) % 10 === 0;
    for (let c = 0; c < 3; c++) data[offset + c] = hatch ? Math.round(color[c] * .75 + 255 * .25) : color[c];
    data[offset + 3] = color[3];
    if (color[3]) coveredPixels++;
  }
  return { width, height, data, coveredPixels, contours: rssiContours(values, width, height) };
}
