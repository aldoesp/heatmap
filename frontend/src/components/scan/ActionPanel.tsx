import { Check, Undo2, Wifi, LocateFixed, LoaderCircle } from 'lucide-react';

import type { SaveScanResponse } from '../../types/api';

interface ActionPanelProps {
  hint: string;
  busy: boolean;
  measuring: boolean;
  result: SaveScanResponse | null;
  onDetails: () => void;
  statusError: boolean;
  onRetryStatus: () => void;
  onRetryPoints?: () => void;
  hasPin: boolean;
  canScan: boolean;
  canUndo: boolean;
  canDone: boolean;
  scanConfirmed: boolean;
  onScan: () => void;
  onUndo: () => void;
  onDone: () => void;
  onRecenter: () => void;
}

export function ActionPanel({
  hint,
  busy,
  measuring,
  result,
  onDetails,
  statusError,
  onRetryStatus,
  onRetryPoints,
  hasPin,
  canScan,
  canUndo,
  canDone,
  scanConfirmed,
  onScan,
  onUndo,
  onDone,
  onRecenter,
}: ActionPanelProps) {
  return (
    <div
      className="glass-fallback fixed inset-x-3 z-[500] flex flex-col gap-3 rounded-panel border border-glass-border-soft bg-glass-bg-soft p-3 backdrop-blur-ui backdrop-saturate-150 shadow-glass md:inset-x-auto md:left-1/2 md:w-[560px] md:-translate-x-1/2"
      style={{ bottom: 'var(--nav-bottom-offset)' }}
      data-desktop-panel
    >
      {statusError && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-item bg-danger-soft px-3 py-2 text-sm">
          <span>Serveur inaccessible. Vérifie ta connexion.</span>
          <button type="button" className="btn-secondary min-h-11 px-3" onClick={onRetryStatus}>Réessayer</button>
        </div>
      )}
      {result && !busy && (
        <div className="rounded-item border border-accent-border bg-accent-soft px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <p role="status" className="text-sm text-text">
              Mesure enregistrée · {result.count} réseau{result.count > 1 ? 'x' : ''}
              {result.mode === 'test' && <span className="block text-xs text-warn">Données simulées</span>}
            </p>
            <button type="button" onClick={onDetails} className="min-h-11 text-sm font-medium text-accent underline underline-offset-4">Voir les détails</button>
          </div>
          {result.connection_warning && <p role="alert" className="mt-1 text-xs text-warn">{result.connection_warning}</p>}
          {result.count === 0 && <p className="text-xs text-warn">Aucun réseau détecté. Vérifie la connexion Wi-Fi avant de recommencer.</p>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div
          aria-live="polite"
          className={[
            'min-h-5 flex-1 text-center text-[12px] leading-snug',
            hasPin ? 'text-text' : 'text-text-dim',
          ].join(' ')}
        >
          {hint}
        </div>
        <button type="button" aria-label="Recentrer la carte sur le plan" title="Recentrer la carte sur le plan" onClick={onRecenter} className="icon-btn h-11 w-11 shrink-0">
          <LocateFixed size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {onRetryPoints && <button type="button" disabled={busy} onClick={onRetryPoints} className="btn-secondary min-h-11">Recharger les mesures</button>}
      <div className="flex h-11 min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label="Annuler le dernier point"
          disabled={!canUndo}
          onClick={onUndo}
          className="btn-secondary h-11 min-w-11 px-2 sm:px-3"
        >
          <Undo2 size={18} strokeWidth={1.75} aria-hidden />
          <span className="hidden sm:inline">Annuler</span>
        </button>

        <button
          type="button"
          disabled={!canScan}
          onClick={onScan}
          className={[
            'inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-item px-2 text-xs font-medium transition-colors duration-ui ease-ui disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:text-sm',
            scanConfirmed
              ? 'bg-live text-bg'
              : 'bg-accent text-bg hover:bg-[#0ea472]',
          ].join(' ')}
        >
          {measuring ? (
            <><LoaderCircle size={18} className="animate-spin" aria-hidden /><span>Mesure en cours…</span></>
          ) : scanConfirmed ? (
            <>
              <Check size={18} strokeWidth={1.75} aria-hidden />
              <span>Enregistré</span>
            </>
          ) : (
            <>
              <Wifi size={18} strokeWidth={1.75} aria-hidden />
              <span>Mesurer ici</span>
            </>
          )}
        </button>

        <button
          type="button"
          disabled={!canDone}
          onClick={onDone}
          className="btn-secondary h-11 px-2 text-xs sm:px-3 sm:text-sm"
        >
          Terminer
        </button>
      </div>
    </div>
  );
}
