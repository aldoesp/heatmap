/* ==========================================================================
   Seuils RSSI réels du projet (option B : aucun seuil inventé ici).
   Source backend : backend/src/utils/wifi.utils.js (rssiToLevel).
   Source frontend : HeatmapPage.tsx et ScanConfirmDialog.tsx (rssiColor).
   ========================================================================== */

export function rssiColor(rssi: number): string {
  if (rssi >= -55) return '#10b981';
  if (rssi >= -67) return '#a3e635';
  if (rssi >= -75) return '#f59e0b';
  if (rssi >= -85) return '#f97316';
  return '#ef4444';
}

export type RssiLevel = 'excellent' | 'good' | 'fair' | 'weak' | 'very_weak';

export function rssiLevel(rssi: number): RssiLevel {
  if (rssi >= -55) return 'excellent';
  if (rssi >= -67) return 'good';
  if (rssi >= -75) return 'fair';
  if (rssi >= -85) return 'weak';
  return 'very_weak';
}

/* Badge 3 niveaux de UI-surveys.md §3, projeté sur les seuils réels :
   excellent/good -> Bon, fair -> Moyen, weak/very_weak -> Faible. */
export type Quality = 'Bon' | 'Moyen' | 'Faible';

export function qualityFromRssi(avg: number | null): Quality {
  if (avg === null) return 'Faible';
  if (avg >= -67) return 'Bon';
  if (avg >= -75) return 'Moyen';
  return 'Faible';
}

/** Un point est « faible » sous le seuil fair (< -75 dBm). */
export function isWeakRssi(rssi: number | null): boolean {
  return typeof rssi === 'number' && Number.isFinite(rssi) && rssi < -75;
}

export function average(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
