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
} from '../types/api.js';
import type { RadioParams } from '../types/wifi.js';
import type { AccessPoint } from '../types/plan.js';
import type { PlanPolygon } from '../types/polygon.js';
import type { NormalizedCoord } from './coords.js';

import { API_BASE, ApiRead, READ_TIMEOUT_MS, invalidateApiReads } from './apiRead.js';
import { apiInvalidation, apiKeys, planReadGroup, planReadKey, type ScanScope } from './apiKeys.js';
import { recordLocalApiMutation } from './apiSync.js';

type MutationInvalidation = Parameters<typeof invalidateApiReads>[0];
const DEFAULT_TTL_MS = 15_000;
const PLAN_TTL_MS = 30_000;
const SCAN_TTL_MS = 30_000;

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

async function apiRequest(
  path: string,
  init?: RequestInit,
  invalidation?: MutationInvalidation,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    if (invalidation) invalidateApiReads(invalidation);
    throw new ApiError(
      'Impossible de contacter le serveur. Vérifie ta connexion.',
      0,
      'network'
    );
  }
  // Un import peut être partiellement appliqué même en cas de réponse d'erreur.
  if (invalidation && (res.ok || res.status >= 500 || res.status === 408 || invalidation === 'all')) {
    invalidateApiReads(invalidation);
    // Les anciennes données peuvent contenir des dépendances croisées entre plans
    // lors d'une suppression en cascade. Le prochain poll les vérifie globalement.
    const crossPlanCascade = init?.method === 'DELETE' && /^\/api\/v1\/plans\/[^/]+(?:\/scan-points\/[^/]+)?$/.test(path);
    if (res.ok && !crossPlanCascade) recordLocalApiMutation(res);
  }
  if (!res.ok) await parseError(res);
  return res;
}

async function apiFetch<T>(path: string, init?: RequestInit, invalidation?: MutationInvalidation): Promise<T> {
  const res = await apiRequest(path, init, invalidation);
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('Réponse serveur illisible.', res.status, 'invalid-json');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson<T>(
  key: string,
  path: string,
  read: ApiRead = new ApiRead(),
  valid: (value: unknown) => boolean = isObject,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  return read.fetch<T>(key, forced => fetchReadJson(path, valid, {
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    cache: forced ? 'reload' : 'no-cache',
  }), ttlMs);
}

async function fetchReadJson<T>(path: string, valid: (value: unknown) => boolean, init: RequestInit): Promise<T> {
  const res = await apiRequest(path, init);
  const mediaType = res.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (!mediaType || !(mediaType === 'application/json' || mediaType.endsWith('+json'))) {
    throw new ApiError('Réponse serveur illisible.', res.status, 'invalid-json');
  }
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new ApiError('Réponse serveur illisible.', res.status, 'invalid-json');
  }
  if (!valid(value)) throw new ApiError('Réponse serveur incomplète.', res.status, 'invalid-shape');
  return value as T;
}

function rowsOf(valid: (row: unknown) => boolean) {
  return (value: unknown) => Array.isArray(value) && value.every(valid);
}

const objectRows = rowsOf(isObject);
const planObject = (value: unknown) => isObject(value) && typeof value.imageUrl === 'string';
const planRows = rowsOf(planObject);

function readRows<T>(key: string, path: string, read?: ApiRead): Promise<T[]> {
  return readJson<T[]>(key, path, read, objectRows);
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
  }, [apiKeys.plans]);

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

export async function listPlans(read?: ApiRead): Promise<PlanResponse[]> {
  const plans = await readJson<PlanResponse[]>(apiKeys.plans, '/api/v1/plans', read, planRows, PLAN_TTL_MS);
  return plans.map(withResolvedImage);
}

export async function getPlan(id: string, read?: ApiRead): Promise<PlanResponse> {
  const path = `/api/v1/plans/${encodeURIComponent(id)}`;
  return withResolvedImage(await readJson<PlanResponse>(apiKeys.plan(id), path, read, planObject, PLAN_TTL_MS));
}

export async function renamePlan(id: string, name: string): Promise<PlanResponse> {
  return withResolvedImage(
    await apiFetch<PlanResponse>(`/api/v1/plans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }, apiInvalidation.plan(id))
  );
}

export async function deletePlan(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/plans/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, apiInvalidation.deletePlan(id));
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
    apiInvalidation.plan(id),
  );
}

/* ==========================================================================
   Points d'accès
   ========================================================================== */

export async function listAccessPoints(planId: string, read?: ApiRead): Promise<AccessPoint[]> {
  return readRows<AccessPoint>(
    planReadKey('access-points', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/access-points`,
    read,
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
    },
    [planReadGroup('access-points', planId)],
  );
}

