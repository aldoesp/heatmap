import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessPoint, PlanData } from '../types/plan';
import {
  getActivePlanId,
  setActivePlanId,
  readLegacyPlanId,
} from '../lib/storage';
import {
  uploadPlanImage,
  listPlans,
  getPlan,
  renamePlan as renamePlanApi,
  deletePlan as deletePlanApi,
  listAccessPoints,
  createAccessPoint,
  updateAccessPoint,
  deleteAccessPoint,
} from '../lib/api';
import { ApiError } from '../types/api';
import { stripExtension } from '../lib/format';
import { fetchDemoFile, type DemoPlan } from '../lib/demoPlans';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export type LoadError =
  | 'format'
  | 'size'
  | 'unreadable'
  | 'network'
  | 'server';

export interface LoadErrorInfo {
  kind: LoadError;
  message: string;
}

function toPlanData(p: {
  id: string;
  name: string;
  imageUrl: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
}): PlanData {
  return {
    id: p.id,
    name: p.name,
    fileName: p.fileName,
    width: p.width,
    height: p.height,
    sizeBytes: p.sizeBytes,
    imageUrl: p.imageUrl,
  };
}

function toErrorInfo(err: unknown, fallback: string): LoadErrorInfo {
  const apiErr = err instanceof ApiError ? err : null;
  const isNetwork = apiErr?.code === 'network' || apiErr?.status === 0;
  return {
    kind: isNetwork ? 'network' : 'server',
    message: apiErr?.message ?? fallback,
  };
}

