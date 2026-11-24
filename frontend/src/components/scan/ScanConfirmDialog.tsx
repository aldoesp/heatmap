import { useEffect, useRef } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import type { SaveScanResponse } from '../../types/api';
import { formatPercent, formatMbps } from '../../lib/format';

interface ScanConfirmDialogProps {
  open: boolean;
  result: SaveScanResponse | null;
  x: number;
  y: number;
  discarding: boolean;
  error: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}

function rssiColor(rssi: number): string {
  if (rssi >= -55) return '#10b981';
  if (rssi >= -67) return '#a3e635';
  if (rssi >= -75) return '#f59e0b';
  if (rssi >= -85) return '#f97316';
  return '#ef4444';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Détails du dernier relevé, ouverts à la demande après son enregistrement. */
export function ScanConfirmDialog({
  open,
  result,
  x,
  y,
  discarding,
  error,
  onKeep,
  onDiscard,
}: ScanConfirmDialogProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !discarding) {
        e.preventDefault();
        onKeep();
      }
      if (e.key === 'Tab') {
        const buttons = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary');
        if (!buttons?.length) { e.preventDefault(); return; }
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, onKeep, discarding]);

  if (!open || !result) return null;

  const gateway = result.gateway;
  const gatewayText = !gateway
    ? null
    : gateway.medianRttMs !== null
      ? `${gateway.gatewayIp} · ${gateway.medianRttMs} ms · perte ${gateway.packetLossPercent ?? '?'} %`
      : gateway.error && gateway.error !== 'Mesure désactivée.'
        ? `Passerelle injoignable (${gateway.gatewayIp ?? 'inconnue'})`
        : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanConfirmTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget && !discarding) onKeep();
      }}
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 p-4 md:p-6"
    >
      <div ref={panelRef} className="glass-fallback flex max-h-[85vh] w-full max-w-[460px] flex-col gap-4 overflow-y-auto rounded-panel border border-glass-border-soft bg-glass-bg-soft p-5 backdrop-blur-ui backdrop-saturate-150 shadow-glass">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-live" strokeWidth={1.75} aria-hidden />
          <div id="scanConfirmTitle" className="text-base font-medium text-text">
            Mesure enregistrée
          </div>
        </div>

        <div className="font-mono text-[11px] text-muted">
          x {formatPercent(x)} · y {formatPercent(y)} · {formatDate(result.scanned_at)}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-glass-border-soft bg-glass-bg px-2 py-1 font-mono text-[11px] text-text">
            <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden />
            {result.count} réseau{result.count > 1 ? 'x' : ''}
          </span>
          <span className="text-text-dim">
            {result.mode === 'test' ? 'Données simulées' : 'Mesure réelle'}
            {result.rejected_count > 0
              ? ` · ${result.rejected_count} rejeté${result.rejected_count > 1 ? 's' : ''}`
              : ''}
          </span>
        </div>
        {gatewayText && (
          <div className="text-[13px] font-mono text-text-dim">
            Passerelle : {gatewayText}
          </div>
        )}
        {result.speed && (result.speed.tcp_down_bps !== null || result.speed.tcp_up_bps !== null) && (
          <div className="text-[13px] font-mono text-text-dim">
            Débit : ↓ {formatMbps(result.speed.tcp_down_bps)} · ↑ {formatMbps(result.speed.tcp_up_bps)}
          </div>
        )}
        {result.connection_warning && (
          <div className="rounded-item border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-text">
            {result.connection_warning}
          </div>
        )}

        <details className="group overflow-hidden rounded-item border border-glass-border-soft">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium text-text [&::-webkit-details-marker]:hidden">
            <span>Détail des {result.count} réseaux</span>
            <ChevronDown
              className="h-4 w-4 text-muted transition-transform duration-ui ease-ui group-open:rotate-180"
              strokeWidth={1.75}
              aria-hidden
            />
          </summary>
          <div className="flex max-h-[32vh] flex-col gap-px overflow-y-auto border-t border-glass-border-soft bg-glass-bg p-1">
            {result.data.map((n) => (
              <div
                key={n.bssid}
                className="rounded-md px-3 py-2 text-[12px] leading-relaxed"
              >
                <div className="flex items-center gap-1.5 font-medium text-text">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: rssiColor(n.rssi) }}
                  />
                  {n.ssid ?? '(réseau masqué)'}
                  {n.current && (
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-live">
                      <span className="h-1 w-1 rounded-full bg-live" aria-hidden />
                      connecté
                    </span>
                  )}
                </div>
                <div className="font-mono text-muted">{n.bssid_name}</div>
                <div className="font-mono text-text-dim">
                  {n.rssi} dBm · qualité {n.quality} ({n.level}) · {n.band} ·{' '}
                  {n.frequency_mhz} MHz{n.channel !== null ? ` · canal ${n.channel}` : ''}
                </div>
                <div className="font-mono text-text-dim">
                  {n.security} · {n.standard}
                  {n.bandwidth_mhz !== null ? ` · ${n.bandwidth_mhz} MHz` : ''}
                  {n.center_frequency_mhz !== null
                    ? ` · centre ${n.center_frequency_mhz} MHz`
                    : ''}
                  {n.center_channel !== null ? ` (canal ${n.center_channel})` : ''}
                  {n.virtual_bssid ? ' · BSSID virtuel' : ''}
                  {n.unreliable_bssid ? ' · BSSID masqué par Android' : ''}
                  {n.hidden ? ' · masqué' : ''}
                </div>
                {n.capabilities.length > 0 && (
                  <div className="break-all font-mono text-muted">
                    [{n.capabilities.join('][')}]
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>

        {error && <div className="text-[13px] text-danger">{error}</div>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={discarding}
            className="btn-ghost h-11 flex-1 hover:text-danger"
          >
            {discarding ? 'Suppression…' : 'Supprimer'}
          </button>
          <button
            ref={keepRef}
            type="button"
            onClick={onKeep}
            disabled={discarding}
            className="btn-primary h-11 flex-1"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
