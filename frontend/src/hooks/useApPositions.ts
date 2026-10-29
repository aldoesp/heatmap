import { useCallback, useEffect, useState } from 'react';
import { fetchApPositions, saveApPosition, removeApPosition, type ApPositionDto } from '../lib/api.js';

export function useApPositions(planId: string | null) {
  const [positions, setPositions] = useState<ApPositionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    setLoading(true);
    fetchApPositions(planId)
      .then((rows) => {
        if (!cancelled) setPositions(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const save = useCallback(
    async (bssid: string, x: number, y: number) => {
      if (!planId) return;
      const row = await saveApPosition(planId, bssid, x, y);
      setPositions((prev) => {
        const idx = prev.findIndex((p) => p.bssid === row.bssid);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = row;
          return next;
        }
        return [...prev, row];
      });
    },
    [planId]
  );

  const remove = useCallback(
    async (bssid: string) => {
      if (!planId) return;
      await removeApPosition(planId, bssid);
      setPositions((prev) => prev.filter((p) => p.bssid !== bssid));
    },
    [planId]
  );

  return { positions, save, remove, loading, error };
}
