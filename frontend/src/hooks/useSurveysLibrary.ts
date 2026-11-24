import { useCallback, useState } from 'react';
import {
  deletePlan,
  exportCsvUrl,
  getHeatmap,
  getHistory,
  importCsvSurvey,
  listApMappings,
  listPlans,
  renamePlan,
  uploadPlanImage,
} from '../lib/api';
import { average } from '../lib/signal';
import { getActivePlanId, setActivePlanId, clearActivePlan } from '../lib/storage';
import type { ApiRead } from '../lib/apiRead';
import { useApiQuery } from './useApiQuery';
import { ApiError, type HeatmapRow, type PlanResponse, type ScanHistoryEntry } from '../types/api';

// La bibliothèque représente chaque plan backend comme un survey.
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

type SurveyDetails = { history: ScanHistoryEntry[]; heat: HeatmapRow[] };

async function summarize(plan: PlanResponse, read: ApiRead) {
  const [history, heat, mappings] = await Promise.all([
    getHistory(plan.id, read).catch(() => null),
    getHeatmap(plan.id, undefined, read).catch(() => null),
    listApMappings(plan.id, read).catch(() => []),
  ]);

  const best = new Map<string, number>();
  const xs = new Map<string, number>();
  const ys = new Map<string, number>();
  for (const row of heat ?? []) {
    const prev = best.get(row.scan_point_id);
    if (prev === undefined || row.rssi > prev) {
      best.set(row.scan_point_id, row.rssi);
      xs.set(row.scan_point_id, row.x);
      ys.set(row.scan_point_id, row.y);
    }
  }
  for (const h of history ?? []) {
    if (!xs.has(h.id)) {
      xs.set(h.id, h.x);
      ys.set(h.id, h.y);
    }
  }

  const summary: SurveySummary = {
    id: plan.id,
    name: plan.name,
    createdAt: plan.createdAt,
    imageUrl: plan.imageUrl,
    pointCount: history?.length ?? 0,
    avgRssi: average([...best.values()]),
    apCount: mappings.length,
    dots: [...xs.keys()].map((id) => ({
      x: xs.get(id) ?? 0,
      y: ys.get(id) ?? 0,
      rssi: best.get(id) ?? null,
    })),
  };
  return { summary, details: history && heat ? { history, heat } : null };
}

async function loadSurveys(read: ApiRead) {
  const plans = await listPlans(read);
  const surveys: SurveySummary[] = [];
  const details = new Map<string, SurveyDetails>();
  for (let i = 0; i < plans.length && read.isCurrent(); i += 10) {
    const batch = await Promise.all(plans.slice(i, i + 10).map(plan => summarize(plan, read)));
    for (const result of batch) {
      surveys.push(result.summary);
      if (result.details) details.set(result.summary.id, result.details);
    }
  }
  return { surveys, details };
}

type State = {
  surveys: SurveySummary[];
  details: Map<string, SurveyDetails>;
  loading: boolean;
  error: string | null;
  importing: boolean;
  busyId: string | null;
};

const ERR_LOAD = 'Impossible de charger vos surveys. Réessayez.';

export function useSurveysLibrary() {
  const [state, setState] = useState<State>({
    surveys: [],
    details: new Map(),
    loading: true,
    error: null,
    importing: false,
    busyId: null,
  });

  const load = useApiQuery(loadSurveys, {
    start: () => setState(s => ({ ...s, loading: true, error: null })),
    success: data => setState(s => ({ ...s, ...data, loading: false })),
    error: err => {
      const msg = err instanceof ApiError ? err.message : ERR_LOAD;
      setState(s => ({ ...s, loading: false, error: msg || ERR_LOAD }));
    },
  });

  /** Téléverse une image de plan (JPG/PNG/WebP) et ajoute la carte. */
  const importImage = useCallback(async (file: File) => {
    setState((s) => ({ ...s, importing: true }));
    try {
      const created = await uploadPlanImage(file);
      setState(s => ({ ...s, importing: false }));
      return {
        id: created.id,
        name: created.name,
        imageUrl: created.imageUrl,
        createdAt: new Date().toISOString(),
        pointCount: 0,
        avgRssi: null,
        apCount: 0,
        dots: [],
      } satisfies SurveySummary;
    } catch (err) {
      setState((s) => ({ ...s, importing: false }));
      throw err instanceof Error ? err : new Error('Import impossible.');
    }
  }, []);

  const importCsv = useCallback(async (file: File, name?: string) => {
    setState((s) => ({ ...s, importing: true }));
    try {
      const result = await importCsvSurvey(file, { name });
      setState((s) => ({ ...s, importing: false }));
      return result;
    } catch (err) {
      setState((s) => ({ ...s, importing: false }));
      throw err instanceof Error ? err : new Error('Import CSV impossible.');
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    setState((s) => ({ ...s, busyId: id }));
    try {
      await renamePlan(id, name);
      setState(s => ({ ...s, busyId: null }));
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
      setState(s => ({ ...s, busyId: null }));
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
  const openSection = useCallback((survey: SurveySummary, section: 'heatmap') => {
    setActivePlanId(survey.id);
    location.hash = `#/${section}`;
  }, []);

  return { ...state, load, importImage, importCsv, rename, remove, exportCsv, openSection };
}
