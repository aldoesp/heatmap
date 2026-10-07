import { useCallback, useEffect, useState } from 'react';
import { usePlanImage } from '../../hooks/usePlanImage';
import { getHistory } from '../../lib/api';
import { ApiError, type ScanHistoryEntry } from '../../types/api';
import { formatPercent } from '../../lib/format';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SurveysPage() {
  const { plan, loading: planLoading, imageMissing, error: planError } = usePlanImage();
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!plan) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const h = await getHistory(plan.id);
      setHistory(h);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de charger les relevés.');
    } finally {
      setLoading(false);
    }
  }, [plan]);

  useEffect(() => {
    if (planLoading) return;
    (async () => {
      await load();
    })();
  }, [planLoading, load]);

  const handleSurveys = useCallback(() => {
    location.hash = '#/scan';
  }, []);

  if (planLoading || loading) {
    return <div className="fixed inset-0 bg-bg" />;
  }

  if (planError && !plan) {
    return (
      <div className="max-w-150 mx-auto px-4 py-16 text-center">
        <p className="text-text text-[15px] mb-4">{planError}</p>
        <button
          type="button"
          onClick={() => {
            location.hash = '#/upload';
          }}
          className="inline-flex items-center h-12 px-5 rounded-[14px] bg-accent text-bg font-medium text-[15px]"
        >
          Importer un plan
        </button>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="max-w-150 mx-auto px-4 py-16 text-center">
        <p className="text-text text-[15px] mb-4">Aucun plan pour le moment.</p>
        <button
          type="button"
          onClick={() => {
            location.hash = '#/upload';
          }}
          className="inline-flex items-center h-12 px-5 rounded-[14px] bg-accent text-bg font-medium text-[15px]"
        >
          Importer un plan
        </button>
      </div>
    );
  }

  const totalScans = history.reduce((n, p) => n + p.scans.length, 0);

  return (
    <div className="max-w-300 mx-auto px-4 py-6 lg:px-6 lg:py-8">
      <div className="mb-6">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">Relevés</h1>
        <p className="text-text-dim text-sm">
          {plan.name} · {history.length} emplacement{history.length > 1 ? 's' : ''} ·{' '}
          {totalScans} scan{totalScans > 1 ? 's' : ''}
          {imageMissing ? ' · image du plan introuvable' : ''}
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-sm text-text">
          {error}{' '}
          <button type="button" onClick={load} className="underline font-medium">
            Réessayer
          </button>
        </div>
      )}

      {history.length === 0 && !error ? (
        <div className="text-center py-16">
          <p className="text-text text-[15px] mb-2">Aucun relevé pour ce plan.</p>
          <p className="text-text-dim text-sm mb-4">
            Place un point sur la carte puis appuie sur Scan.
          </p>
          <button
            type="button"
            onClick={handleSurveys}
            className="inline-flex items-center h-12 px-5 rounded-[14px] bg-accent text-bg font-medium text-[15px]"
          >
            Aller au scan
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((point, i) => {
            const open = openId === point.id;
            const last = point.scans[point.scans.length - 1];
            return (
              <div
                key={point.id}
                className="glass-fallback bg-glass-bg-soft border border-glass-border-soft rounded-card p-4"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : point.id)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 text-left"
                >
                  <span className="flex items-center gap-3">
                    <span className="shrink-0 w-7 h-7 rounded-full bg-accent text-[#0b0f14] font-mono text-[12px] font-semibold flex items-center justify-center">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>
                      <span className="block text-sm font-medium">
                        x {formatPercent(point.x)} · y {formatPercent(point.y)}
                      </span>
                      <span className="block text-[12px] text-text-dim font-mono">
                        {formatDate(point.created_at)} · {point.scans.length} scan
                        {point.scans.length > 1 ? 's' : ''}
                        {last
                          ? ` · dernier : ${last.network_count} réseau${last.network_count > 1 ? 'x' : ''}`
                          : ''}
                      </span>
                    </span>
                  </span>
                  <span className="text-text-dim text-sm">{open ? '▴' : '▾'}</span>
                </button>

                {open && (
                  <div className="mt-3 flex flex-col gap-2">
                    {point.scans.length === 0 && (
                      <p className="text-[13px] text-text-dim">
                        Aucun scan enregistré à cet emplacement.
                      </p>
                    )}
                    {point.scans.map((s) => (
                      <div
                        key={s.id}
                        className="px-3 py-2 rounded-xl bg-[rgba(255,255,255,0.03)] border border-glass-border-soft text-[13px] font-mono text-text-dim"
                      >
                        {formatDate(s.scanned_at)} · {s.network_count} réseau
                        {s.network_count > 1 ? 'x' : ''} ·{' '}
                        {s.mode === 'test' ? 'mode test' : 'mesure réelle'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
