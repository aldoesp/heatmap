import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Upload } from 'lucide-react';
import { useSurveysLibrary, type SurveySummary } from '../../hooks/useSurveysLibrary';
import { getHeatmap, getHistory } from '../../lib/api';
import { SurveyCard } from './SurveyCard';
import { SurveySheet } from './SurveySheet';
import { ConfirmDelete } from './ConfirmDelete';
import { PointsTable, type PointRow } from './PointsTable';

type SortMode = 'recent' | 'name' | 'rssi';

const ERR_IMPORT =
  'Impossible d’importer ce fichier. Utilise une image JPG, PNG ou WebP.';

export function SurveysLibraryPage() {
  const {
    surveys,
    loading,
    error,
    importing,
    busyId,
    load,
    importImage,
    rename,
    remove,
    exportCsv,
    openSection,
  } = useSurveysLibrary();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [sheet, setSheet] = useState<SurveySummary | null>(null);
  const [renaming, setRenaming] = useState<SurveySummary | null>(null);
  const [confirming, setConfirming] = useState<SurveySummary | null>(null);
  const [viewPoints, setViewPoints] = useState<{ survey: SurveySummary; rows: PointRow[] } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = surveys;
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q));
    const copy = [...list];
    if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    else if (sort === 'rssi')
      copy.sort((a, b) => (b.avgRssi ?? -999) - (a.avgRssi ?? -999));
    else copy.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return copy;
  }, [surveys, query, sort]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      await importImage(file);
      showToast('Survey importé.');
    } catch {
      setImportError(ERR_IMPORT);
    }
  };

  const openPoints = async (s: SurveySummary) => {
    try {
      const [history, heat] = await Promise.all([getHistory(s.id), getHeatmap(s.id)]);
      const best = new Map<string, number>();
      for (const row of heat) {
        const prev = best.get(row.scan_point_id);
        if (prev === undefined || row.rssi > prev) best.set(row.scan_point_id, row.rssi);
      }
      const rows: PointRow[] = history.map((h) => {
        const last = h.scans[h.scans.length - 1];
        return {
          id: h.id,
          x: h.x,
          y: h.y,
          surveyId: h.survey_id,
          note: h.note,
          isEnabled: h.is_enabled,
          planId: h.plan_id,
          createdAt: h.created_at,
          rssi: best.get(h.id) ?? null,
          scans: h.scans,
          networks: last?.network_count ?? 0,
          scannedAt: last?.scanned_at ?? null,
          ping: last?.gateway_rtt_ms ?? null,
          down: last?.tcp_down_bps ?? null,
          up: last?.tcp_up_bps ?? null,
        };
      });
      setViewPoints({ survey: s, rows });
      setSheet(null);
    } catch {
      showToast('Impossible de charger les points.');
    }
  };

  if (viewPoints) {
    return (
      <PointsTable
        surveyName={viewPoints.survey.name}
        rows={viewPoints.rows}
        onBack={() => setViewPoints(null)}
      />
    );
  }

  return (
    <div className="max-w-300 mx-auto px-4 pt-6 pb-28 md:pb-10">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[20px] font-medium text-text">Surveys</h1>
          <p className="text-[12px] text-text-dim mt-0.5">
            {surveys.length} survey{surveys.length > 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          aria-label="Importer un survey"
          className="inline-flex items-center gap-2 h-11 px-4 rounded-[14px] border border-accent-border text-[#34d399] text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <Upload className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden />
          {importing ? 'Import…' : 'Importer'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={onPickFile}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {importError && (
        <p role="alert" className="mb-3 text-[13px] text-danger">
          {importError}
        </p>
      )}

      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-text-dim pointer-events-none"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un survey"
            aria-label="Rechercher un survey"
            className="w-full h-11 pl-10 pr-3 rounded-[12px] bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] text-text text-[14px] placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          aria-label="Trier les surveys"
          className="h-11 px-3 rounded-[12px] bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] text-text text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="recent">Récents</option>
          <option value="name">Nom</option>
          <option value="rssi">RSSI moyen</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-[13px] text-text">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline font-medium">
            Réessayer
          </button>
        </div>
      )}

      {loading || importing ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              aria-hidden={i > 0}
              className="min-h-[128px] rounded-[14px] bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] animate-pulse flex items-center justify-center"
            >
              {importing && i === 0 && (
                <span className="text-[13px] text-text-dim">Import en cours…</span>
              )}
            </div>
          ))}
        </div>
      ) : surveys.length === 0 && !error ? (
        <div className="text-center py-16">
          <p className="text-[15px] text-text mb-1">Importez votre premier survey</p>
          <p className="text-[13px] text-text-dim mb-4">
            Ajoutez l’image du plan de votre survey (JPG, PNG ou WebP).
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center h-11 px-5 rounded-[14px] border border-accent-border text-[#34d399] text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Importer
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-text-dim text-[13px] py-12">
          Aucun survey ne correspond à votre recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => (
            <SurveyCard
              key={s.id}
              survey={s}
              busy={busyId === s.id}
              onOpenMenu={setSheet}
              onAnalyse={(x) => openSection(x, 'analyse')}
              onHeatmap={(x) => openSection(x, 'heatmap')}
            />
          ))}
        </div>
      )}

      {sheet && (
        <SurveySheet
          survey={sheet}
          onClose={() => setSheet(null)}
          onAnalyse={(s) => {
            setSheet(null);
            openSection(s, 'analyse');
          }}
          onHeatmap={(s) => {
            setSheet(null);
            openSection(s, 'heatmap');
          }}
          onViewPoints={(s) => void openPoints(s)}
          onRename={(s) => {
            setSheet(null);
            setRenaming(s);
          }}
          onExport={(s) => {
            setSheet(null);
            exportCsv(s);
            showToast('Export prêt.');
          }}
          onDelete={(s) => {
            setSheet(null);
            setConfirming(s);
          }}
        />
      )}

      {renaming && (
        <RenameDialog
          survey={renaming}
          onCancel={() => setRenaming(null)}
          onConfirm={(name) => {
            void rename(renaming.id, name)
              .then(() => {
                setRenaming(null);
                showToast('Survey renommé.');
              })
              .catch(() => showToast('Renommage impossible.'));
          }}
        />
      )}

      {confirming && (
        <ConfirmDelete
          surveyName={confirming.name}
          pointCount={confirming.pointCount}
          busy={busyId === confirming.id}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            void remove(confirming.id)
              .then(() => {
                setConfirming(null);
                showToast('Survey supprimé.');
              })
              .catch(() => showToast('Suppression impossible.'));
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 z-50 px-4 py-2 rounded-xl bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] text-[13px] text-text"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function RenameDialog({
  survey,
  onCancel,
  onConfirm,
}: {
  survey: SurveySummary;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(survey.name);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Renommer le survey"
        className="w-full max-w-sm rounded-[16px] bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] p-4"
      >
        <h2 className="text-[15px] font-medium text-text mb-3">Renommer</h2>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Nom du survey"
          className="w-full h-11 px-3 rounded-[10px] bg-bg border border-glass-border-soft text-text text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-[12px] border border-glass-border-soft text-text text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onConfirm(value.trim() || survey.name)}
            className="flex-1 h-11 rounded-[12px] bg-accent text-bg text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
