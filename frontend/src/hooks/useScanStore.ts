import { useCallback, useMemo, useState } from 'react';
import type { AccessPoint, ScanPoint } from '../types/project';
import { loadProject, saveProject } from '../lib/storage';

export function useScanStore(
  planName: string | null,
  planMeta: { width: number; height: number; fileName: string; sizeBytes: number } | null,
  accessPoints: AccessPoint[]
) {
  const initial = useMemo(() => loadProject(), []);
  const [scanPoints, setScanPoints] = useState<ScanPoint[]>(
    () => initial?.scanPoints ?? []
  );

  const persist = useCallback(
    (next: ScanPoint[]) => {
      if (!planMeta) return;
      saveProject({
        plan: {
          name: planName ?? 'Plan',
          fileName: planMeta.fileName,
          width: planMeta.width,
          height: planMeta.height,
          sizeBytes: planMeta.sizeBytes,
        },
        accessPoints,
        scanPoints: next,
      });
    },
    [planName, planMeta, accessPoints]
  );

  const addScan = useCallback(
    (x: number, y: number): ScanPoint => {
      const point: ScanPoint = {
        id: `sp-${Date.now()}`,
        x,
        y,
        timestamp: Date.now(),
        measurements: null,
      };
      const next = [...scanPoints, point];
      setScanPoints(next);
      persist(next);
      return point;
    },
    [scanPoints, persist]
  );

  const removeLast = useCallback((): ScanPoint | null => {
    if (scanPoints.length === 0) return null;
    const next = scanPoints.slice(0, -1);
    const removed = scanPoints[scanPoints.length - 1];
    setScanPoints(next);
    persist(next);
    return removed;
  }, [scanPoints, persist]);

  return { scanPoints, addScan, removeLast };
}