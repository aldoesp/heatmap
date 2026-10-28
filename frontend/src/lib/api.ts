import {
  ApiError,
  type GatewayHeatmapRow,
  type HeatmapRow,
  type NetworkInfo,
  type PlanResponse,
  type SaveScanResponse,
  type ScanDetailResponse,
  type ScanHistoryEntry,
  type ScanPointResponse,
  type SimulationScenario,
  type SpeedHeatmapRow,
  type UploadPlanResponse,
} from '../types/api';
import type { RadioParams } from '../types/wifi';
import type { AccessPoint } from '../types/plan';
import type { PlanPolygon } from '../types/polygon';
import type { NormalizedCoord } from './coords';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/**
 * Résout une URL relative renvoyée par le backend en URL absolue
 * utilisable dans un <img src>. En dev, le proxy Vite s'occupe de /uploads.
 */
export function resolveImageUrl(imageUrl: string): string {
  if (/^https?:\/\//i.test(imageUrl) || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  const base = API_BASE.replace(/\/$/, '');
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${base}${path}`;
}

async function parseError(res: Response): Promise<never> {
  let message = `Échec de la requête (${res.status}).`;
  let code: string | undefined;
  try {
    const data = (await res.json()) as { message?: string; error?: string; code?: string };
    if (data?.message) message = data.message;
    else if (data?.error) message = data.error;
    code = data?.code;
  } catch {
    /* réponse non JSON : on garde le message générique */
  }
  throw new ApiError(message, res.status, code);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(
      'Impossible de contacter le serveur. Vérifie ta connexion.',
      0,
      'network'
    );
  }
  if (!res.ok) await parseError(res);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('Réponse serveur illisible.', res.status, 'invalid-json');
  }
}

function withResolvedImage<T extends { imageUrl: string }>(plan: T): T {
  return { ...plan, imageUrl: resolveImageUrl(plan.imageUrl) };
}

/* ==========================================================================
   Plans
   ========================================================================== */

/**
 * Envoie une image de plan au backend.
 * Ne définit PAS manuellement Content-Type : le navigateur ajoute
 * la boundary multipart automatiquement.
 */
export async function uploadPlanImage(file: File): Promise<UploadPlanResponse> {
  const form = new FormData();
  form.append('image', file);

  const data = await apiFetch<UploadPlanResponse>('/api/v1/plans', {
    method: 'POST',
    body: form,
  });

  if (
    typeof data?.id !== 'string' ||
    !data.id ||
    typeof data.imageUrl !== 'string' ||
    !data.imageUrl ||
    typeof data.fileName !== 'string' ||
    !data.fileName ||
    !Number.isSafeInteger(data.width) ||
    data.width <= 0 ||
    !Number.isSafeInteger(data.height) ||
    data.height <= 0 ||
    !Number.isSafeInteger(data.sizeBytes) ||
    data.sizeBytes <= 0
  ) {
    throw new ApiError('Réponse serveur incomplète.', 502, 'invalid-shape');
  }

  return {
    id: data.id,
    name: typeof data.name === 'string' && data.name ? data.name : data.fileName,
    imageUrl: resolveImageUrl(data.imageUrl),
    fileName: data.fileName,
    width: data.width,
    height: data.height,
    sizeBytes: data.sizeBytes,
  };
}

export async function listPlans(): Promise<PlanResponse[]> {
  const plans = await apiFetch<PlanResponse[]>('/api/v1/plans');
  return plans.map(withResolvedImage);
}

export async function getPlan(id: string): Promise<PlanResponse> {
  return withResolvedImage(
    await apiFetch<PlanResponse>(`/api/v1/plans/${encodeURIComponent(id)}`)
  );
}

export async function renamePlan(id: string, name: string): Promise<PlanResponse> {
  return withResolvedImage(
    await apiFetch<PlanResponse>(`/api/v1/plans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  );
}

export async function deletePlan(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/plans/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Enregistre (ou remplace) l'échelle du plan, en mètres par pixel. */
export async function calibratePlan(
  id: string,
  metersPerPixel: number,
): Promise<PlanResponse> {
  return apiFetch<PlanResponse>(
    `/api/v1/plans/${encodeURIComponent(id)}/calibration`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metersPerPixel }),
    },
  );
}

/* ==========================================================================
   Points d'accès
   ========================================================================== */

