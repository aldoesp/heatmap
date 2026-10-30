export type ColourStop = {
  position: number;
  color: string;
  opacity: number;
};

export type HeatmapColours = {
  stops: ColourStop[];
  opacityStrongest: number;
  opacityWeakest: number;
};

export const DEFAULT_HEATMAP_COLOURS: HeatmapColours = {
  stops: [
    { position: 0, color: '#ef4444', opacity: 1 },
    { position: 0.25, color: '#f97316', opacity: 1 },
    { position: 0.42, color: '#f59e0b', opacity: 1 },
    { position: 0.55, color: '#a3e635', opacity: 1 },
    { position: 0.75, color: '#10b981', opacity: 1 },
  ],
  opacityStrongest: 0.75,
  opacityWeakest: 0.75,
};

export const RSSI_MIN = -100;
export const RSSI_MAX = -40;

export function rssiToPosition(rssi: number): number {
  if (rssi <= RSSI_MIN) {
    return 0;
  }
  if (rssi >= RSSI_MAX) {
    return 1;
  }
  const range = RSSI_MAX - RSSI_MIN;
  if (range === 0) {
    return 0;
  }
  return (rssi - RSSI_MIN) / range;
}

export function positionToRssi(p: number): number {
  const clamped = Math.max(0, Math.min(1, p));
  return RSSI_MIN + clamped * (RSSI_MAX - RSSI_MIN);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function parseColorToRgb(color: string): [number, number, number] | null {
  const hexMatch = color.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  const shortHexMatch = color.trim().match(/^#([0-9a-fA-F]{3})$/);
  if (shortHexMatch) {
    const hex = shortHexMatch[1];
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return [r, g, b];
  }
  const rgbMatch = color.trim().match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgbMatch) {
    const r = clamp01(parseInt(rgbMatch[1], 10) / 255) * 255;
    const g = clamp01(parseInt(rgbMatch[2], 10) / 255) * 255;
    const b = clamp01(parseInt(rgbMatch[3], 10) / 255) * 255;
    return [Math.round(r), Math.round(g), Math.round(b)];
  }
  const rgbaMatch = color.trim().match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i);
  if (rgbaMatch) {
    const r = clamp01(parseInt(rgbaMatch[1], 10) / 255) * 255;
    const g = clamp01(parseInt(rgbaMatch[2], 10) / 255) * 255;
    const b = clamp01(parseInt(rgbaMatch[3], 10) / 255) * 255;
    return [Math.round(r), Math.round(g), Math.round(b)];
  }
  return null;
}

export function sanitizeHeatmapColours(input: unknown): HeatmapColours {
  let stops: ColourStop[] | undefined;
  let opacityStrongest: number | undefined;
  let opacityWeakest: number | undefined;

  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.stops)) {
      const candidateStops: ColourStop[] = [];
      for (const stop of obj.stops) {
        if (!stop || typeof stop !== 'object') {
          continue;
        }
        const s = stop as Record<string, unknown>;
        if (typeof s.position !== 'number' || Number.isNaN(s.position)) {
          continue;
        }
        if (typeof s.color !== 'string') {
          continue;
        }
        if (typeof s.opacity !== 'number' || Number.isNaN(s.opacity)) {
          continue;
        }
        const rgb = parseColorToRgb(s.color);
        if (!rgb) {
          continue;
        }
        candidateStops.push({
          position: clamp01(s.position),
          color: s.color,
          opacity: clamp01(s.opacity),
        });
      }
      if (candidateStops.length > 0) {
        stops = candidateStops;
      }
    }
    if (typeof obj.opacityStrongest === 'number' && !Number.isNaN(obj.opacityStrongest)) {
      opacityStrongest = clamp01(obj.opacityStrongest);
    }
    if (typeof obj.opacityWeakest === 'number' && !Number.isNaN(obj.opacityWeakest)) {
      opacityWeakest = clamp01(obj.opacityWeakest);
    }
  }

  if (!stops) {
    return {
      stops: DEFAULT_HEATMAP_COLOURS.stops.map((s) => ({ ...s })),
      opacityStrongest: DEFAULT_HEATMAP_COLOURS.opacityStrongest,
      opacityWeakest: DEFAULT_HEATMAP_COLOURS.opacityWeakest,
    };
  }

  // Sort by position
  stops = [...stops].sort((a, b) => a.position - b.position);

  // Ensure positions are in 0..1 (already clamped)
  // Ensure min 2 stops, max 12
  if (stops.length < 2) {
    return {
      stops: DEFAULT_HEATMAP_COLOURS.stops.map((s) => ({ ...s })),
      opacityStrongest: DEFAULT_HEATMAP_COLOURS.opacityStrongest,
      opacityWeakest: DEFAULT_HEATMAP_COLOURS.opacityWeakest,
    };
  }
  if (stops.length > 12) {
    stops = stops.slice(0, 12);
  }

  return {
    stops,
    opacityStrongest: opacityStrongest ?? DEFAULT_HEATMAP_COLOURS.opacityStrongest,
    opacityWeakest: opacityWeakest ?? DEFAULT_HEATMAP_COLOURS.opacityWeakest,
  };
}

export function buildColourLut(colours: HeatmapColours): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const stops = [...colours.stops].sort((a, b) => a.position - b.position);
  const strongest = colours.opacityStrongest;
  const weakest = colours.opacityWeakest;

  for (let i = 0; i < 256; i += 1) {
    const p = i / 255;
    // Find stops to interpolate between
    let leftIdx = 0;
    for (let s = 0; s < stops.length; s += 1) {
      if (stops[s].position <= p) {
        leftIdx = s;
      } else {
        break;
      }
    }
    const rightIdx = Math.min(leftIdx + 1, stops.length - 1);
    const left = stops[leftIdx];
    const right = stops[rightIdx];

    let t = 0;
    if (right.position === left.position) {
      t = 0;
    } else {
      t = (p - left.position) / (right.position - left.position);
    }

    const leftRgb = parseColorToRgb(left.color) ?? [255, 0, 0];
    const rightRgb = parseColorToRgb(right.color) ?? leftRgb;

    const r = Math.round(leftRgb[0] + (rightRgb[0] - leftRgb[0]) * t);
    const g = Math.round(leftRgb[1] + (rightRgb[1] - leftRgb[1]) * t);
    const b = Math.round(leftRgb[2] + (rightRgb[2] - leftRgb[2]) * t);

    const leftOpacity = left.opacity;
    const rightOpacity = right.opacity;
    const stopOpacity = leftOpacity + (rightOpacity - leftOpacity) * t;
    const alpha = stopOpacity * (weakest + (strongest - weakest) * p) * 255;
    const a = Math.round(alpha);

    const idx = i * 4;
    lut[idx] = r;
    lut[idx + 1] = g;
    lut[idx + 2] = b;
    lut[idx + 3] = Math.max(0, Math.min(255, a));
  }
  return lut;
}

export function lutColourForRssi(lut: Uint8ClampedArray, rssi: number): [number, number, number, number] {
  const p = rssiToPosition(rssi);
  const idx = Math.max(0, Math.min(255, Math.round(p * 255)));
  const baseIdx = idx * 4;
  return [lut[baseIdx], lut[baseIdx + 1], lut[baseIdx + 2], lut[baseIdx + 3]];
}
