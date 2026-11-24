import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PlanData } from '../types/plan';
import { getActivePlanId, subscribeActivePlan } from '../lib/storage';
import { getPlan, listPlans } from '../lib/api';
import { READ_TIMEOUT_MS, type ApiRead } from '../lib/apiRead';
import { ApiError } from '../types/api';
import { useApiQuery } from './useApiQuery';

interface PlanImageResult {
  plan: PlanData | null;
  imageUrl: string | null;
  loading: boolean;
  /** L'image référencée en DB est introuvable sur le serveur */
  imageMissing: boolean;
  error: string | null;
}

export function usePlanImage({ waitForImageCheck = true }: { waitForImageCheck?: boolean } = {}): PlanImageResult {
  const activeId = useSyncExternalStore(subscribeActivePlan, getActivePlanId);
  const [result, setResult] = useState<{ activeId: string | null; plan: PlanData | null } | null>(null);
  const [image, setImage] = useState<{ url: string; missing: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (read: ApiRead) => {
    const p = activeId ? await getPlan(activeId, read) : (await listPlans(read))[0];
    if (!p) return null;
    const { id, name, fileName, width, height, sizeBytes, imageUrl } = p;
    return { id, name, fileName, width, height, sizeBytes, imageUrl };
  }, [activeId]);
  useApiQuery(load, {
    start: () => setError(null),
    success: plan => setResult({ activeId, plan }),
    error: err => {
      setResult({ activeId, plan: null });
      setError(err instanceof ApiError ? err.message : 'Impossible de charger le plan.');
    },
  });

  const plan = result?.activeId === activeId ? result.plan : null;
  const url = plan?.imageUrl;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(READ_TIMEOUT_MS)]);
    const publish = (missing: boolean) => {
      if (!controller.signal.aborted) setImage({ url, missing });
    };
    void fetch(url, { method: 'HEAD', signal }).then(head => publish(!head.ok), () => publish(true));
    return () => controller.abort();
  }, [url]);

  const imageMissing = !!image && image.url === url && image.missing;
  return {
    plan,
    imageUrl: imageMissing ? null : (url ?? null),
    loading: !result || result.activeId !== activeId || (waitForImageCheck && !!url && image?.url !== url),
    imageMissing,
    error,
  };
}
