import { useMemo } from 'react';
import { ImageOverlay } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';

export interface CoveragePoint {
  /** Coordonnées normalisées 0-1 (comme HeatmapRow.x / .y). */
  x: number;
  y: number;
  /** Valeur mesurée (RSSI dBm, débit Mb/s...), unité portée par `bands`. */
  value: number;
}

export interface CoverageBand {
  /** Seuil inclus : une valeur appartient à la première bande avec value >= min. */
  min: number;
  color: string;
}

interface CoverageOverlayProps {
  points: CoveragePoint[];
  width: number;
  height: number;
  /** Rayon de lissage en pixels du plan (échelle que la pastille de mesure). */
  radius: number;
  bounds: LatLngBoundsExpression;
  /** Échelle triée du meilleur au plus faible ; la dernière bande attrape tout le reste. */
  bands: CoverageBand[];
  /** Opacité maximale du champ (0-1). */
  opacity?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Champ de couverture interpolé (IDW régularisé, comme l'upstream
 * wifi-heatmapper) mais quantifié en bandes : on obtient des zones
 * nettes et lisibles façon UniFi Design Center plutôt qu'un dégradé flou.
 */
function createCoverageImage(
  points: CoveragePoint[],
  width: number,
  height: number,
  radius: number,
  bands: CoverageBand[],
  opacity: number
): string {
  const rgbBands = bands.map((band) => ({ min: band.min, rgb: hexToRgb(band.color) }));
  const fallback = rgbBands[rgbBands.length - 1].rgb;

  const scale = Math.min(1, 360 / Math.max(width, height));
  const imageWidth = Math.max(2, Math.round(width * scale));
  const imageHeight = Math.max(2, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const context = canvas.getContext('2d');
  if (!context) return '';

  const image = context.createImageData(imageWidth, imageHeight);
  const samples = points.map((point) => ({
    x: point.x * width,
    y: (1 - point.y) * height,
    value: point.value,
  }));
  const smoothingDistance = Math.max(radius * 0.35, 1);
  const supportDistance = Math.max(radius * 3, Math.min(width, height) * 0.12);
  const maxAlpha = Math.round(255 * opacity);

  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const planX = (x / (imageWidth - 1)) * width;
      const planY = (y / (imageHeight - 1)) * height;
      let weightedValue = 0;
      let totalWeight = 0;
      let nearestDistance = Infinity;

      for (const sample of samples) {
        const dx = planX - sample.x;
        const dy = planY - sample.y;
        const distanceSquared = dx * dx + dy * dy;
        nearestDistance = Math.min(nearestDistance, Math.sqrt(distanceSquared));
        const weight = 1 / (distanceSquared + smoothingDistance ** 2);
        weightedValue += sample.value * weight;
        totalWeight += weight;
      }

      if (nearestDistance > supportDistance || totalWeight === 0) continue;

      const value = weightedValue / totalWeight;
      let rgb = fallback;
      for (const band of rgbBands) {
        if (value >= band.min) {
          rgb = band.rgb;
          break;
        }
      }

      // Noyau opaque, fondu doux sur le tiers extérieur : les bandes
      // restent franches mais le champ ne s'arrête pas au mur.
      const t = nearestDistance / supportDistance;
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const pixelIndex = (y * imageWidth + x) * 4;
      image.data[pixelIndex] = rgb[0];
      image.data[pixelIndex + 1] = rgb[1];
      image.data[pixelIndex + 2] = rgb[2];
      image.data[pixelIndex + 3] = Math.round(maxAlpha * fade);
    }
  }

  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export function CoverageOverlay({
  points,
  width,
  height,
  radius,
  bounds,
  bands,
  opacity = 0.75,
}: CoverageOverlayProps) {
  const imageUrl = useMemo(
    () =>
      points.length > 0
        ? createCoverageImage(points, width, height, radius, bands, opacity)
        : '',
    [points, width, height, radius, bands, opacity]
  );

  if (!imageUrl) return null;
  return <ImageOverlay url={imageUrl} bounds={bounds} />;
}