export async function updateAccessPoint(
  apId: string,
  patch: Partial<Pick<AccessPoint, 'name' | 'x' | 'y' | 'bssids'>>,
  planId?: string,
): Promise<AccessPoint> {
  return apiFetch<AccessPoint>(
    `/api/v1/plans/access-points/${encodeURIComponent(apId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    [planReadGroup('access-points', planId)],
  );
}

export async function deleteAccessPoint(apId: string, planId?: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/access-points/${encodeURIComponent(apId)}`,
    { method: 'DELETE' },
    [planReadGroup('access-points', planId), planReadGroup('simulation', planId)],
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

export async function listPolygons(planId: string, read?: ApiRead): Promise<PlanPolygon[]> {
  const rows = await readRows<PlanPolygonRow>(
    planReadKey('polygons', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/polygons`,
    read,
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
    },
    [planReadGroup('polygons', planId)],
  );
  return toPlanPolygon(row);
}

export async function updatePolygon(
  polygonId: string,
  vertices: NormalizedCoord[],
  planId?: string,
): Promise<PlanPolygon> {
  const row = await apiFetch<PlanPolygonRow>(
    `/api/v1/plans/polygons/${encodeURIComponent(polygonId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertices }),
    },
    [planReadGroup('polygons', planId)],
  );
  return toPlanPolygon(row);
}

export async function deletePolygon(polygonId: string, planId?: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/polygons/${encodeURIComponent(polygonId)}`,
    { method: 'DELETE' },
    [planReadGroup('polygons', planId)],
  );
}

/* ==========================================================================
   Scénarios de simulation (copie indépendante d'un AP réel)
   ========================================================================== */

export async function listSimulationScenarios(planId: string, read?: ApiRead): Promise<SimulationScenario[]> {
  return readRows<SimulationScenario>(
    planReadKey('simulation', planId),
    `/api/v1/simulation-scenarios?plan_id=${encodeURIComponent(planId)}`,
    read,
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
  }, [planReadGroup('simulation', input.plan_id)]);
}

export async function updateSimulationScenario(
  id: string,
  patch: {
    name?: string;
    currentX?: number;
    currentY?: number;
    radio?: RadioParams;
  },
  planId?: string,
): Promise<SimulationScenario> {
  return apiFetch<SimulationScenario>(
    `/api/v1/simulation-scenarios/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    [planReadGroup('simulation', planId)],
  );
}

/** Restaure la position et la radio initiales du scénario (jamais l'AP réel). */
export async function resetSimulationScenario(
  id: string,
  planId?: string,
): Promise<SimulationScenario> {
  return apiFetch<SimulationScenario>(
    `/api/v1/simulation-scenarios/${encodeURIComponent(id)}/reset`,
    { method: 'POST' },
    [planReadGroup('simulation', planId)],
  );
}

export async function deleteSimulationScenario(id: string, planId?: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/simulation-scenarios/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    [planReadGroup('simulation', planId)],
  );
}

/* ==========================================================================
   Relevés Wi-Fi
   ========================================================================== */

export async function listScanPoints(planId: string, read?: ApiRead): Promise<ScanPointResponse[]> {
  return readRows<ScanPointResponse>(
    planReadKey('points', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/scan-points`,
    read,
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
    },
    apiInvalidation.point(planId),
  );
}

export async function deleteScanPoint(
  planId: string,
  pointId: string
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/${encodeURIComponent(planId)}/scan-points/${encodeURIComponent(pointId)}`,
    { method: 'DELETE' },
    apiInvalidation.deletePoint(planId, pointId),
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
    },
    apiInvalidation.point(planId, patch.is_enabled !== undefined),
  );
}

/** Lance un scan à un point et l'enregistre (observations incluses). */
export async function saveScanAtPoint(pointId: string, planId?: string): Promise<SaveScanResponse> {
  return apiFetch<SaveScanResponse>(
    `/api/v1/scan/scan-points/${encodeURIComponent(pointId)}/scans`,
    { method: 'POST' },
    apiInvalidation.measurements(planId),
  );
}

