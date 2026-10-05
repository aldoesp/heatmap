import type { LatLng } from 'leaflet';

export interface NormalizedCoord {
  x: number;
  y: number;
}

export function latlngToData(
  latlng: LatLng,
  width: number,
  height: number
): NormalizedCoord {
  return {
    x: latlng.lng / width,
    y: 1 - latlng.lat / height,
  };
}

export function dataToLatLng(
  x: number,
  y: number,
  width: number,
  height: number
): [number, number] {
  return [(1 - y) * height, x * width];
}

export function clampCoord({ x, y }: NormalizedCoord): NormalizedCoord {
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}