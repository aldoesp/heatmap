import { useCallback, useState } from 'react';
import { fetchApPositions, saveApPosition, removeApPosition, type ApPositionDto } from '../lib/api.js';
import type { ApiRead } from '../lib/apiRead.js';
import { useApiQuery } from './useApiQuery.js';

const EMPTY_POSITIONS: ApPositionDto[] = [];

export function useApPositions(planId: string | null) {
  const [result, setResult] = useState<{ planId: string; rows: ApPositionDto[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((read: ApiRead) => fetchApPositions(planId!, read), [planId]);
  useApiQuery(planId ? load : null, {
    start: () => { setLoading(true); setError(null); },
    success: rows => { if (planId) setResult({ planId, rows }); },
    error: e => setError(String(e)),
    settled: () => setLoading(false),
  });

  const save = useCallback(async (bssid: string, x: number, y: number) => {
    if (planId) await saveApPosition(planId, bssid, x, y);
  }, [planId]);

  const remove = useCallback(async (bssid: string) => {
    if (planId) await removeApPosition(planId, bssid);
  }, [planId]);

  const positions = result?.planId === planId ? (result?.rows ?? EMPTY_POSITIONS) : EMPTY_POSITIONS;
  return { positions, save, remove, loading: !!planId && loading, error };
}
