import { useMemo } from 'react';
import { ImageOverlay } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import {
  chooseRasterSize,
  rasterizeRssiHybrid,
  rasterizeRssiMeshes,
} from '../../lib/heatmapRaster';
import { normalizedToPlanPixel, type NormalizedCoord } from '../../lib/coords';
import type { ApPosition } from '../../lib/pathLossModel';
import { buildZoneMask, pointInPolygonPx, type ZoneMask } from '../../lib/polygon';
import {
  createHybridField,
  type HybridField,
  type HybridSample,
} from '../../lib/rssiHybridField';
import type { InterpolationMesh } from '../../lib/triangulation';

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
  /** Mode IDW, réservé aux métriques sans triangulation (débit). */
  points?: CoveragePoint[];
  /** Maillages Delaunay RSSI, un par périmètre BSSID/survey/bande/fréquence. */
  meshes?: InterpolationMesh[];
  interpolation?: 'idw' | 'triangulation';
  width: number;
  height: number;
  /** Rayon de lissage IDW en pixels du plan. */
  radius?: number;
  bounds: LatLngBoundsExpression;
  /** Échelle triée du meilleur au plus faible ; la dernière bande attrape tout le reste. */
  bands: CoverageBand[];
  /** Opacité maximale du champ (0-1). */
  opacity?: number;
  /**
   * Zones autorisées (coordonnées normalisées, y en bas). En mode IDW, les
   * pixels hors de toutes les zones restent transparents. En mode
   * triangulation, le filtrage est déjà fait sur les triangles.
   *
   * Les zones sont filtrées par `buildZoneMask` : mêmes règles de validité que
   * `buildRssiMeshes`, pour que les couches RSSI et débit affichent
   * exactement les mêmes périmètres. Une liste non vide dont aucune zone n'est
   * valide masque tout le champ au lieu de le laisser s'afficher librement.
   */
  polygons?: ReadonlyArray<{ vertices: readonly NormalizedCoord[] }>;
  /** Positions d'AP normalisées 0-1, une par BSSID. */
  apPositions?: ReadonlyArray<{ bssid: string; x: number; y: number }>;
  accessPoints?: ReadonlyArray<{ id: string; x: number; y: number; bssids?: string[] }>;
  /** Affiche les valeurs extrapolées par le modèle de propagation. */
  showEstimated?: boolean;
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
  opacity: number,
  polygons: ReadonlyArray<{ vertices: readonly NormalizedCoord[] }> | undefined
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

  // Zones utilisables, en pixels du plan (y en bas) : même filtre que la
  // contrainte de triangulation. `hasZones` signale qu'une liste de zones a
  // bien été fournie, même si aucune n'est valide.
  const zoneList = polygons ?? [];
  const hasZones = zoneList.length > 0;
  const masks: ZoneMask[] = [];
  for (const zone of zoneList) {
    const mask = buildZoneMask(zone.vertices, width, height);
    if (mask) masks.push(mask);
  }

  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const planX = (x / (imageWidth - 1)) * width;
      const planY = (y / (imageHeight - 1)) * height;
      // La boucle est en repère image (y vers le bas) : on ramène y dans le
      // repère du plan pour l'inclusion dans les masques.
      const planYPx = height - planY;

      if (hasZones) {
        // Zones fournies mais toutes invalides : rien ne doit s'afficher,
        // comme côté RSSI où `constrained` interdit le maillage global.
        if (masks.length === 0) continue;
        const allowed = masks.some(
          (mask) =>
            planX >= mask.minX &&
            planX <= mask.maxX &&
            planYPx >= mask.minY &&
            planYPx <= mask.maxY &&
            pointInPolygonPx(planX, planYPx, mask.pixels)
        );
        if (!allowed) continue;
      }

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

function findApForMesh(
  mesh: InterpolationMesh,
  apPositions: readonly { bssid: string; x: number; y: number }[],
  accessPoints: readonly { id: string; x: number; y: number; bssids?: string[] }[] = []
): ApPosition | null {
  const bssid = mesh.scope.bssid.trim().toLowerCase();
  const position = apPositions.find(
    (ap) => ap.bssid.trim().toLowerCase() === bssid
  );
  if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
    return normalizedToPlanPixel(position.x, position.y, mesh.width, mesh.height);
  }
  // 2) AP whose bssids contains BSSID
  const ap = accessPoints.find((a) =>
    (a.bssids ?? []).some((b) => b.trim().toLowerCase() === bssid)
  );
  if (ap) {
    return normalizedToPlanPixel(ap.x, ap.y, mesh.width, mesh.height);
  }
  // 3) nearest AP by euclidean distance in plan pixels to max rssi point
  if (accessPoints.length > 0 && mesh.points.length > 0) {
    let maxIdx = 0;
    let maxRssi = mesh.points[0].rssi;
    for (let i = 1; i < mesh.points.length; i++) {
      if (mesh.points[i].rssi > maxRssi) {
        maxRssi = mesh.points[i].rssi;
        maxIdx = i;
      }
    }
    const pt = mesh.points[maxIdx];
    const px = pt.xPx;
    const py = pt.yPx;
    let best: any = null;
    let bestDist = Infinity;
    for (const a of accessPoints) {
      const apPx = normalizedToPlanPixel(a.x, a.y, mesh.width, mesh.height);
      const dx = apPx.x - px;
      const dy = apPx.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = apPx;
      }
    }
    if (best) return best;
  }
  return null;
}

