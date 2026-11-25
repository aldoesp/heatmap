import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanPoint } from '../types/project';
import type { SaveScanResponse } from '../types/api';
import type { ApiRead } from '../lib/apiRead';
import { useApiQuery } from './useApiQuery';
import { ApiError } from '../types/api';
import {
  listScanPoints,
  createScanPoint,
  deleteScanPoint,
  saveScanAtPoint,
} from '../lib/api';

const EMPTY_POINTS: ScanPoint[] = [];

/**
 * Relevés Wi-Fi persistés côté backend (SQLite).
 * addScan() crée le point puis enregistre le scan réel : la réponse du
 * backend (observations incluses) remplace toute mesure locale.
 * removeLast() supprime aussi le point côté backend (cascade scans).
 */
export function useScanStore(planId: string | null) {
  const [loaded, setLoaded] = useState<{ planId: string; points: ScanPoint[] } | null>(null);
  const scanPoints = loaded?.planId === planId ? (loaded?.points ?? EMPTY_POINTS) : EMPTY_POINTS;
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SaveScanResponse | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async (read: ApiRead) => {
    const points = await listScanPoints(planId!, read);
    return points.map(p => ({
      id: p.id, planId: p.plan_id, x: p.x, y: p.y,
      note: p.note, createdAt: p.created_at,
    }));
  }, [planId]);
  const refresh = useApiQuery(planId ? load : null, {
    start: () => { setLoading(true); setError(null); },
    success: points => { if (planId) setLoaded({ planId, points }); },
    error: err => setError(err instanceof ApiError ? err.message : 'Impossible de charger les relevés.'),
    settled: () => setLoading(false),
  });

  const addScan = useCallback(async (x: number, y: number): Promise<SaveScanResponse | null> => {
    if (!planId || scanning) return null;
    setScanning(true);
    setError(null);
    setLastResult(null);
    let pointId: string | null = null;
    try {
      const point = await createScanPoint(planId, x, y);
      pointId = point.id;
      const result = await saveScanAtPoint(point.id, point.plan_id || planId);
      if (!aliveRef.current) return result;
      setLastResult(result);
      if (navigator.vibrate) navigator.vibrate(30);
      return result;
    } catch (err) {
      // Si le scan a échoué après la création du point, on nettoie le point
      // orphelin pour garder la base cohérente.
      if (pointId && err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408) {
        await deleteScanPoint(planId, pointId).catch(() => {});
      }
      if (!aliveRef.current) return null;
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Le scan a échoué.');
      return null;
    } finally {
      if (aliveRef.current) setScanning(false);
    }
  }, [planId, scanning]);

  const removeLast = useCallback(async (): Promise<boolean> => {
    if (!planId || scanPoints.length === 0 || scanning) return false;
    const last = scanPoints[scanPoints.length - 1];
    setScanning(true);
    setError(null);
    try {
      await deleteScanPoint(planId, last.id);
      if (!aliveRef.current) return true;
      setLastResult(null);
      return true;
    } catch (err) {
      if (!aliveRef.current) return false;
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible d’annuler ce relevé.');
      return false;
    } finally {
      if (aliveRef.current) setScanning(false);
    }
  }, [planId, scanPoints, scanning]);

  const dismissError = useCallback(() => setError(null), []);

  return { scanPoints, loading: !!planId && loading, scanning, error, lastResult, addScan, removeLast, refresh, dismissError };
}