export async function listAccessPoints(planId: string): Promise<AccessPoint[]> {
  return apiFetch<AccessPoint[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/access-points`
  );
}

export async function createAccessPoint(
  planId: string,
  input: { name: string; x: number; y: number }
): Promise<AccessPoint> {
  return apiFetch<AccessPoint>(
    `/api/v1/plans/${encodeURIComponent(planId)}/access-points`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
}

export async function updateAccessPoint(
  apId: string,
  patch: Partial<Pick<AccessPoint, 'name' | 'x' | 'y'>>
): Promise<AccessPoint> {
  return apiFetch<AccessPoint>(
    `/api/v1/plans/access-points/${encodeURIComponent(apId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteAccessPoint(apId: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/access-points/${encodeURIComponent(apId)}`,
    { method: 'DELETE' }
  );
}

/* ==========================================================================
   Zones de délimitation (polygones dessinés sur le plan)
   ========================================================================== */

interface PlanPolygonRow {
  id: string;
  plan_id: string;
  vertices: Array<{ x: number; y: number }>;
  created_at: string;
  updated_at: string;
}

function toPlanPolygon(row: PlanPolygonRow): PlanPolygon {
  return {
    id: row.id,
    planId: row.plan_id,
    vertices: Array.isArray(row.vertices)
      ? row.vertices.map(({ x, y }) => ({ x, y }))
      : [],
  };
}

export async function listPolygons(planId: string): Promise<PlanPolygon[]> {
  const rows = await apiFetch<PlanPolygonRow[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/polygons`
  );
  return rows.map(toPlanPolygon);
}

export async function createPolygon(
  planId: string,
  vertices: NormalizedCoord[]
): Promise<PlanPolygon> {
  const row = await apiFetch<PlanPolygonRow>(
    `/api/v1/plans/${encodeURIComponent(planId)}/polygons`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    }
  );
  return toPlanPolygon(row);
}

export async function updatePolygon(
  polygonId: string,
  vertices: NormalizedCoord[]
): Promise<PlanPolygon> {
  const row = await apiFetch<PlanPolygonRow>(
    `/api/v1/plans/polygons/${encodeURIComponent(polygonId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    }
  );
  return toPlanPolygon(row);
}

export async function deletePolygon(polygonId: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/polygons/${encodeURIComponent(polygonId)}`,
    { method: 'DELETE' }
  );
}

/* ==========================================================================
   Scénarios de simulation (copie indépendante d'un AP réel)
   ========================================================================== */

export async function listSimulationScenarios(
  planId: string,
): Promise<SimulationScenario[]> {
  return apiFetch<SimulationScenario[]>(
    `/api/v1/simulation-scenarios?plan_id=${encodeURIComponent(planId)}`,
  );
}

export async function createSimulationScenario(input: {
  plan_id: string;
  sourceAccessPointId: string;
  name?: string;
  radio: RadioParams;
}): Promise<SimulationScenario> {
  return apiFetch<SimulationScenario>('/api/v1/simulation-scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateSimulationScenario(
  id: string,
  patch: {
    name?: string;
    currentX?: number;
    currentY?: number;
    radio?: RadioParams;
  },
): Promise<SimulationScenario> {
  return apiFetch<SimulationScenario>(
    `/api/v1/simulation-scenarios/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
}

/** Restaure la position et la radio initiales du scénario (jamais l'AP réel). */
export async function resetSimulationScenario(
  id: string,
): Promise<SimulationScenario> {
  return apiFetch<SimulationScenario>(
    `/api/v1/simulation-scenarios/${encodeURIComponent(id)}/reset`,
    { method: 'POST' },
  );
}

export async function deleteSimulationScenario(id: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/simulation-scenarios/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/* ==========================================================================
   Relevés Wi-Fi
   ========================================================================== */

export async function listScanPoints(planId: string): Promise<ScanPointResponse[]> {
  return apiFetch<ScanPointResponse[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/scan-points`
  );
}

export async function createScanPoint(
  planId: string,
  x: number,
  y: number
): Promise<ScanPointResponse> {
  return apiFetch<ScanPointResponse>(
    `/api/v1/plans/${encodeURIComponent(planId)}/scan-points`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    }
  );
}

export async function deleteScanPoint(
  planId: string,
  pointId: string
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/${encodeURIComponent(planId)}/scan-points/${encodeURIComponent(pointId)}`,
    { method: 'DELETE' }
  );
}

/** Met à jour un point de scan (note et/ou activation). */
export async function updateScanPoint(
  planId: string,
  pointId: string,
  patch: { note?: string; is_enabled?: 0 | 1 }
): Promise<ScanPointResponse> {
  return apiFetch<ScanPointResponse>(
    `/api/v1/plans/${encodeURIComponent(planId)}/scan-points/${encodeURIComponent(pointId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );
}

/** Lance un scan à un point et l'enregistre (observations incluses). */
export async function saveScanAtPoint(pointId: string): Promise<SaveScanResponse> {
  return apiFetch<SaveScanResponse>(
    `/api/v1/scan/scan-points/${encodeURIComponent(pointId)}/scans`,
    { method: 'POST' }
  );
}

/* ==========================================================================
   Historique & heatmap
   ========================================================================== */

export async function getHistory(planId: string): Promise<ScanHistoryEntry[]> {
  return apiFetch<ScanHistoryEntry[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/history`
  );
}

export async function getScanDetail(scanId: string): Promise<ScanDetailResponse> {
  return apiFetch<ScanDetailResponse>(
    `/api/v1/scan/scans/${encodeURIComponent(scanId)}`
  );
}

export async function getHeatmap(
  planId: string,
  filter?: { ssid?: string; bssid?: string; connected?: boolean; band?: '2.4' | '5' | '6' }
): Promise<HeatmapRow[]> {
  const params = new URLSearchParams();
  if (filter?.ssid) params.set('ssid', filter.ssid);
  if (filter?.bssid) params.set('bssid', filter.bssid);
  if (filter?.connected !== undefined) {
    params.set('connected', filter.connected ? '1' : '0');
  }
  if (filter?.band) params.set('band', filter.band);
  const qs = params.toString();
  return apiFetch<HeatmapRow[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/heatmap${qs ? `?${qs}` : ''}`
  );
}

export async function getHeatmapSpeed(planId: string): Promise<SpeedHeatmapRow[]> {
  return apiFetch<SpeedHeatmapRow[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/heatmap-speed`
  );
}

export async function getHeatmapGateway(planId: string): Promise<GatewayHeatmapRow[]> {
  return apiFetch<GatewayHeatmapRow[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/heatmap-gateway`
  );
}

export async function getIperfStatus(): Promise<{ available: boolean; version: string | null }> {
  return apiFetch<{ available: boolean; version: string | null }>(
    '/api/v1/settings/iperf-status'
  );
}

export async function getNetworks(planId: string): Promise<NetworkInfo[]> {
  return apiFetch<NetworkInfo[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/networks`
  );
}

/* ==========================================================================
   Statut, réglages, mapping AP, export
   ========================================================================== */

export interface AppStatus {
  scan_mode: 'live' | 'test';
  node: string;
  platform: string;
}

export async function getStatus(): Promise<AppStatus> {
  return apiFetch<AppStatus>('/api/v1/status');
}

export interface AppSettings {
  iperf_server: string;
  iperf_duration_s: string;
  scan_mode: string;
}

export interface BssidRule {
  id: string;
  bssid: string;
  name: string;
  blacklisted: boolean;
  created_at: string;
}

export async function listBssidRules(): Promise<BssidRule[]> {
  return apiFetch<BssidRule[]>('/api/v1/bssid-rules');
}

export async function createBssidRule(input: {
  bssid: string;
  name: string;
  blacklisted: boolean;
}): Promise<BssidRule> {
  return apiFetch<BssidRule>('/api/v1/bssid-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateBssidRule(
  id: string,
  patch: Partial<Pick<BssidRule, 'name' | 'blacklisted'>>
): Promise<BssidRule> {
  return apiFetch<BssidRule>(`/api/v1/bssid-rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteBssidRule(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/bssid-rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>('/api/v1/settings');
}

export async function patchSetting(
  key: keyof AppSettings,
  value: string
): Promise<{ key: string; value: string }> {
  return apiFetch<{ key: string; value: string }>('/api/v1/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

export interface ApMapping {
  id: string;
  plan_id: string;
  name: string;
  bssid: string;
  created_at: string;
}

export async function listApMappings(planId: string): Promise<ApMapping[]> {
  return apiFetch<ApMapping[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/ap-mappings`
  );
}

export async function createApMapping(
  planId: string,
  input: { name: string; bssid: string }
): Promise<ApMapping> {
  return apiFetch<ApMapping>(
    `/api/v1/plans/${encodeURIComponent(planId)}/ap-mappings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
}

export async function deleteApMapping(mappingId: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/ap-mappings/${encodeURIComponent(mappingId)}`,
    { method: 'DELETE' }
  );
}

/** URL de téléchargement CSV des relevés (ancre <a href>, pas de fetch). */
export function exportCsvUrl(planId: string): string {
  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
  return `${base}/api/v1/plans/${encodeURIComponent(planId)}/export.csv`;
}

/** URL de téléchargement de l'export complet des données (base + plans). */
export function exportAllUrl(): string {
  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
  return `${base}/api/v1/export`;
}


export interface ApPositionDto {
  bssid: string;
  x: number;
  y: number;
}

interface ApPositionRow {
  plan_id: string;
  bssid: string;
  x: number;
  y: number;
  updated_at: string;
}

function toApPosition(row: ApPositionRow): ApPositionDto {
  return { bssid: row.bssid, x: row.x, y: row.y };
}

export async function fetchApPositions(planId: string): Promise<ApPositionDto[]> {
  const rows = await apiFetch<ApPositionRow[]>(
    `/api/v1/plans/${encodeURIComponent(planId)}/aps`
  );
  return rows.map(toApPosition);
}

export async function saveApPosition(
  planId: string,
  bssid: string,
  x: number,
  y: number
): Promise<ApPositionDto> {
  const row = await apiFetch<ApPositionRow>(
    `/api/v1/plans/${encodeURIComponent(planId)}/aps/${encodeURIComponent(bssid)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    }
  );
  return toApPosition(row);
}

export async function removeApPosition(planId: string, bssid: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/${encodeURIComponent(planId)}/aps/${encodeURIComponent(bssid)}`,
    { method: 'DELETE' }
  );
}
