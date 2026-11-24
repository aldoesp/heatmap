import { useCallback, useEffect, useRef, useState } from 'react';
import { getHistory, getScanDetail } from '../lib/api';
import type { ChannelSample } from '../lib/channelAnalysis';
import { ApiError } from '../types/api';
import { usePlanImage } from './usePlanImage';

const MAX_PARALLEL_SCAN_REQUESTS = 6;

/** Récupère les observations du dernier scan de chaque point du plan. */
async function collectChannelSamples(
  planId: string,
): Promise<{ samples: ChannelSample[]; failures: number }> {
  const history = await getHistory(planId);

  const scanIds = [
    ...new Set(
      history
        .map((point) => point.scans[point.scans.length - 1]?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const collected: ChannelSample[] = [];
  let failures = 0;
  let next = 0;

  const worker = async () => {
    while (next < scanIds.length) {
      const scanId = scanIds[next];
      next += 1;
      try {
        const detail = await getScanDetail(scanId);
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
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (planLoading || !plan) return;

    const targetPlanId = plan.id;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let cancelled = false;

    collectChannelSamples(targetPlanId)
      .then(({ samples: collected, failures }) => {
        if (cancelled || requestRef.current !== requestId) return;
        if (collected.length === 0 && failures > 0) {
          setSamples([]);
          setError('Impossible de charger les observations des scans.');
        } else {
          setSamples(collected);
          setError(null);
        }
        setLoadedPlanId(targetPlanId);
      })
      .catch((err: unknown) => {
        if (cancelled || requestRef.current !== requestId) return;
        const apiErr = err instanceof ApiError ? err : null;
        setSamples([]);
        setError(
          apiErr?.message ?? 'Impossible de charger les observations Wi-Fi.',
        );
        setLoadedPlanId(targetPlanId);
      });

    return () => {
      cancelled = true;
    };
  }, [plan, planLoading, reloadToken]);

  // Chargement dérivé du plan, sans setState synchrone dans l'effet.
  const loading = planLoading || (plan !== null && loadedPlanId !== plan.id);

  const reload = useCallback(() => {
    setLoadedPlanId(null);
    setReloadToken((token) => token + 1);
  }, []);

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
