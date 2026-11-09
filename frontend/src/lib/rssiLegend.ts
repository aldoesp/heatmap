import { RSSI_MAX, RSSI_MIN } from './heatmapColours.js';
import { RSSI_BANDS } from './signal.js';

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 48;
const MIN_LABEL_SIZE = 12;

export interface RssiLegendLayout {
  legendHeight: number;
  padding: number;
  titleSize: number;
  labelSize: number;
  titleGap: number;
  barHeight: number;
  labelGap: number;
  tickLength: number;
}

export function rssiLegendLayout(
  width: number,
  height: number,
): RssiLegendLayout {
  const minSide = Math.max(1, Math.min(width, height));
  const base = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, Math.round(minSide / 40)),
  );
  const titleSize = Math.round(base * 1.15);
  const labelSize = Math.max(MIN_LABEL_SIZE, Math.round(base * 0.9));
  const padding = Math.max(12, Math.round(base * 1.2));
  const barHeight = Math.max(10, Math.round(base * 0.9));
  const titleGap = Math.max(6, Math.round(base * 0.5));
  const labelGap = Math.max(6, Math.round(base * 0.6));
  const tickLength = Math.max(4, Math.round(base * 0.25));
  return {
    legendHeight:
      padding +
      titleSize +
      titleGap +
      barHeight +
      tickLength +
      labelGap +
      labelSize +
      padding,
    padding,
    titleSize,
    labelSize,
    titleGap,
    barHeight,
    labelGap,
    tickLength,
  };
}

export function rssiLegendThresholds(): number[] {
  const thresholds = new Set<number>([RSSI_MIN, RSSI_MAX]);
  for (const band of RSSI_BANDS) {
    if (
      Number.isFinite(band.min) &&
      band.min > RSSI_MIN &&
      band.min < RSSI_MAX
    ) {
      thresholds.add(band.min);
    }
  }
  return [...thresholds].sort((a, b) => a - b);
}

export function selectLegendTicks(
  values: readonly number[],
  maxLabels: number,
): number[] {
  if (values.length <= maxLabels) return [...values];
  if (maxLabels <= 2) return [values[0], values[values.length - 1]];

  const selected = new Set<number>();
  const step = (values.length - 1) / (maxLabels - 1);
  for (let index = 0; index < maxLabels; index += 1) {
    selected.add(values[Math.round(index * step)]);
  }
  return [...selected].sort((a, b) => a - b);
}

export function formatRssiTick(value: number): string {
  return String(Math.round(value)).replace('-', '−');
}
