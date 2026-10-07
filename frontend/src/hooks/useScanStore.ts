import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanPoint } from '../types/project';
import type { SaveScanResponse } from '../types/api';
import { ApiError } from '../types/api';
import {
  listScanPoints,
  createScanPoint,
  deleteScanPoint,
  saveScanAtPoint,
} from '../lib/api';

/**
 * Relevés Wi-Fi persistés côté backend (SQLite).
 * addScan() crée le point puis enregistre le scan réel : la réponse du
 * backend (observations incluses) remplace toute mesure locale.
 * removeLast() supprime aussi le point côté backend (cascade scans).
 */
export function useScanStore(planId: string | null) {
  const [scanPoints, setScanPoints] = useState<ScanPoint[]>([]);
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

  const refresh = useCallback(async () => {
    if (!planId) {
      setScanPoints([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const points = await listScanPoints(planId);
      if (!aliveRef.current) return;
      setScanPoints(
        points.map((p) => ({
          id: p.id,
          planId: p.plan_id,
          x: p.x,
          y: p.y,
          createdAt: p.created_at,
        }))
      );
    } catch (err) {
      if (!aliveRef.current) return;
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de charger les relevés.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  const addScan = useCallback(async (x: number, y: number): Promise<SaveScanResponse | null> => {
    if (!planId || scanning) return null;
    setScanning(true);
    setError(null);
    setLastResult(null);
    let pointId: string | null = null;
    try {
      const point = await createScanPoint(planId, x, y);
      pointId = point.id;
      const result = await saveScanAtPoint(point.id);
      if (!aliveRef.current) return result;
      setScanPoints((prev) => [
        ...prev,
        {
          id: point.id,
          planId,
          x: point.x,
          y: point.y,
          createdAt: point.created_at,
          lastScan: {
            id: result.scan_id,
            scannedAt: result.scanned_at,
            mode: result.mode,
            networkCount: result.count,
          },
        },
      ]);
      setLastResult(result);
      if (navigator.vibrate) navigator.vibrate(30);
      return result;
    } catch (err) {
      // Si le scan a échoué après la création du point, on nettoie le point
      // orphelin pour garder la base cohérente.
      if (pointId && planId) {
        await deleteScanPoint(planId, pointId).catch(() => {});
      }
      if (!aliveRef.current) return null;
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Le scan a échoué. Aucune mesure enregistrée.');
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
      setScanPoints((prev) => prev.slice(0, -1));
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

  return { scanPoints, loading, scanning, error, lastResult, addScan, removeLast, refresh, dismissError };
}