function createZoneMaskPredicate(
  polygons: ReadonlyArray<{ vertices: readonly NormalizedCoord[] }>,
  width: number,
  height: number
): (xPx: number, yPx: number) => boolean {
  const masks: ZoneMask[] = [];
  for (const zone of polygons) {
    const mask = buildZoneMask(zone.vertices, width, height);
    if (mask) masks.push(mask);
  }
  if (masks.length === 0) return () => false;

  return (xPx, yPx) =>
    masks.some(
      (mask) =>
        xPx >= mask.minX &&
        xPx <= mask.maxX &&
        yPx >= mask.minY &&
        yPx <= mask.maxY &&
        pointInPolygonPx(xPx, yPx, mask.pixels)
    );
}

function combineHybridFields(fields: HybridField[]): HybridField {
  return {
    model: null,
    sample(xPx: number, yPx: number): HybridSample {
      let best: HybridSample | null = null;
      let bestRssi = Number.NEGATIVE_INFINITY;
      for (const field of fields) {
        const sample = field.sample(xPx, yPx);
        if (sample.status === 'NO_DATA') continue;
        if (sample.rssi > bestRssi) {
          bestRssi = sample.rssi;
          best = sample;
        }
      }
      return best ?? { status: 'NO_DATA', rssi: null };
    },
  };
}

function createTriangulatedCoverageImage(
  meshes: InterpolationMesh[],
  width: number,
  height: number,
  bands: CoverageBand[],
  opacity: number,
  polygons: ReadonlyArray<{ vertices: readonly NormalizedCoord[] }> | undefined,
  apPositions: readonly { bssid: string; x: number; y: number }[],
  accessPoints: readonly { id: string; x: number; y: number; bssids?: string[] }[] = [],
  showEstimated: boolean
): string {
  const size = chooseRasterSize(width, height);
  const hasZones = (polygons?.length ?? 0) > 0;
  const apForMesh = hasZones
    ? meshes.map((mesh) => findApForMesh(mesh, apPositions, accessPoints))
    : [];

  let raster;
  if (hasZones && apForMesh.some((ap) => ap !== null)) {
    const fields = meshes.map((mesh, index) =>
      createHybridField(mesh, { ap: apForMesh[index] })
    );
    raster = rasterizeRssiHybrid(
      combineHybridFields(fields),
      createZoneMaskPredicate(polygons ?? [], width, height),
      width,
      height,
      size.width,
      size.height,
      bands,
      opacity,
      showEstimated
    );
  } else {
    raster = rasterizeRssiMeshes(
      meshes,
      width,
      height,
      size.width,
      size.height,
      bands,
      opacity
    );
  }
  if (!raster || raster.coveredPixels === 0) return '';

  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
  return canvas.toDataURL('image/png');
}

export function CoverageOverlay({
  points,
  meshes,
  interpolation = 'idw',
  width,
  height,
  radius,
  bounds,
  bands,
  opacity = 0.75,
  polygons,
  apPositions,
  accessPoints,
  showEstimated = true,
}: CoverageOverlayProps) {
  const imageUrl = useMemo(() => {
    if (interpolation === 'triangulation') {
      return meshes && meshes.length > 0
        ? createTriangulatedCoverageImage(
            meshes,
            width,
            height,
            bands,
            opacity,
            polygons,
             apPositions ?? [],
             accessPoints ?? [],
             showEstimated
          )
        : '';
    }
    return points && points.length > 0 && radius !== undefined
      ? createCoverageImage(
          points,
          width,
          height,
          radius,
          bands,
          opacity,
          polygons
        )
      : '';
  }, [
    interpolation,
    points,
    meshes,
    width,
    height,
    radius,
    bands,
    opacity,
    polygons,
    apPositions,
    accessPoints,
    showEstimated,
  ]);

  if (!imageUrl) return null;
  return <ImageOverlay url={imageUrl} bounds={bounds} />;
}
