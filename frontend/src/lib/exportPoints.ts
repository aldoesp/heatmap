import { normalizedToPlanPixel } from './coords.js';
import type { PlanRegion } from './exportRegion.js';

export interface MeasurementPoint {
  x: number;
  y: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function measurementPointToCanvas(
  point: MeasurementPoint,
  width: number,
  height: number,
): CanvasPoint {
  const { xPx, yPx } = normalizedToPlanPixel(
    point.x,
    point.y,
    width,
    height,
  );
  return { x: xPx, y: height - yPx };
}

export function selectVisibleMeasurementPoints(
  visible: boolean,
  points: readonly MeasurementPoint[],
): readonly MeasurementPoint[] {
  return visible ? points : [];
}

/** Position canvas du point, ou `null` s'il est hors de la région exportée. */
export function measurementPointToRegionCanvas(
  point: MeasurementPoint,
  planWidth: number,
  planHeight: number,
  region: PlanRegion,
): CanvasPoint | null {
  const canvasPoint = measurementPointToCanvas(point, planWidth, planHeight);
  if (
    canvasPoint.x < region.x ||
    canvasPoint.x > region.x + region.width ||
    canvasPoint.y < region.y ||
    canvasPoint.y > region.y + region.height
  ) {
    return null;
  }
  return {
    x: canvasPoint.x - region.x,
    y: canvasPoint.y - region.y,
  };
}

export function measurementPointRadius(width: number, height: number): number {
  const minSide = Math.max(1, Math.min(width, height));
  return Math.max(3, Math.min(18, Math.round(minSide / 250)));
}