/* ==========================================================================
   Historique & heatmap
   ========================================================================== */

export async function getHistory(planId: string, read?: ApiRead): Promise<ScanHistoryEntry[]> {
  return readRows<ScanHistoryEntry>(
    planReadKey('history', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/history`,
    read,
  );
}

export async function getScanDetail(scanId: string, read?: ApiRead, scope?: ScanScope): Promise<ScanDetailResponse> {
  return readJson<ScanDetailResponse>(
    apiKeys.scan(scanId, scope),
    `/api/v1/scan/scans/${encodeURIComponent(scanId)}`,
    read,
    value => isObject(value) && objectRows(value.observations),
    SCAN_TTL_MS,
  );
}

type HeatmapFilter = { ssid?: string; bssid?: string; connected?: boolean; band?: '2.4' | '5' | '6' };

function heatmapQuery(filter?: HeatmapFilter): string {
  const params = new URLSearchParams();
  if (filter?.ssid) params.set('ssid', filter.ssid);
  if (filter?.bssid) params.set('bssid', filter.bssid.toLowerCase());
  if (filter?.connected) params.set('connected', '1');
  if (filter?.band) params.set('band', filter.band);
  return params.toString();
}

function heatmapPath(planId: string, query: string): string {
  return `/api/v1/plans/${encodeURIComponent(planId)}/heatmap${query ? `?${query}` : ''}`;
}

export async function getHeatmap(planId: string, filter?: HeatmapFilter, read?: ApiRead): Promise<HeatmapRow[]> {
  const query = heatmapQuery(filter);
  return readRows<HeatmapRow>(
    planReadKey('heatmap', planId, query || 'all'),
    heatmapPath(planId, query),
    read,
  );
}

export async function getHeatmapForExport(planId: string, filter: HeatmapFilter, signal: AbortSignal): Promise<HeatmapRow[]> {
  return fetchReadJson(heatmapPath(planId, heatmapQuery(filter)), objectRows, {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]),
  });
}

export async function getHeatmapSpeed(planId: string, read?: ApiRead): Promise<SpeedHeatmapRow[]> {
  return readRows<SpeedHeatmapRow>(
    planReadKey('speed', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/heatmap-speed`,
    read,
  );
}

export async function getHeatmapGateway(planId: string, read?: ApiRead): Promise<GatewayHeatmapRow[]> {
  return readRows<GatewayHeatmapRow>(
    planReadKey('gateway', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/heatmap-gateway`,
    read,
  );
}

export async function getIperfStatus(): Promise<{ available: boolean; version: string | null }> {
  return apiFetch<{ available: boolean; version: string | null }>(
    '/api/v1/settings/iperf-status'
  );
}

export async function getNetworks(planId: string, read?: ApiRead): Promise<NetworkInfo[]> {
  return readRows<NetworkInfo>(
    planReadKey('networks', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/networks`,
    read,
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
  heatmap_colours: string;
}

export interface BssidRule {
  id: string;
  bssid: string;
  name: string;
  blacklisted: boolean;
  created_at: string;
}

export interface BssidSeen {
  bssid: string;
  ssid: string;
  rule_id: string | null;
  name: string;
  blacklisted: boolean;
}

export async function listBssidRules(read?: ApiRead): Promise<BssidRule[]> {
  return readRows<BssidRule>(apiKeys.bssidRules, '/api/v1/bssid-rules', read);
}

export async function listSeenBssids(read?: ApiRead): Promise<BssidSeen[]> {
  return readRows<BssidSeen>(apiKeys.bssidSeen, '/api/v1/bssid-rules/seen', read);
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
  }, apiInvalidation.bssidRules);
}

export async function updateBssidRule(
  id: string,
  patch: Partial<Pick<BssidRule, 'name' | 'blacklisted'>>
): Promise<BssidRule> {
  return apiFetch<BssidRule>(`/api/v1/bssid-rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }, apiInvalidation.bssidRules);
}

export async function deleteBssidRule(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/bssid-rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, apiInvalidation.bssidRules);
}

export async function getSettings(read?: ApiRead): Promise<AppSettings> {
  return readJson<AppSettings>(apiKeys.settings, '/api/v1/settings', read);
}

export async function patchSetting(
  key: keyof AppSettings,
  value: string
): Promise<{ key: string; value: string }> {
  return apiFetch<{ key: string; value: string }>('/api/v1/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }, [apiKeys.settings]);
}

export interface ApMapping {
  id: string;
  plan_id: string;
  name: string;
  bssid: string;
  created_at: string;
}

export async function listApMappings(planId: string, read?: ApiRead): Promise<ApMapping[]> {
  return readRows<ApMapping>(
    planReadKey('ap-mappings', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/ap-mappings`,
    read,
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
    },
    [planReadGroup('ap-mappings', planId)],
  );
}

