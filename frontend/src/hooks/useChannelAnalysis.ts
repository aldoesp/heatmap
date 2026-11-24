import { useCallback, useState } from 'react';
import { getHistory, getScanDetail } from '../lib/api';
import type { ChannelSample } from '../lib/channelAnalysis';
import { ApiError } from '../types/api';
import type { ApiRead } from '../lib/apiRead';
import { useApiQuery } from './useApiQuery';
import { usePlanImage } from './usePlanImage';

const MAX_PARALLEL_SCAN_REQUESTS = 6;

/** Récupère les observations du dernier scan de chaque point du plan. */
async function collectChannelSamples(
  planId: string,
  read: ApiRead,
): Promise<{ samples: ChannelSample[]; failures: number }> {
  const history = await getHistory(planId, read);
  const scans = new Map<string, { planId: string; pointId: string }>();
  for (const point of history) {
    const scanId = point.scans.at(-1)?.id;
    if (scanId) scans.set(scanId, { planId, pointId: point.id });
  }
  const scanIds = [...scans.keys()];

  const collected: ChannelSample[] = [];
  let failures = 0;
  let next = 0;

  const worker = async () => {
    while (next < scanIds.length && read.isCurrent()) {
      const scanId = scanIds[next];
      next += 1;
      try {
        const detail = await getScanDetail(scanId, read, scans.get(scanId));
        for (const observation of detail.observations) {
          collected.push({
            ...observation,
            scanned_at: detail.scanned_at,
            scan_point_id: detail.scan_point_id,
          });
        }
      } catch {
        failures += 1;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_PARALLEL_SCAN_REQUESTS, scanIds.length) },
      worker,
    ),
  );

  return { samples: collected, failures };
}

/**
 * Charge les observations du dernier scan de chaque point du plan actif.
 *
 * Aucun endpoint dédié n'est ajouté : on réutilise /history puis /scans/:id,
 * qui contiennent déjà canal, fréquence, largeur et centre de canal.
 */
export function useChannelAnalysis() {
  const {
    plan,
    loading: planLoading,
    error: planError,
  } = usePlanImage({ waitForImageCheck: false });

  const [samples, setSamples] = useState<ChannelSample[]>([]);
  const [loadedPlanId, setLoadedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const planId = plan?.id;
  const load = useCallback((read: ApiRead) => collectChannelSamples(planId!, read), [planId]);
  const reload = useApiQuery(planLoading || !planId ? null : load, {
    start: () => setLoadedPlanId(null),
    success: ({ samples: collected, failures }) => {
      setSamples(collected);
      setError(collected.length === 0 && failures > 0 ? 'Impossible de charger les observations des scans.' : null);
    },
    error: err => {
      setSamples([]);
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les observations Wi-Fi.');
    },
    settled: () => setLoadedPlanId(planId ?? null),
  });

  const loading = planLoading || (!!planId && loadedPlanId !== planId);
  return {
    plan,
    planLoading,
    planError,
    samples,
    loading,
    error,
    reload,
  };
}
