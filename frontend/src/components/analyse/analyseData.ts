export type AnalyseMetricId = 'rssi' | 'bssid' | 'canal' | 'position';

export type Verdict = 'bon' | 'moyen' | 'mauvais' | null;

/** Verdict global d'une métrique : interprétation de TOUTES ses mesures. */
export interface MetricVerdict {
  metrique: AnalyseMetricId;
  verdict: Verdict;
}

/** Verdict stocké par métrique (un seul choix à la fois par métrique). */
export type VerdictsByMetric = Record<AnalyseMetricId, Verdict>;

/** Cellule de grille : consultation seule (RSSI, X/Y, BSSID). */
export interface AnalyseCell {
  rssi: number;
  /** Coordonnées normalisées 0..1 (affichées en %). */
  x: number;
  y: number;
  bssid: string;
  canal: number;
}

export const METRICS: Array<{ id: AnalyseMetricId; label: string }> = [
  { id: 'rssi', label: 'RSSI' },
  { id: 'bssid', label: 'BSSID' },
  { id: 'canal', label: 'Canal' },
  { id: 'position', label: 'Position X/Y' },
];

export const VERDICT_META: Array<{
  id: Exclude<Verdict, null>;
  label: string;
  dot: string;
}> = [
  { id: 'bon', label: 'Bon', dot: 'bg-[#10b981]' },
  { id: 'moyen', label: 'Moyen', dot: 'bg-[#f59e0b]' },
  { id: 'mauvais', label: 'Mauvais', dot: 'bg-[#f87171]' },
];

export function verdictLabel(v: Exclude<Verdict, null>): string {
  return v === 'bon' ? 'Bon' : v === 'moyen' ? 'Moyen' : 'Mauvais';
}

export function initialVerdicts(): VerdictsByMetric {
  return { rssi: null, bssid: null, canal: null, position: null };
}

function bssid(suffix: string): string {
  return `AA:BB:CC:DD:EE:${suffix}`;
}

/** Jeu de démo déterministe : 9 cellules pour la grille 3×3. */
export function initialCells(): AnalyseCell[] {
  return [
    { rssi: -48, x: 0.12, y: 0.18, bssid: bssid('01'), canal: 1 },
    { rssi: -55, x: 0.5, y: 0.15, bssid: bssid('02'), canal: 6 },
    { rssi: -63, x: 0.85, y: 0.2, bssid: bssid('03'), canal: 6 },
    { rssi: -58, x: 0.15, y: 0.52, bssid: bssid('04'), canal: 11 },
    { rssi: -67, x: 0.5, y: 0.5, bssid: bssid('05'), canal: 6 },
    { rssi: -72, x: 0.85, y: 0.52, bssid: bssid('06'), canal: 3 },
    { rssi: -61, x: 0.12, y: 0.85, bssid: bssid('07'), canal: 11 },
    { rssi: -78, x: 0.5, y: 0.88, bssid: bssid('08'), canal: 9 },
    { rssi: -84, x: 0.86, y: 0.86, bssid: bssid('09'), canal: 6 },
  ];
}

export function averageCanal(cells: AnalyseCell[]): number {
  if (cells.length === 0) return 0;
  return Math.round(cells.reduce((sum, c) => sum + c.canal, 0) / cells.length);
}
