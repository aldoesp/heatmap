import { apiGroup, apiKey } from './apiRead.js';

export type ScanScope = { planId: string; pointId: string };

type PlanFamily =
  | 'history' | 'heatmap' | 'networks' | 'speed' | 'gateway' | 'points'
  | 'access-points' | 'polygons' | 'ap-mappings' | 'ap-positions' | 'simulation';

const measurementFamilies = ['history', 'heatmap', 'networks', 'speed', 'gateway'] satisfies PlanFamily[];

export const planReadKey = (family: PlanFamily, planId: string, variant = 'all') =>
  apiKey(family, 'plan', planId, variant);
export const planReadGroup = (family: PlanFamily, planId?: string) =>
  planId === undefined ? apiGroup(family, 'plan') : apiGroup(family, 'plan', planId);

export const apiKeys = {
  plans: apiKey('plans', 'all'),
  plan: (id: string) => apiKey('plan', id, 'detail'),
  scan: (id: string, scope?: ScanScope) => scope
    ? apiKey('scan', 'plan', scope.planId, scope.pointId, id, 'detail')
    : apiKey('scan', 'id', id, 'detail'),
  bssidRules: apiKey('bssid', 'rules', 'all'),
  bssidSeen: apiKey('bssid', 'seen', 'all'),
  settings: apiKey('settings', 'all'),
};

function scanCascade(planId: string, pointId?: string) {
  const planSegments = ['scan', 'plan', planId];
  if (pointId !== undefined) planSegments.push(pointId);
  return [apiGroup(...planSegments), apiGroup('scan', 'id')];
}

export const apiInvalidation = {
  plan: (id: string) => [apiKeys.plans, apiKeys.plan(id)],
  deletePlan: (id: string) => [
    apiKeys.plans, apiKeys.plan(id), apiKeys.bssidSeen,
    ...([...measurementFamilies, 'points', 'access-points', 'polygons', 'ap-mappings', 'ap-positions', 'simulation'] as const)
      .map(family => planReadGroup(family, id)),
    ...scanCascade(id),
  ],
  measurements: (planId?: string) => [
    ...measurementFamilies.map(family => planReadGroup(family, planId)),
    apiKeys.bssidSeen,
  ],
  point: (planId: string, changesEnabled = false) => [
    planReadGroup('points', planId), planReadGroup('history', planId),
    ...(changesEnabled ? [
      planReadGroup('heatmap', planId), planReadGroup('speed', planId), planReadGroup('gateway', planId),
    ] : []),
  ],
  deletePoint: (planId: string, pointId: string) => [
    planReadGroup('points', planId),
    ...measurementFamilies.map(family => planReadGroup(family, planId)),
    apiKeys.bssidSeen, ...scanCascade(planId, pointId),
  ],
  bssidRules: [
    apiKeys.bssidRules, apiKeys.bssidSeen, apiGroup('scan'),
    ...(['history', 'heatmap', 'networks'] as const).map(family => planReadGroup(family)),
  ],
};
