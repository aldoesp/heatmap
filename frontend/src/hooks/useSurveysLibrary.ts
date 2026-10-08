import { useCallback, useEffect, useState } from 'react';
import {
  deletePlan,
  exportCsvUrl,
  getHeatmap,
  getHistory,
  listApMappings,
  listPlans,
  renamePlan,
  uploadPlanImage,
} from '../lib/api';
import { average } from '../lib/signal';
import { getActivePlanId, setActivePlanId, clearActivePlan } from '../lib/storage';
import { ApiError, type PlanResponse } from '../types/api';

/* ==========================================================================
   Option B : un « survey » = un plan backend existant.
   Aucune route backend créée : on ne consomme que listPlans, getHistory,
   getHeatmap, listApMappings, renamePlan, deletePlan, uploadPlanImage et
   l'export CSV (exportCsvUrl). L'import JSON Android n'existe pas côté
   backend : « Importer » téléverse une image de plan (JPG/PNG/WebP).
   ========================================================================== */

export type SurveyDot = { x: number; y: number; rssi: number | null };

export type SurveySummary = {
  id: string;
  name: string;
  createdAt: string;
  imageUrl: string;
  pointCount: number;
  avgRssi: number | null;
  apCount: number;
  dots: SurveyDot[];
};

async function summarize(plan: PlanResponse): Promise<SurveySummary> {
  const [history, heat, mappings] = await Promise.all([
    getHistory(plan.id).catch(() => []),
    getHeatmap(plan.id).catch(() => []),
    listApMappings(plan.id).catch(() => []),
  ]);

  const best = new Map<string, number>();
  const xs = new Map<string, number>();
  const ys = new Map<string, number>();
  for (const row of heat) {
    const prev = best.get(row.scan_point_id);
    if (prev === undefined || row.rssi > prev) {
      best.set(row.scan_point_id, row.rssi);
      xs.set(row.scan_point_id, row.x);
      ys.set(row.scan_point_id, row.y);
    }
  }
  for (const h of history) {
    if (!xs.has(h.id)) {
      xs.set(h.id, h.x);
      ys.set(h.id, h.y);
    }
  }

  return {
    id: plan.id,
    name: plan.name,
    createdAt: plan.createdAt,
    imageUrl: plan.imageUrl,
    pointCount: history.length,
    avgRssi: average([...best.values()]),
    apCount: mappings.length,
    dots: [...xs.keys()].map((id) => ({
      x: xs.get(id) ?? 0,
      y: ys.get(id) ?? 0,
      rssi: best.get(id) ?? null,
    })),
  };
}

type State = {
  surveys: SurveySummary[];
  loading: boolean;
  error: string | null;
  importing: boolean;
  busyId: string | null;
};

const ERR_LOAD = 'Impossible de charger vos surveys. Réessayez.';

export function useSurveysLibrary() {
  const [state, setState] = useState<State>({
    surveys: [],
    loading: true,
    error: null,
    importing: false,
    busyId: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const plans = await listPlans();
      const surveys = await Promise.all(plans.map(summarize));
      setState((s) => ({ ...s, surveys, loading: false }));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : ERR_LOAD;
      setState((s) => ({ ...s, loading: false, error: msg || ERR_LOAD }));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  /** Téléverse une image de plan (JPG/PNG/WebP) et ajoute la carte. */
  const importImage = useCallback(async (file: File) => {
    setState((s) => ({ ...s, importing: true }));
    try {
      const created = await uploadPlanImage(file);
      const summary = await summarize({
        id: created.id,
        name: created.name,
        imageUrl: created.imageUrl,
        fileName: created.fileName,
        width: created.width,
        height: created.height,
        sizeBytes: created.sizeBytes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setState((s) => ({ ...s, surveys: [summary, ...s.surveys], importing: false }));
      return summary;
    } catch (err) {
      setState((s) => ({ ...s, importing: false }));
      throw err instanceof Error ? err : new Error('Import impossible.');
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    setState((s) => ({ ...s, busyId: id }));
    try {
      const updated = await renamePlan(id, name);
      setState((s) => ({
        ...s,
        busyId: null,
        surveys: s.surveys.map((x) => (x.id === id ? { ...x, name: updated.name } : x)),
      }));
    } catch (err) {
      setState((s) => ({ ...s, busyId: null }));
      throw err instanceof Error ? err : new Error('Renommage impossible.');
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setState((s) => ({ ...s, busyId: id }));
    try {
      await deletePlan(id);
      if (getActivePlanId() === id) clearActivePlan();
      setState((s) => ({
        ...s,
        busyId: null,
        surveys: s.surveys.filter((x) => x.id !== id),
      }));
    } catch (err) {
      setState((s) => ({ ...s, busyId: null }));
      throw err instanceof Error ? err : new Error('Suppression impossible.');
    }
  }, []);

  /** Le backend n'exporte qu'en CSV : ancre <a>, pas de fetch. */
  const exportCsv = useCallback((survey: SurveySummary) => {
    const a = document.createElement('a');
    a.href = exportCsvUrl(survey.id);
    a.download = `${survey.name}-releves.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  /** Rend le survey actif puis ouvre la section demandée. */
  const openSection = useCallback((survey: SurveySummary, section: 'analyse' | 'heatmap') => {
    setActivePlanId(survey.id);
    location.hash = `#/${section}`;
  }, []);

  return { ...state, load, importImage, rename, remove, exportCsv, openSection };
}
