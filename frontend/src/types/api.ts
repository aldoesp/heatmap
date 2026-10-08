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
  note: string | null;
  is_enabled: number;
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
  unreliable_bssid: boolean;
  current: boolean;
  capabilities: string[];
  timestamp_us: number | null;
}

export interface GatewayInfo {
  gatewayIp: string | null;
  medianRttMs: number | null;
  packetLossPercent: number | null;
  probesSent: number;
  probesReceived: number;
  error?: string;
}

export interface SpeedInfo {
  id: number;
  scan_id: string;
  tcp_down_bps: number | null;
  tcp_up_bps: number | null;
  duration_s: number;
  error: string | null;
  created_at: string;
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
  gateway: GatewayInfo | null;
  connection_warning: string | null;
  speed: SpeedInfo | null;
}

export interface SpeedHeatmapRow {
  scan_point_id: string;
  x: number;
  y: number;
  speed_bps: number;
}

export interface ScanHistoryEntry {
  id: string;
  plan_id: string;
  survey_id: string | null;
  x: number;
  y: number;
  note: string | null;
  is_enabled: number;
  created_at: string;
  scans: Array<{
    id: string;
    scan_point_id: string;
    plan_id: string;
    mode: string;
    scanned_at: string;
    rejected_count: number;
    gateway_ip: string | null;
    gateway_rtt_ms: number | null;
    gateway_loss_percent: number | null;
    tcp_down_bps: number | null;
    tcp_up_bps: number | null;
    created_at: string;
    network_count: number;
  }>;
}

export type ScanHistoryRecord = ScanHistoryEntry['scans'][number];

export interface ScanDetailResponse extends ScanHistoryRecord {
  observations: NetworkObservation[];
  speed: SpeedInfo | null;
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