export async function deleteApMapping(mappingId: string, planId?: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/ap-mappings/${encodeURIComponent(mappingId)}`,
    { method: 'DELETE' },
    [planReadGroup('ap-mappings', planId)],
  );
}

export type SurveyImportResolution = 'merge' | 'duplicate';

export interface SurveyImportPreviewPlan {
  id: string;
  name: string;
  existsOnDevice: boolean;
  surveyCount: number;
}

export interface SurveyImportPreviewSurvey {
  id: string;
  name: string;
  planId: string;
  existsOnDevice: boolean;
  scanPointCount: number;
  observationCount: number;
}

export interface SurveyImportPreview {
  plans: SurveyImportPreviewPlan[];
  surveys: SurveyImportPreviewSurvey[];
  bssidRuleCount: number;
}

export interface SurveyImportResult {
  importedSurveys: Array<{ id: string; name: string }>;
  skippedSurveys: Array<{ id: string; name: string; reason: string }>;
  plansCreated: number;
  plansMerged: number;
  scanPoints: number;
  scans: number;
  observations: number;
  bssidRulesAdded: number;
}

export interface SurveyExportBlob extends Blob {
  filename: string | null;
}

function contentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      return encoded[1].trim();
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(value);
  if (quoted) return quoted[1];
  const bare = /filename=([^;]+)/i.exec(value);
  return bare ? bare[1].trim() : null;
}

export async function exportPlansZip(planIds: string[]): Promise<SurveyExportBlob> {
  const params = new URLSearchParams();
  params.set('planIds', planIds.join(','));
  const res = await apiRequest(
    `/api/v1/surveys/export.zip?${params.toString()}`,
  );
  const blob = (await res.blob()) as SurveyExportBlob;
  blob.filename = contentDispositionFilename(
    res.headers.get('Content-Disposition'),
  );
  return blob;
}

export async function previewSurveyImport(file: File): Promise<SurveyImportPreview> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<SurveyImportPreview>('/api/v1/surveys/import/preview', {
    method: 'POST',
    body: form,
  });
}

export async function importSurveys(
  file: File,
  resolutions: Record<string, SurveyImportResolution>,
): Promise<SurveyImportResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('resolutions', JSON.stringify(resolutions));
  return apiFetch<SurveyImportResult>('/api/v1/surveys/import', {
    method: 'POST',
    body: form,
  }, 'all');
}

/** URL de téléchargement CSV des relevés (ancre <a href>, pas de fetch). */
export function exportCsvUrl(planId: string): string {
  const base = API_BASE;
  return `${base}/api/v1/plans/${encodeURIComponent(planId)}/export.csv`;
}

/** URL de téléchargement de l'export complet des données (base + plans). */
export function exportAllUrl(): string {
  const base = API_BASE;
  return `${base}/api/v1/export`;
}

export async function importCsvSurvey(file: File, options: { name?: string } = {}): Promise<{ planId: string; surveyId: string }> {
  const form = new FormData();
  form.append('file', file);
  if (options.name) form.append('name', options.name);
  return apiFetch<{ planId: string; surveyId: string }>('/api/v1/import/csv', {
    method: 'POST',
    body: form,
  }, 'all');
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

export async function fetchApPositions(planId: string, read?: ApiRead): Promise<ApPositionDto[]> {
  const rows = await readRows<ApPositionRow>(
    planReadKey('ap-positions', planId),
    `/api/v1/plans/${encodeURIComponent(planId)}/aps`,
    read,
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
    },
    [planReadGroup('ap-positions', planId)],
  );
  return toApPosition(row);
}

export async function removeApPosition(planId: string, bssid: string): Promise<void> {
  await apiFetch<void>(
    `/api/v1/plans/${encodeURIComponent(planId)}/aps/${encodeURIComponent(bssid)}`,
    { method: 'DELETE' },
    [planReadGroup('ap-positions', planId)],
  );
}
