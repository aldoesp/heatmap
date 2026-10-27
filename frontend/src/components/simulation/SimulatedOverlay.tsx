import { useMemo, useRef } from 'react';
import { useEffect } from 'react';
import { gridToRgba } from '../../lib/heatmap';
import { computeHeatmapGrid } from '../../lib/heatmap';
import { resolveAntenna } from '../../lib/antennas';
import type {
  ColorStop,
  Point,
  RadioParams,
  Surface,
} from '../../types/wifi';

interface SimulatedOverlayProps {
  /** Surface calibrée du plan, en mètres. */
  surface: Surface;
  /** Résolution demandée, en mètres par cellule. */
  resolution: number;
  /** Position de l'AP simulé, en mètres RF (y = 0 en haut). */
  ap: Point;
  radio: RadioParams;
  colorStops: readonly ColorStop[];
  /** Optionnel : remonte le temps de calcul réel de la grille (ms). */
  onComputeTiming?: (ms: number) => void;
}

/**
 * Couche de couleurs simulée superposée au plan réel.
 *
 * La grille produit par `computeHeatmapGrid` couvre EXACTEMENT la surface
 * calibrée du plan (origine haut-gauche, y vers le bas, comme l'image) :
 * un canvas étiré sur toute la boîte du plan s'aligne donc au pixel près,
 * sans conversion supplémentaire. Ce canvas n'interagit pas avec la souris.
 */
export function SimulatedOverlay({
  surface,
  resolution,
  ap,
  radio,
  colorStops,
  onComputeTiming,
}: SimulatedOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const antenna = useMemo(
    () => resolveAntenna(radio.antennaId, radio.frequencyMHz),
    [radio.antennaId, radio.frequencyMHz],
  );

  // Calcul RF pur (réutilise le moteur existant, aucune fonction dupliquée).
  const grid = useMemo(() => {
    const t0 = performance.now();
    const result = computeHeatmapGrid(surface, resolution, ap, radio, antenna);
    onComputeTiming?.(performance.now() - t0);
    return result;
  }, [surface, resolution, ap, radio, antenna, onComputeTiming]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1 pixel de couleur par cellule, puis agrandissement bilinéaire
    // (identique à HeatmapCanvas du simulateur théorique).
    const off = offscreenRef.current ?? document.createElement('canvas');
    offscreenRef.current = off;
    off.width = grid.cols;
    off.height = grid.rows;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const image = offCtx.createImageData(grid.cols, grid.rows);
    image.data.set(gridToRgba(grid, colorStops));
    offCtx.putImageData(image, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(off, 0, 0, pw, ph);
  }, [grid, colorStops]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
