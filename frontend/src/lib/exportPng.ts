import type { HeatmapImage } from './heatmapRender.js';
import { rssiToPosition } from './heatmapColours.js';
import {
  measurementPointRadius,
  measurementPointToRegionCanvas,
  selectVisibleMeasurementPoints,
  type MeasurementPoint,
} from './exportPoints.js';
import {
  fullPlanRegion,
  planRegionIsExportable,
  planRegionToSourceRect,
  type PlanRegion,
} from './exportRegion.js';
import {
  buildExportMetadataFields,
  exportMetadataLayout,
  truncateText,
  type ExportMetadataField,
  type ExportMetadataLayout,
  type HeatmapExportMetadata,
} from './exportMetadata.js';
import {
  formatRssiTick,
  rssiLegendLayout,
  rssiLegendThresholds,
  selectLegendTicks,
} from './rssiLegend.js';

export interface PlanPngExportOptions {
  planImageUrl: string;
  heatmapImageUrl?: string;
  /** Raster haute résolution déjà calculé ; prioritaire sur `heatmapImageUrl`. */
  heatmapImage?: HeatmapImage;
  width: number;
  height: number;
  opacity?: number;
  fileName: string;
  rssiLut: Uint8ClampedArray;
  metadata: HeatmapExportMetadata;
  measurementPoints?: readonly MeasurementPoint[];
  showMeasurementPoints?: boolean;
  /** Région du plan à exporter ; par défaut, le plan complet. */
  region?: PlanRegion;
}

const MAX_EXPORT_CANVAS_PIXELS = 40_000_000;
const MAX_EXPORT_CANVAS_SIDE = 16_384;

interface LoadedImage {
  image: HTMLImageElement;
  release: () => void;
}

function loadImageElement(
  url: string,
  label: string,
  crossOrigin: boolean,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Impossible de charger ${label}.`));
    image.src = url;
  });
}

async function loadImage(url: string, label: string): Promise<LoadedImage> {
  if (!url) throw new Error(`${label} indisponible.`);

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    const image = await loadImageElement(url, label, false);
    return { image, release: () => undefined };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Impossible de charger ${label} (HTTP ${response.status}).`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await loadImageElement(objectUrl, label, false);
      return { image, release: () => URL.revokeObjectURL(objectUrl) };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  } catch (error) {
    try {
      const image = await loadImageElement(url, label, true);
      return { image, release: () => undefined };
    } catch {
      throw error instanceof Error
        ? error
        : new Error(`Impossible de charger ${label}.`);
    }
  }
}

