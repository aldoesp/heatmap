import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, FileUp, Search, Upload } from 'lucide-react';
import { useSurveysLibrary, type SurveySummary } from '../../hooks/useSurveysLibrary';
import {
  exportPlansZip,
  importSurveys,
  previewSurveyImport,
  type SurveyImportPreview,
  type SurveyImportResolution,
  type SurveyImportResult,
} from '../../lib/api';
import { ApiError } from '../../types/api';
import { SurveyCard } from './SurveyCard';
import { SurveySheet } from './SurveySheet';
import { ConfirmDelete } from './ConfirmDelete';
import { PointsTable, type PointRow } from './PointsTable';

type SortMode = 'recent' | 'name' | 'rssi';

const ERR_IMPORT_CSV = 'Impossible d’importer ce fichier CSV. Vérifie le format.';
const ERR_IMPORT_ZIP = 'Impossible d’importer ce fichier ZIP.';
const ERR_EXPORT = 'Impossible d’exporter les relevés sélectionnés.';

type PendingImport = {
  file: File;
  preview: SurveyImportPreview;
  resolutions: Record<string, SurveyImportResolution>;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.message ? error.message : fallback;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SurveysLibraryPage() {
  const {
    surveys,
    details,
    loading,
    error,
    importing,
    busyId,
    load,
    importCsv,
    rename,
    remove,
    exportCsv,
    openSection,
  } = useSurveysLibrary();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<SurveySummary | null>(null);
  const [renaming, setRenaming] = useState<SurveySummary | null>(null);
  const [confirming, setConfirming] = useState<SurveySummary | null>(null);
  const [viewPoints, setViewPoints] = useState<SurveySummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [zipImporting, setZipImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importResult, setImportResult] = useState<SurveyImportResult | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!sortOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSortOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [sortOpen]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectionMode = () => {
    setSelecting((value) => !value);
    setSelectedIds(new Set());
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const allSelected =
        filtered.length > 0 && filtered.every((survey) => prev.has(survey.id));
      return allSelected ? new Set() : new Set(filtered.map((survey) => survey.id));
    });
  };

  const onExportSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || exporting) return;
    setExporting(true);
    setImportError(null);
    try {
      const blob = await exportPlansZip(ids);
      downloadBlob(blob, blob.filename ?? 'heatmap-surveys.zip');
      showToast('Export prêt.');
    } catch (err) {
      setImportError(errorMessage(err, ERR_EXPORT));
    } finally {
      setExporting(false);
    }
  };

  const performImport = async (
    file: File,
    resolutions: Record<string, SurveyImportResolution>,
  ) => {
    const result = await importSurveys(file, resolutions);
    setPendingImport(null);
    setImportResult(result);
  };

  const onPickZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    setZipImporting(true);
    try {
      const preview = await previewSurveyImport(file);
      const conflicts = preview.plans.filter((plan) => plan.existsOnDevice);
      if (conflicts.length > 0) {
        setPendingImport({ file, preview, resolutions: {} });
      } else {
        await performImport(file, {});
      }
    } catch (err) {
      setImportError(errorMessage(err, ERR_IMPORT_ZIP));
    } finally {
      setZipImporting(false);
    }
  };

  const onConfirmImport = async () => {
    if (!pendingImport) return;
    const conflicts = pendingImport.preview.plans.filter(
      (plan) => plan.existsOnDevice,
    );
    if (!conflicts.every((plan) => pendingImport.resolutions[plan.id])) return;
    setImportError(null);
    setZipImporting(true);
    try {
      await performImport(pendingImport.file, pendingImport.resolutions);
    } catch (err) {
      setImportError(errorMessage(err, ERR_IMPORT_ZIP));
    } finally {
      setZipImporting(false);
    }
  };

  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      await importCsv(file);
      showToast('CSV importé.');
    } catch {
      setImportError(ERR_IMPORT_CSV);
    }
  };

  const openPoints = (survey: SurveySummary) => {
    if (!details.has(survey.id)) {
      showToast('Impossible de charger les points.');
      load();
      return;
    }
    setViewPoints(survey);
    setSheet(null);
  };

  const pointDetails = viewPoints ? details.get(viewPoints.id) : undefined;
  const pointRows = useMemo<PointRow[]>(() => {
    if (!pointDetails) return [];
    const { history, heat } = pointDetails;
    const best = new Map<string, number>();
    for (const row of heat) {
      const prev = best.get(row.scan_point_id);
      if (prev === undefined || row.rssi > prev) best.set(row.scan_point_id, row.rssi);
    }
    return history.map((h) => {
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
  }, [pointDetails]);

  if (viewPoints) {
    return (
      <PointsTable
        surveyName={surveys.find(survey => survey.id === viewPoints.id)?.name ?? viewPoints.name}
        rows={pointRows}
        onBack={() => setViewPoints(null)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-28 pt-8 md:px-6 md:pb-12">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <p className="label mb-2">Bibliothèque</p>
          <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em]">Relevés</h1>
          <p className="mt-1.5 text-sm text-text-dim">
            {surveys.length} relevé{surveys.length > 1 ? 's' : ''} importé{surveys.length > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={toggleSelectionMode}
            className="btn-secondary h-10"
          >
            {selecting ? 'Annuler' : 'Sélectionner'}
          </button>
          <button
            type="button"
            onClick={() => zipRef.current?.click()}
            disabled={importing || zipImporting}
            aria-label="Importer un export ZIP de relevés"
            className="btn-primary h-10"
          >
            <Upload className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {zipImporting ? 'Import…' : 'Importer ZIP'}
          </button>
          <button
            type="button"
            onClick={() => csvRef.current?.click()}
            disabled={importing || zipImporting}
            aria-label="Importer un CSV"
            className="btn-secondary h-10"
          >
            <FileUp className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            Importer CSV
          </button>
        </div>
        <input
          ref={zipRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={onPickZip}
          aria-hidden="true"
          tabIndex={-1}
        />
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onPickCsv}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {selecting && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-item border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui px-3 py-2">
          <span className="min-w-40 flex-1 font-mono text-[11px] text-text-dim">
            {selectedIds.size} relevé{selectedIds.size > 1 ? 's' : ''} sélectionné
            {selectedIds.size > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={toggleAllVisible}
            disabled={filtered.length === 0}
            className="btn-ghost h-9 px-3 text-[13px]"
          >
            {filtered.length > 0 && filtered.every((survey) => selectedIds.has(survey.id))
              ? 'Tout désélectionner'
              : 'Tout sélectionner'}
          </button>
          <button
            type="button"
            onClick={() => void onExportSelected()}
            disabled={selectedIds.size === 0 || exporting}
            title="Exporte tous les relevés de ces plans"
            className="btn-secondary h-9 px-3 text-[13px]"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {exporting ? 'Export…' : `Exporter (${selectedIds.size})`}
          </button>
        </div>
      )}

      {importError && (
        <p role="alert" className="mb-3 text-[13px] text-danger">
          {importError}
        </p>
      )}

      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un relevé"
            aria-label="Rechercher un relevé"
            className="field pl-10"
          />
        </div>
        <div ref={sortRef} className="relative md:w-44">
          <button type="button" aria-label="Trier les relevés" aria-haspopup="listbox" aria-expanded={sortOpen}
            onClick={() => setSortOpen((open) => !open)}
            className="field flex w-full items-center justify-between gap-3 text-left">
            <span className="truncate">{sort === 'recent' ? 'Récents' : sort === 'name' ? 'Nom' : 'RSSI moyen'}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-text-dim transition-transform ${sortOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {sortOpen && <div role="listbox" aria-label="Trier les relevés" className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-glass-border bg-[#111923] p-1 shadow-glass">
            {([
              { value: 'recent', label: 'Récents', description: 'Les derniers relevés en premier' },
              { value: 'name', label: 'Nom', description: 'Ordre alphabétique' },
              { value: 'rssi', label: 'RSSI moyen', description: 'Signal moyen le plus fort en premier' },
            ] as const).map((option) => <button key={option.value} type="button" role="option" aria-selected={sort === option.value}
              onClick={() => { setSort(option.value); setSortOpen(false); }}
              className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left ${sort === option.value ? 'bg-accent-soft text-accent' : 'text-text hover:bg-white/5'}`}>
              <span><span className="block text-sm font-medium">{option.label}</span><span className="block text-[11px] text-text-dim">{option.description}</span></span>
              {sort === option.value && <Check className="h-4 w-4 shrink-0" aria-hidden />}
            </button>)}
          </div>}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-[13px] text-text">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline font-medium">
            Réessayer
          </button>
        </div>
      )}

      {loading || importing || zipImporting ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              aria-hidden={i > 0}
              className="flex min-h-[120px] items-center justify-center rounded-card border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui"
            >
              {(importing || zipImporting) && i === 0 && (
                <span className="text-[13px] text-text-dim">Import en cours…</span>
              )}
            </div>
          ))}
        </div>
      ) : surveys.length === 0 && !error ? (
        <div className="text-center py-16">
          <p className="mb-1 text-sm font-medium text-text">Aucun relevé importé</p>
          <p className="mb-4 text-[13px] text-text-dim">
            Ajoute un export ZIP de relevés pour commencer.
          </p>
          <button
            type="button"
            onClick={() => zipRef.current?.click()}
            className="btn-primary h-10 px-5"
          >
            Importer un ZIP
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-text-dim">
          Aucun relevé ne correspond à cette recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => (
            <SurveyCard
              key={s.id}
              survey={s}
              busy={busyId === s.id}
              selectable={selecting}
              selected={selectedIds.has(s.id)}
              onSelect={(survey) => toggleSelected(survey.id)}
              onOpenMenu={setSheet}
              onHeatmap={(x) => openSection(x, 'heatmap')}
            />
          ))}
        </div>
      )}

      {sheet && (
        <SurveySheet
          survey={sheet}
          onClose={() => setSheet(null)}
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
                showToast('Relevé renommé.');
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
                showToast('Relevé supprimé.');
              })
              .catch(() => showToast('Suppression impossible.'));
          }}
        />
      )}

      {pendingImport && (
        <ResolveImportDialog
          preview={pendingImport.preview}
          resolutions={pendingImport.resolutions}
          busy={zipImporting}
          error={importError}
          onChange={(planId, resolution) =>
            setPendingImport((current) =>
              current
                ? {
                    ...current,
                    resolutions: { ...current.resolutions, [planId]: resolution },
                  }
                : current,
            )
          }
          onCancel={() => {
            setPendingImport(null);
            setImportError(null);
          }}
          onConfirm={() => void onConfirmImport()}
        />
      )}

      {importResult && (
        <ImportSummaryDialog
          result={importResult}
          onClose={() => setImportResult(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-item border border-glass-border-soft bg-glass-bg backdrop-blur-ui px-4 py-2 text-[13px] text-text md:bottom-6"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function ResolveImportDialog({
  preview,
  resolutions,
  busy,
  error,
  onChange,
  onCancel,
  onConfirm,
}: {
  preview: SurveyImportPreview;
  resolutions: Record<string, SurveyImportResolution>;
  busy: boolean;
  error: string | null;
  onChange: (planId: string, resolution: SurveyImportResolution) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const conflicts = preview.plans.filter((plan) => plan.existsOnDevice);
  const ready = conflicts.every((plan) => Boolean(resolutions[plan.id]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Plans déjà présents"
        className="w-full max-w-md rounded-[16px] border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 shadow-glass-light p-4"
      >
        <h2 className="text-[15px] font-medium text-text mb-1">Plans déjà présents</h2>
        <p className="text-[13px] text-text-dim mb-3">
          Choisissez ce que l’import doit faire pour chaque plan existant.
        </p>

        <ul className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-1">
          {conflicts.map((plan) => (
            <li
              key={plan.id}
              className="rounded-[12px] border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] text-text truncate">{plan.name}</div>
                  <div className="text-[12px] text-text-dim">
                    {plan.surveyCount} relevé{plan.surveyCount > 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['merge', 'duplicate'] as const).map((resolution) => {
                  const active = resolutions[plan.id] === resolution;
                  return (
                    <label
                      key={resolution}
                      className={[
                        'inline-flex items-center justify-center min-h-9 px-3 rounded-[10px] border text-[13px] font-medium cursor-pointer focus-within:ring-2 focus-within:ring-accent',
                        active
                          ? 'border-accent-border bg-accent-soft text-accent'
                          : 'border-glass-border-soft bg-glass-bg-soft text-text-dim',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name={`resolution-${plan.id}`}
                        value={resolution}
                        checked={active}
                        onChange={() => onChange(plan.id, resolution)}
                        className="sr-only"
                      />
                      {resolution === 'merge' ? 'Fusionner' : 'Dupliquer'}
                    </label>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 h-11 rounded-[12px] border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui text-text text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !ready}
            className="flex-1 h-11 rounded-[12px] bg-accent text-bg text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {busy ? 'Import…' : 'Importer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportSummaryDialog({
  result,
  onClose,
}: {
  result: SurveyImportResult;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = [
    ['Relevés importés', result.importedSurveys.length],
    ['Relevés ignorés', result.skippedSurveys.length],
    ['Points de scan', result.scanPoints],
    ['Scans', result.scans],
    ['Observations', result.observations],
    ['Plans créés', result.plansCreated],
    ['Plans fusionnés', result.plansMerged],
    ['Règles BSSID ajoutées', result.bssidRulesAdded],
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Résumé de l’import"
        className="w-full max-w-sm rounded-[16px] border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 shadow-glass-light p-4"
      >
        <h2 className="text-[15px] font-medium text-text mb-3">Import terminé</h2>
        <dl className="grid grid-cols-2 gap-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="rounded-[10px] border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui px-3 py-2"
            >
              <dt className="text-[12px] text-text-dim">{label}</dt>
              <dd className="text-[16px] text-text">{value}</dd>
            </div>
          ))}
        </dl>
        {result.skippedSurveys.length > 0 && (
          <p className="mt-3 text-[12px] text-text-dim">
            Ignorés : {result.skippedSurveys.map((survey) => survey.name).join(', ')}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full h-11 mt-4 rounded-[12px] bg-accent text-bg text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Fermer
        </button>
      </div>
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
        aria-label="Renommer le relevé"
        className="w-full max-w-sm rounded-[16px] border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 shadow-glass-light p-4"
      >
        <h2 className="text-[15px] font-medium text-text mb-3">Renommer</h2>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Nom du relevé"
          className="w-full h-11 px-3 rounded-[10px] bg-glass-bg-soft border border-glass-border backdrop-blur-ui text-text text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-[12px] border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui text-text text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
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
