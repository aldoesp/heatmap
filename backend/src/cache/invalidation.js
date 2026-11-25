import { memoryCache } from './memoryCache.js';
import { buildCacheKey } from './readCache.js';

const DOMAINS = ['history', 'heatmap', 'networks', 'speed', 'analysis'];
const SEEN_PREFIX = buildCacheKey('bssid', 'seen') + ':';

export function invalidateAll() {
  memoryCache.clear();
}

// Resolve before a cascading delete, but do not let a failure block the write.
export function resolveInvalidationScope(load) {
  try {
    return load() ?? null;
  } catch {
    return null;
  }
}

// These statements are called from synchronous write paths only. Conditions are
// repository-owned SQL fragments, and identifiers are bound as parameters.
export function listAffectedPointScopes(db, condition, ...params) {
  return db.prepare(
    `SELECT DISTINCT sp.plan_id, sp.survey_id, s.plan_id AS scan_plan_id
     FROM scan_points sp
     LEFT JOIN scans s ON s.scan_point_id = sp.id
     WHERE ${condition}`
  ).all(...params);
}

export function invalidateScopes(scopes, domains = DOMAINS) {
  if (!scopes || scopes.some(scope => !scope || typeof scope.plan_id !== 'string')) {
    invalidateAll();
    return;
  }

  const prefixes = new Set();
  try {
    for (const { plan_id, survey_id, scan_plan_id } of scopes) {
      for (const domain of domains) {
        if (domain !== 'analysis') prefixes.add(buildCacheKey(domain, 'plan', plan_id) + ':');
        if (survey_id != null) prefixes.add(buildCacheKey(domain, 'survey', survey_id) + ':');
      }
      if (scan_plan_id != null && scan_plan_id !== plan_id && domains.includes('networks')) {
        prefixes.add(buildCacheKey('networks', 'plan', scan_plan_id) + ':');
      }
    }
  } catch {
    invalidateAll();
    return;
  }
  for (const prefix of prefixes) memoryCache.invalidate(prefix);
}

// A savepoint may still be rolled back by an outer transaction. Eviction is
// safe in that case because readCached bypasses SQLite transactions entirely.
export function invalidateObservationData(scopes, domains) {
  invalidateScopes(scopes, domains);
  memoryCache.invalidate(SEEN_PREFIX);
}

export function invalidateBssidRules() {
  memoryCache.invalidate(SEEN_PREFIX);
  for (const domain of ['history', 'heatmap', 'networks', 'analysis']) {
    memoryCache.invalidate(buildCacheKey(domain) + ':');
  }
}