export function usePlanStore() {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [selectedApId, setSelectedApId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  /** Chargement initial (plan + APs depuis le backend) */
  const [loading, setLoading] = useState(true);
  /** Import d'image en cours */
  const [uploading, setUploading] = useState(false);
  /** Mutation AP / rename en cours */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoadErrorInfo | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /* ==========================================================================
     Chargement initial : le backend est la source de vérité.
     ========================================================================== */
  const refresh = useCallback(async (planId?: string) => {
    const id = planId ?? getActivePlanId() ?? readLegacyPlanId();
    if (!id) {
      // Aucun plan actif : prendre le plus récent s'il existe
      try {
        const plans = await listPlans();
        if (!aliveRef.current) return;
        if (plans.length === 0) {
          setPlan(null);
          setAccessPoints([]);
          return;
        }
        setActivePlanId(plans[0].id);
        setPlan(toPlanData(plans[0]));
        setAccessPoints(await listAccessPoints(plans[0].id));
      } catch (err) {
        if (!aliveRef.current) return;
        setError(toErrorInfo(err, 'Impossible de charger les plans.'));
      }
      return;
    }
    try {
      const p = await getPlan(id);
      if (!aliveRef.current) return;
      setActivePlanId(p.id);
      setPlan(toPlanData(p));
      setAccessPoints(await listAccessPoints(p.id));
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.status === 404) {
        // Plan local orphelin (supprimé côté serveur) : on l'oublie sans effacer la DB
        setActivePlanId(null);
        setPlan(null);
        setAccessPoints([]);
        setError({
          kind: 'server',
          message: 'Ce plan n’existe plus sur le serveur. Importe un nouveau plan.',
        });
      } else {
        setError(toErrorInfo(err, 'Impossible de charger le plan.'));
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      if (aliveRef.current) setLoading(false);
    })();
  }, [refresh]);

  /* ==========================================================================
     Import : validation locale puis envoi au backend
     ========================================================================== */
  const persistFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadPlanImage(file);
      if (!aliveRef.current) return;
      setActivePlanId(res.id);
      setPlan({
        id: res.id,
        name: res.name || stripExtension(res.fileName),
        fileName: res.fileName,
        width: res.width,
        height: res.height,
        sizeBytes: res.sizeBytes,
        imageUrl: res.imageUrl,
      });
      setAccessPoints([]);
      setSelectedApId(null);
      setPlacing(false);
      setInfo('Plan importé.');
    } catch (err) {
      if (!aliveRef.current) return;
      const apiErr = err instanceof ApiError ? err : null;
      const isNetwork = apiErr?.code === 'network' || apiErr?.status === 0;
      setError({
        kind: isNetwork ? 'network' : 'server',
        message:
          apiErr?.message ??
          "Impossible d'envoyer l'image. Réessaie dans un instant.",
      });
    } finally {
      if (aliveRef.current) setUploading(false);
    }
  }, []);

  const validateFile = useCallback((file: File): boolean => {
    if (!ACCEPTED.includes(file.type)) {
      setError({
        kind: 'format',
        message: "Ce format n'est pas supporté. Utilise un JPG, PNG ou WebP.",
      });
      return false;
    }

    if (file.size > MAX_BYTES) {
      setError({
        kind: 'size',
        message: 'Cette image dépasse 10 Mo. Choisis-en une plus légère.',
      });
      return false;
    }
    return true;
  }, []);

  const loadFile = useCallback(async (file: File) => {
    if (uploading) return;
    setError(null);
    setInfo(null);
    if (!validateFile(file)) return;
    await persistFile(file);
  }, [uploading, validateFile, persistFile]);

  /* ==========================================================================
     Plan de démo packagé : même validation + même nommage que l'import.
     ========================================================================== */
  const loadDemoPlan = useCallback(async (demo: DemoPlan) => {
    if (uploading) return;
    setError(null);
    setInfo(null);
    let file: File;
    try {
      file = await fetchDemoFile(demo);
    } catch {
      setError({
        kind: 'unreadable',
        message: 'Impossible de charger ce plan de démo.',
      });
      return;
    }
    if (!aliveRef.current) return;
    if (!validateFile(file)) return;
    await persistFile(file);
  }, [uploading, validateFile, persistFile]);

  /* ==========================================================================
     Suppression du plan (backend + fichiers) — l'appelant doit confirmer.
     ========================================================================== */
  const clear = useCallback(async (): Promise<boolean> => {
    if (!plan) return true;
    setBusy(true);
    setError(null);
    try {
      await deletePlanApi(plan.id);
      if (!aliveRef.current) return true;
      setActivePlanId(null);
      setPlan(null);
      setAccessPoints([]);
      setSelectedApId(null);
      setPlacing(false);
      setInfo(null);
      return true;
    } catch (err) {
      if (!aliveRef.current) return false;
      setError(toErrorInfo(err, 'Impossible de supprimer le plan.'));
      return false;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [plan]);

  const renamePlan = useCallback(async (name: string): Promise<boolean> => {
    if (!plan) return false;
    const trimmed = name.trim();
    if (!trimmed || trimmed === plan.name) return true;
    setBusy(true);
    try {
      const updated = await renamePlanApi(plan.id, trimmed);
      if (!aliveRef.current) return true;
      setPlan((p) => (p ? { ...p, name: updated.name } : p));
      return true;
    } catch (err) {
      if (!aliveRef.current) return false;
      setError(toErrorInfo(err, 'Impossible de renommer le plan.'));
      return false;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [plan]);

  /* ==========================================================================
     Points d'accès : persistés via l'API, confirmés après succès backend.
     ========================================================================== */
  const addAp = useCallback(async (x: number, y: number): Promise<AccessPoint | null> => {
    if (!plan) return null;
    const taken = new Set(accessPoints.map((a) => a.name.trim()));
    let index = accessPoints.length + 1;
    let name = `AP-${String(index).padStart(2, '0')}`;
    while (taken.has(name)) {
      index += 1;
      name = `AP-${String(index).padStart(2, '0')}`;
    }
    setBusy(true);
    try {
      const ap = await createAccessPoint(plan.id, {
        name,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      });
      if (!aliveRef.current) return ap;
      setAccessPoints((prev) => [...prev, ap]);
      setSelectedApId(ap.id);
      return ap;
    } catch (err) {
      if (!aliveRef.current) return null;
      setError(toErrorInfo(err, "Impossible d'ajouter ce point d’accès."));
      return null;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [plan, accessPoints]);

  const updateAp = useCallback(async (
    id: string,
    patch: Partial<AccessPoint>
  ): Promise<boolean> => {
    const clean: Partial<Pick<AccessPoint, 'name' | 'x' | 'y'>> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) {
        setError({ kind: 'server', message: 'Le nom du point d’accès est vide.' });
        return false;
      }
      clean.name = patch.name;
    }
    if (patch.x !== undefined) clean.x = Math.max(0, Math.min(1, patch.x));
    if (patch.y !== undefined) clean.y = Math.max(0, Math.min(1, patch.y));
    setBusy(true);
    try {
      const updated = await updateAccessPoint(id, clean);
      if (!aliveRef.current) return true;
      setAccessPoints((prev) => prev.map((a) => (a.id === id ? updated : a)));
      return true;
    } catch (err) {
      if (!aliveRef.current) return false;
      setError(toErrorInfo(err, 'Impossible de mettre à jour ce point d’accès.'));
      return false;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  const removeAp = useCallback(async (id: string): Promise<boolean> => {
    setBusy(true);
    try {
      await deleteAccessPoint(id);
      if (!aliveRef.current) return true;
      setAccessPoints((prev) => prev.filter((a) => a.id !== id));
      setSelectedApId((curr) => (curr === id ? null : curr));
      return true;
    } catch (err) {
      if (!aliveRef.current) return false;
      setError(toErrorInfo(err, 'Impossible de supprimer ce point d’accès.'));
      return false;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  const selectAp = useCallback((id: string | null) => setSelectedApId(id), []);

  const togglePlacing = useCallback(() => {
    if (!plan) return;
    setPlacing((v) => !v);
  }, [plan]);

  const stopPlacing = useCallback(() => setPlacing(false), []);

  const dismissMessages = useCallback(() => {
    setError(null);
    setInfo(null);
  }, []);

  return {
    plan,
    accessPoints,
    selectedApId,
    placing,
    loading,
    uploading,
    busy,
    error,
    info,
    loadFile,
    loadDemoPlan,
    clear,
    renamePlan,
    addAp,
    updateAp,
    removeAp,
    selectAp,
    togglePlacing,
    stopPlacing,
    refresh,
    dismissMessages,
  };
}