function rasterToCanvas(image: HeatmapImage): HTMLCanvasElement {
  if (
    !Number.isSafeInteger(image.width) ||
    image.width <= 0 ||
    !Number.isSafeInteger(image.height) ||
    image.height <= 0
  ) {
    throw new Error('Raster de couverture invalide.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Le rendu canvas est indisponible.');

  context.putImageData(
    new ImageData(image.data, image.width, image.height),
    0,
    0,
  );
  if (image.contours.length) {
    context.strokeStyle = 'rgba(255,255,255,0.7)';
    context.lineWidth = 0.6;
    context.beginPath();
    for (const line of image.contours) {
      context.moveTo(...line.a);
      context.lineTo(...line.b);
    }
    context.stroke();
  }
  return canvas;
}

function drawMeasurementPoints(
  context: CanvasRenderingContext2D,
  planWidth: number,
  planHeight: number,
  region: PlanRegion,
  points: readonly MeasurementPoint[],
  visible: boolean,
): void {
  const shown = selectVisibleMeasurementPoints(visible, points);
  if (!shown.length) return;

  const radius = measurementPointRadius(region.width, region.height);
  const regionPoints = shown
    .map((point) =>
      measurementPointToRegionCanvas(point, planWidth, planHeight, region),
    )
    .filter((point): point is { x: number; y: number } => point !== null);
  if (!regionPoints.length) return;

  context.save();
  context.beginPath();
  for (const canvasPoint of regionPoints) {
    context.moveTo(canvasPoint.x + radius, canvasPoint.y);
    context.arc(
      canvasPoint.x,
      canvasPoint.y,
      radius,
      0,
      Math.PI * 2,
    );
  }
  context.fillStyle = '#0d1319';
  context.fill();
  context.lineWidth = Math.max(1, radius * 0.5);
  context.strokeStyle = 'rgba(255,255,255,0.95)';
  context.stroke();
  context.restore();
}

function drawMetadata(
  context: CanvasRenderingContext2D,
  width: number,
  top: number,
  fields: readonly ExportMetadataField[],
  layout: ExportMetadataLayout,
): void {
  const columnWidth = Math.max(
    1,
    (width - layout.padding * 2 - layout.columnGap * (layout.columns - 1)) /
      layout.columns,
  );

  context.save();
  context.fillStyle = '#0d1319';
  context.fillRect(0, top, width, layout.height);

  context.strokeStyle = 'rgba(255,255,255,0.18)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, top + 0.5);
  context.lineTo(width, top + 0.5);
  context.stroke();

  context.textBaseline = 'top';
  fields.forEach((field, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const x = layout.padding + column * (columnWidth + layout.columnGap);
    const y = top + layout.padding + row * layout.rowHeight;
    const label = `${field.label} :`;
    context.font = `${layout.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = '#8b98a5';
    context.textAlign = 'left';
    context.fillText(label, x, y);
    const valueX = x + context.measureText(label).width + layout.fontSize * 0.45;
    const value = truncateText(
      field.value,
      x + columnWidth - valueX,
      (text) => context.measureText(text).width,
    );
    context.fillStyle = '#e6edf3';
    context.font = `600 ${layout.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    context.fillText(value, valueX, y);
  });
  context.restore();
}

function drawRssiLegend(
  context: CanvasRenderingContext2D,
  width: number,
  top: number,
  planHeight: number,
  rssiLut: Uint8ClampedArray,
): void {
  const layout = rssiLegendLayout(width, planHeight);
  const background = '#0d1319';
  const barWidth = Math.max(1, width - layout.padding * 2);
  const barX = layout.padding;
  const titleY = top + layout.padding;
  const barY = titleY + layout.titleSize + layout.titleGap;
  const labelY =
    barY + layout.barHeight + layout.tickLength + layout.labelGap;

  context.save();
  context.fillStyle = background;
  context.fillRect(0, top, width, layout.legendHeight);

  context.strokeStyle = 'rgba(255,255,255,0.18)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, top + 0.5);
  context.lineTo(width, top + 0.5);
  context.stroke();

  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillStyle = '#e6edf3';
  context.font = `600 ${layout.titleSize}px ui-sans-serif, system-ui, sans-serif`;
  context.fillText('Couverture RSSI (dBm)', barX, titleY);

  const gradient = context.createLinearGradient(barX, 0, barX + barWidth, 0);
  for (let index = 0; index <= 255; index += 1) {
    const offset = index * 4;
    gradient.addColorStop(
      index / 255,
      `rgba(${rssiLut[offset]}, ${rssiLut[offset + 1]}, ${rssiLut[offset + 2]}, ${rssiLut[offset + 3] / 255})`,
    );
  }
  context.fillStyle = gradient;
  context.fillRect(barX, barY, barWidth, layout.barHeight);

  context.strokeStyle = 'rgba(255,255,255,0.25)';
  context.lineWidth = Math.max(1, Math.round(layout.labelSize / 18));
  context.strokeRect(
    barX + 0.5,
    barY + 0.5,
    Math.max(0, barWidth - 1),
    Math.max(0, layout.barHeight - 1),
  );

  const thresholds = rssiLegendThresholds();
  for (const value of thresholds) {
    const x = barX + rssiToPosition(value) * barWidth;
    context.strokeStyle = 'rgba(255,255,255,0.55)';
    context.lineWidth = Math.max(1, Math.round(layout.labelSize / 18));
    context.beginPath();
    context.moveTo(x, barY + layout.barHeight);
    context.lineTo(x, barY + layout.barHeight + layout.tickLength);
    context.stroke();
  }

  const maxLabels = Math.max(
    2,
    Math.floor(barWidth / (layout.labelSize * 3.4)),
  );
  const labels = selectLegendTicks(thresholds, maxLabels);
  context.fillStyle = '#cbd5e1';
  context.font = `${layout.labelSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  for (const value of labels) {
    const x = barX + rssiToPosition(value) * barWidth;
    context.textAlign =
      value === labels[0]
        ? 'left'
        : value === labels[labels.length - 1]
          ? 'right'
          : 'center';
    context.fillText(formatRssiTick(value), x, labelY);
  }
  context.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Impossible de générer le fichier PNG.'));
      }, 'image/png');
    } catch {
      reject(new Error('Impossible de générer le fichier PNG.'));
    }
  });
}

const DOWNLOAD_WARNING_SIZE = 50 * 1024 * 1024;

export function downloadBlob(blob: Blob, fileName: string): boolean {
  if (blob.size > DOWNLOAD_WARNING_SIZE) {
    const mo = (blob.size / (1024 * 1024)).toFixed(1);
    if (!window.confirm(`Le fichier dépasse 50 Mo (${mo} Mo). Télécharger quand même ?`)) return false;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function planPngFileName(planName: string): string {
  const base = planName
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'heatmap'}-heatmap.png`;
}

export async function createPlanPngBlob({
  planImageUrl,
  heatmapImageUrl,
  heatmapImage,
  width,
  height,
  opacity = 1,
  rssiLut,
  metadata,
  measurementPoints = [],
  showMeasurementPoints = true,
  region = fullPlanRegion(width, height),
}: PlanPngExportOptions): Promise<Blob> {
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new Error('Dimensions du plan invalides.');
  }
  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new Error('Dimensions du plan invalides.');
  }
  if (!(rssiLut instanceof Uint8ClampedArray) || rssiLut.length < 256 * 4) {
    throw new Error('Palette RSSI invalide.');
  }
  if (!planRegionIsExportable(region, width, height)) throw new Error('La zone visible ne contient aucune partie du plan.');
  const outputWidth = region.width;
  const metadataFields = buildExportMetadataFields(metadata);
  const metadataLayout = exportMetadataLayout(outputWidth, region.height, metadataFields.length);
  const legend = rssiLegendLayout(outputWidth, region.height);
  const outputHeight = region.height + metadataLayout.height + legend.legendHeight;
  if (outputWidth > MAX_EXPORT_CANVAS_SIDE || outputHeight > MAX_EXPORT_CANVAS_SIDE || outputWidth * outputHeight > MAX_EXPORT_CANVAS_PIXELS) {
    throw new Error('Plan trop grand pour un export mémoire sûr.');
  }
  if (!heatmapImage && !heatmapImageUrl) {
    throw new Error('Couverture RSSI indisponible.');
  }

  const plan = await loadImage(planImageUrl, 'l’image du plan');
  let heatmapSource: CanvasImageSource | null = null;
  let releaseHeatmap: () => void = () => undefined;

  let canvas: HTMLCanvasElement | null = null;
  try {
    if (heatmapImage) {
      const rasterCanvas = rasterToCanvas(heatmapImage);
      heatmapSource = rasterCanvas;
      releaseHeatmap = () => {
        rasterCanvas.width = 0;
        rasterCanvas.height = 0;
      };
    } else if (heatmapImageUrl) {
      const heatmap = await loadImage(heatmapImageUrl, 'la couverture RSSI');
      heatmapSource = heatmap.image;
      releaseHeatmap = heatmap.release;
    }
    if (!heatmapSource) throw new Error('Couverture RSSI indisponible.');

    canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Le rendu canvas est indisponible.');

    try {
      context.clearRect(0, 0, outputWidth, outputHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const source = planRegionToSourceRect(region, width, height, plan.image.naturalWidth, plan.image.naturalHeight);
      context.drawImage(plan.image, source.x, source.y, source.width, source.height, 0, 0, outputWidth, region.height);

      context.globalAlpha = Math.max(0, Math.min(1, opacity));
      const heatmapWidth = heatmapImage?.width ?? (heatmapSource as HTMLImageElement).naturalWidth;
      const heatmapHeight = heatmapImage?.height ?? (heatmapSource as HTMLImageElement).naturalHeight;
      const crop = planRegionToSourceRect(region, width, height, heatmapWidth, heatmapHeight);
      context.drawImage(heatmapSource, crop.x, crop.y, crop.width, crop.height, 0, 0, outputWidth, region.height);
      context.globalAlpha = 1;

      drawMeasurementPoints(
        context,
        width,
        height,
        region,
        measurementPoints,
        showMeasurementPoints,
      );

      const metadataTop = region.height;
      drawMetadata(context, outputWidth, metadataTop, metadataFields, metadataLayout);
      drawRssiLegend(
        context,
        outputWidth,
        metadataTop + metadataLayout.height,
        region.height,
        rssiLut,
      );
    } catch {
      throw new Error(
        'Mémoire insuffisante pour composer l’export PNG. Réduis la taille du plan.'
      );
    }

    return await canvasToBlob(canvas);
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    plan.release();
    releaseHeatmap();
  }
}

export async function exportPlanPng(options: PlanPngExportOptions): Promise<void> {
  downloadBlob(await createPlanPngBlob(options), options.fileName);
}
