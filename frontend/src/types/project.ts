export interface AccessPoint {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface ScanPoint {
  id: string;
  planId: string;
  x: number;
  y: number;
  createdAt: string;
  /** Résumé du dernier scan enregistré à ce point, si présent */
  lastScan?: {
    id: string;
    scannedAt: string;
    mode: string;
    networkCount: number;
  } | null;
}

export interface PlanMeta {
  name: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
}
