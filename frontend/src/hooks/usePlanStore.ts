import { useCallback, useEffect, useState } from 'react';
import type { AccessPoint, PlanData } from '../types/plan';
import { savePlan, loadPlan, clearPlan } from '../lib/storage';
import { stripExtension } from '../lib/format';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export type LoadError =
  | 'format'
  | 'size'
  | 'unreadable';

export function usePlanStore() {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [selectedApId, setSelectedApId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  /* Restauration au montage */
  useEffect(() => {
    let revoked: string | null = null;
    loadPlan().then((saved) => {
      if (!saved) return;
      const url = URL.createObjectURL(saved.image);
      revoked = url;
      const img = new Image();
      img.onload = () => {
        setPlan({
          ...saved.plan,
          image: saved.image,
          imageUrl: url,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        setAccessPoints(saved.accessPoints);
      };
      img.src = url;
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, []);

  /* Nettoyage de l'URL objet courante */
  useEffect(() => {
    const url = plan?.imageUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [plan?.imageUrl]);

  /* Persistance à chaque changement significatif */
  useEffect(() => {
    if (!plan) return;
    void savePlan(
      {
        name: plan.name,
        fileName: plan.fileName,
        width: plan.width,
        height: plan.height,
        sizeBytes: plan.sizeBytes,
      },
      accessPoints,
      plan.image
    );
  }, [plan, accessPoints]);

  const loadFile = useCallback((file: File) => {
    setError(null);
    setInfo(null);

    if (!ACCEPTED.includes(file.type)) {
      setError('format');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('size');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const url = URL.createObjectURL(file);
        setPlan({
          name: stripExtension(file.name),
          fileName: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
          sizeBytes: file.size,
          image: file,
          imageUrl: url,
        });
        setAccessPoints([]);
        setSelectedApId(null);
        setPlacing(false);
        setInfo('Plan chargé.');
      };
      img.onerror = () => setError('unreadable');
      img.src = reader.result as string;
    };
    reader.onerror = () => setError('unreadable');
    reader.readAsDataURL(file);
  }, []);

  const clear = useCallback(() => {
    clearPlan();
    setPlan(null);
    setAccessPoints([]);
    setSelectedApId(null);
    setPlacing(false);
    setError(null);
    setInfo(null);
  }, []);

  const renamePlan = useCallback((name: string) => {
    setPlan((p) => (p ? { ...p, name } : p));
  }, []);

  const addAp = useCallback(
    (x: number, y: number): AccessPoint => {
      const index = accessPoints.length + 1;
      const ap: AccessPoint = {
        id: `ap-${Date.now()}`,
        name: `AP-${String(index).padStart(2, '0')}`,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
      setAccessPoints((prev) => [...prev, ap]);
      setSelectedApId(ap.id);
      return ap;
    },
    [accessPoints.length]
  );

  const updateAp = useCallback((id: string, patch: Partial<AccessPoint>) => {
    setAccessPoints((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  }, []);

  const removeAp = useCallback((id: string) => {
    setAccessPoints((prev) => prev.filter((a) => a.id !== id));
    setSelectedApId((curr) => (curr === id ? null : curr));
  }, []);

  const selectAp = useCallback((id: string | null) => setSelectedApId(id), []);

  const togglePlacing = useCallback(() => {
    if (!plan) return;
    setPlacing((v) => !v);
  }, [plan]);

  const stopPlacing = useCallback(() => setPlacing(false), []);

  return {
    plan,
    accessPoints,
    selectedApId,
    placing,
    error,
    info,
    loadFile,
    clear,
    renamePlan,
    addAp,
    updateAp,
    removeAp,
    selectAp,
    togglePlacing,
    stopPlacing,
  };
}