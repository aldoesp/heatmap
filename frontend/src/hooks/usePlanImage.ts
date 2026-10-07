import { useEffect, useState } from 'react';
import type { PlanData } from '../types/plan';
import { getActivePlanId } from '../lib/storage';
import { getPlan, listPlans } from '../lib/api';
import { ApiError } from '../types/api';

interface PlanImageResult {
  plan: PlanData | null;
  imageUrl: string | null;
  loading: boolean;
  /** L'image référencée en DB est introuvable sur le serveur */
  imageMissing: boolean;
  error: string | null;
}

/**
 * Plan actif depuis le backend (source de vérité).
 * Vérifie aussi que le fichier image existe encore : si la ligne SQLite
 * référence une image manquante, on l'indique sans effacer de données.
 */
export function usePlanImage(): PlanImageResult {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageMissing, setImageMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const id = getActivePlanId();
        const p = id ? await getPlan(id) : (await listPlans())[0] ?? null;
        if (!p) {
          if (alive) setLoading(false);
          return;
        }
        if (alive) {
          setPlan({
            id: p.id,
            name: p.name,
            fileName: p.fileName,
            width: p.width,
            height: p.height,
            sizeBytes: p.sizeBytes,
            imageUrl: p.imageUrl,
          });
        }
        // L'image existe-t-elle encore sur le serveur ?
        try {
          const head = await fetch(p.imageUrl, { method: 'HEAD' });
          if (alive) setImageMissing(!head.ok);
        } catch {
          if (alive) setImageMissing(true);
        }
      } catch (err) {
        if (!alive) return;
        const apiErr = err instanceof ApiError ? err : null;
        setError(apiErr?.message ?? 'Impossible de charger le plan.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return {
    plan,
    imageUrl: imageMissing ? null : (plan?.imageUrl ?? null),
    loading,
    imageMissing,
    error,
  };
}
