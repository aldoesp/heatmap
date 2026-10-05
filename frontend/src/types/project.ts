export interface AccessPoint {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface ScanPoint {
  id: string;
  x: number;
  y: number;
  timestamp: number;
  measurements: null;
}

export interface PlanMeta {
  name: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PersistedProject {
  plan: PlanMeta | null;
  accessPoints: AccessPoint[];
  scanPoints: ScanPoint[];
}