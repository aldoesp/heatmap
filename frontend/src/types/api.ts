export interface UploadPlanResponse {
  id: string;
  /** Nom du plan (déduit du nom de fichier côté backend) */
  name: string;
  imageUrl: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PlanResponse {
  id: string;
  name: string;
  imageUrl: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScanPointResponse {
  id: string;
  plan_id: string;
  x: number;
  y: number;
  created_at: string;
}

export interface NetworkObservation {
  bssid: string;
  ssid: string | null;
  hidden: boolean;
  band: string;
  frequency_mhz: number;
  channel: number | null;
  bandwidth_mhz: number | null;
  center_frequency_mhz: number | null;
  center_channel: number | null;
  rssi: number;
  quality: number;
  level: string;
  security: string;
  standard: string;
  virtual_bssid: boolean;
  capabilities: string[];
  timestamp_us: number | null;
}

export interface SaveScanResponse {
  scan_id: string;
  scan_point_id: string;
  plan_id: string;
  mode: 'live' | 'test';
  scanned_at: string;
  count: number;
  rejected_count: number;
  data: NetworkObservation[];
}

export interface ScanHistoryEntry {
  id: string;
  plan_id: string;
  x: number;
  y: number;
  created_at: string;
  scans: Array<{
    id: string;
    scan_point_id: string;
    plan_id: string;
    mode: string;
    scanned_at: string;
    rejected_count: number;
    created_at: string;
    network_count: number;
  }>;
}

export interface HeatmapRow {
  scan_point_id: string;
  x: number;
  y: number;
  bssid: string;
  ssid: string | null;
  rssi: number;
  quality: number;
}

export interface NetworkInfo {
  ssid: string | null;
  bssid: string;
  scan_count: number;
  best_rssi: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
