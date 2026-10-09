import { useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
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

/**
 * Revue avant conservation : s'ouvre après chaque scan avec le résumé et
 * le détail repliable. Panneau opaque pour rester lisible par-dessus
 * la carte. Deux issues : Garder (conserve) ou Supprimer (efface le
 * relevé). Non bloquant : se ferme aussi par Escape ou clic extérieur
 * (= conserver, comme Garder).
 */
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

  useEffect(() => {
    if (!open) return;
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onKeep();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onKeep]);

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
        if (e.target === e.currentTarget) onKeep();
      }}
      className="fixed inset-0 z-[600] flex items-center justify-center p-5 bg-black/70"
    >
      <div className="max-w-[440px] w-full max-h-[85vh] overflow-y-auto rounded-card border border-white/10 bg-[#0d1319] shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-6 h-6 text-accent shrink-0" strokeWidth={2} aria-hidden />
          <div id="scanConfirmTitle" className="text-lg font-semibold text-text">
            Relevé à valider
          </div>
        </div>

        <div className="text-sm text-text-dim">
          x {formatPercent(x)} · y {formatPercent(y)} · {formatDate(result.scanned_at)}
        </div>
        <div className="inline-flex items-center gap-2 text-sm">
          <span className="px-2.5 py-1 rounded-lg bg-accent-soft border border-accent-border text-accent font-semibold">
            {result.count} réseau{result.count > 1 ? 'x' : ''}
          </span>
          <span className="text-text-dim">
            {result.mode === 'test' ? 'mode test' : 'mesure réelle'}
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
          <div className="px-3 py-2 rounded-xl border border-danger bg-danger-soft text-[13px] text-text">
            {result.connection_warning}
          </div>
        )}

        <details className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <summary className="px-3 py-2.5 text-sm font-medium text-text cursor-pointer list-none flex items-center justify-between [&::-webkit-details-marker]:hidden">
            <span>Détail des {result.count} réseaux</span>
            <span className="text-text-dim text-xs">▾</span>
          </summary>
          <div className="max-h-[32vh] overflow-y-auto flex flex-col gap-1.5 px-2 pb-2">
            {result.data.map((n) => (
              <div
                key={n.bssid}
                className="px-3 py-2 rounded-lg bg-black/30 border border-white/[0.06] text-[12px] leading-relaxed"
              >
                <div className="flex items-center gap-1.5 font-semibold text-text">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: rssiColor(n.rssi) }}
                  />
                  {n.ssid ?? '(réseau masqué)'}
                  {n.current && (
                    <span className="px-1.5 py-0.5 rounded-md bg-accent-soft border border-accent-border text-accent text-[10px] font-sans">
                      connecté
                    </span>
                  )}
                </div>
                <div className="font-mono text-text-dim">{n.bssid_name}</div>
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
                  <div className="font-mono text-text-dim break-all">
                    [{n.capabilities.join('][')}]
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>

        {error && <div className="text-danger text-[13px]">{error}</div>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={discarding}
            className="flex-1 inline-flex items-center justify-center h-12 rounded-item text-sm font-medium border border-glass-border-soft text-text-dim bg-transparent hover:text-danger hover:border-danger transition-colors duration-ui ease-ui disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {discarding ? 'Suppression…' : 'Supprimer'}
          </button>
          <button
            ref={keepRef}
            type="button"
            onClick={onKeep}
            disabled={discarding}
            className="flex-1 inline-flex items-center justify-center h-12 rounded-item text-sm font-semibold bg-accent text-[#0b0f14] hover:bg-[#0ea472] transition-colors duration-ui ease-ui disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Garder
          </button>
        </div>
      </div>
    </div>
  );
}
