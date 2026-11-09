export interface HeatmapExportMetadata {
  planName: string;
  ssid: string;
  bssid: string;
  band: string;
  calculation: string;
  exportedAt: Date;
}

export interface ExportMetadataField {
  label: string;
  value: string;
}

export interface ExportMetadataLayout {
  height: number;
  padding: number;
  fontSize: number;
  rowHeight: number;
  columns: number;
  columnGap: number;
  rows: number;
}

const MIN_FONT_SIZE = 13;
const MAX_FONT_SIZE = 42;

export function formatExportDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

export function formatWifiBand(band: string): string {
  const value = band.trim();
  if (!value) return 'Toutes';
  if (value === '2.4') return '2.4 GHz';
  if (value === '5') return '5 GHz';
  if (value === '6') return '6 GHz';
  return value;
}

export function formatCalculation(calculation: string): string {
  if (calculation === 'regularized') return 'Régularisé';
  if (calculation === 'hybrid') return 'Hybride existant';
  return calculation;
}

export function formatSelectedFilter(value: string): string {
  const trimmed = value.trim();
  return trimmed || 'Tous';
}

export function buildExportMetadataFields(
  metadata: HeatmapExportMetadata,
): ExportMetadataField[] {
  return [
    { label: 'Plan', value: metadata.planName.trim() || '—' },
    { label: 'SSID', value: formatSelectedFilter(metadata.ssid) },
    { label: 'BSSID', value: formatSelectedFilter(metadata.bssid) },
    { label: 'Bande', value: formatWifiBand(metadata.band) },
    { label: 'Calcul', value: formatCalculation(metadata.calculation) },
    { label: 'Export', value: formatExportDate(metadata.exportedAt) },
  ];
}

export function exportMetadataLayout(
  width: number,
  height: number,
  fieldCount: number,
): ExportMetadataLayout {
  const minSide = Math.max(1, Math.min(width, height));
  const base = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, Math.round(minSide / 40)),
  );
  const fontSize = Math.max(MIN_FONT_SIZE, Math.round(base * 0.95));
  const rowHeight = Math.round(fontSize * 1.55);
  const padding = Math.max(12, Math.round(base * 1.2));
  const columns = width >= 1800 ? 3 : width >= 700 ? 2 : 1;
  const columnGap = Math.round(fontSize * 1.6);
  const rows = Math.max(1, Math.ceil(fieldCount / columns));
  return {
    height: padding * 2 + rows * rowHeight,
    padding,
    fontSize,
    rowHeight,
    columns,
    columnGap,
    rows,
  };
}

export function truncateText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  if (maxWidth <= 0) return '';
  if (measure(text) <= maxWidth) return text;

  const ellipsis = '…';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(text.slice(0, middle) + ellipsis) <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}${ellipsis}` : ellipsis;
}
