import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, Search, X } from 'lucide-react';
import type { ExportArea } from '../../lib/exportRegion';
import type { NetworkInfo } from '../../types/api';

interface Props {
  networks: NetworkInfo[];
  onExport: (bssids: string[], area: ExportArea) => void;
  busy: boolean;
  progress: string;
  error: string | null;
  disabled: boolean;
  onCancel: () => void;
  activeBssid?: string | null;
}

const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-glass-border-soft bg-glass-bg-soft px-4 text-sm font-medium text-text hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export function BatchExportPanel({ networks, onExport, busy, progress, error, disabled, onCancel, activeBssid }: Props) {
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [region, setRegion] = useState<ExportArea>('full');
  const [query, setQuery] = useState('');

  const available = useMemo(() => {
    const seen = new Set<string>();
    return networks.filter((network) => {
      const key = network.bssid?.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [networks]);
  const bssids = available.map((network) => network.bssid);
  const current = available.find((network) => network.bssid.toLowerCase() === activeBssid?.toLowerCase());
  const quick = current ? [current.bssid] : bssids;
  const customSelection = bssids.filter((bssid) => selected.includes(bssid));
  const chosen = custom ? customSelection : quick;
  const area: ExportArea = custom ? region : 'full';
  const filtered = available.filter((network) =>
    [network.bssid, network.ssid, network.bssid_name].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase().trim())
  );

  const close = () => {
    if (busy) return;
    setOpen(false);
    opener.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        setOpen(false);
        opener.current?.focus();
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), a[href]'
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, busy]);

  const chooseCustom = () => {
    setCustom(true);
    setSelected((previous) => previous.length ? previous : quick);
  };

  const toggle = (bssid: string) => setSelected((previous) =>
    previous.includes(bssid) ? previous.filter((item) => item !== bssid) : [...previous, bssid]
  );

  return (
    <div>
      <button ref={opener} type="button" onClick={() => setOpen(true)}
        aria-haspopup="dialog" aria-expanded={open} className={secondary}>
        <Download size={17} aria-hidden="true" /> Exporter plusieurs BSSID
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 md:items-center md:justify-center"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id}
            className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full flex-col overflow-hidden rounded-t-panel border border-glass-border-soft bg-glass-bg-soft text-text shadow-glass backdrop-blur-ui backdrop-saturate-150 md:max-h-[90dvh] md:max-w-[540px] md:rounded-panel">
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-glass-border md:hidden" aria-hidden="true" />
            <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-2 sm:px-5">
              <div className="min-w-0">
                <h2 id={id} className="text-sm font-medium text-text">Exporter plusieurs BSSID</h2>
                <p className="mt-0.5 text-[11px] text-muted">Prépare le ZIP sans modifier les filtres de la carte.</p>
              </div>
              <button ref={closeButton} type="button" disabled={busy} onClick={close}
                aria-label="Fermer" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-item text-text-dim transition-colors hover:bg-glass-bg hover:text-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
              <div role="group" aria-label="Mode d'export" className="grid grid-cols-2 gap-2 rounded-xl border border-glass-border-soft bg-glass-bg-soft p-1">
                <button type="button" aria-pressed={!custom} disabled={busy} onClick={() => setCustom(false)}
                  className={['min-h-11 rounded-lg px-2 text-sm font-medium', !custom ? 'bg-accent-soft text-accent ring-1 ring-accent-border' : 'text-text-dim hover:text-text'].join(' ')}>
                  Rapide
                </button>
                <button type="button" aria-pressed={custom} disabled={busy} onClick={chooseCustom}
                  className={['min-h-11 rounded-lg px-2 text-sm font-medium', custom ? 'bg-accent-soft text-accent ring-1 ring-accent-border' : 'text-text-dim hover:text-text'].join(' ')}>
                  Personnalisé
                </button>
              </div>

              {!custom ? (
                <div className="flex items-start gap-3 rounded-2xl border border-accent-border bg-accent-soft p-4">
                  <Check size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  <div>
                    <h3 className="font-medium">{current ? 'BSSID affiché sur la carte' : 'Tous les BSSID disponibles'}</h3>
                    <p className="mt-1 break-all text-sm text-text-dim">{current ? current.bssid : String(bssids.length) + ' BSSID du plan actif'}</p>
                    <p className="mt-2 text-xs text-text-dim">Plan complet · Un PNG par BSSID · Archive ZIP</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <section aria-label="Sélection des BSSID" className="rounded-2xl border border-glass-border-soft bg-glass-bg-soft p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div><h3 className="font-medium">BSSID</h3><p className="text-xs text-text-dim">{customSelection.length} / {bssids.length} sélectionnés</p></div>
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busy || customSelection.length === bssids.length} onClick={() => setSelected(bssids)}
                          className="min-h-11 rounded-lg px-3 text-xs text-accent hover:bg-accent-soft disabled:opacity-40">Tous</button>
                        <button type="button" disabled={busy || !customSelection.length} onClick={() => setSelected([])}
                          className="min-h-11 rounded-lg px-3 text-xs text-text-dim hover:bg-white/5 disabled:opacity-40">Aucun</button>
                      </div>
                    </div>
                    <label className="relative mb-3 block">
                      <span className="sr-only">Rechercher un BSSID</span>
                      <Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-text-dim" aria-hidden="true" />
                      <input type="search" value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)}
                        placeholder="Nom, SSID ou BSSID..." className="min-h-11 w-full rounded-xl border border-glass-border bg-glass-bg-soft pl-10 pr-3 text-sm outline-none focus:border-accent" />
                    </label>
                    <div className="max-h-56 space-y-1.5 overflow-y-auto">
                      {!filtered.length && <p className="py-4 text-center text-sm text-text-dim">Aucun résultat.</p>}
                      {filtered.map((network) => (
                        <label key={network.bssid} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-glass-border-soft px-3 py-2.5 hover:bg-white/5">
                          <input type="checkbox" checked={customSelection.includes(network.bssid)} disabled={busy}
                            onChange={() => toggle(network.bssid)} className="mt-1 h-5 w-5 shrink-0 accent-accent" />
                          <span className="min-w-0">
                            {network.bssid_name && network.bssid_name !== network.bssid &&
                              <span className="block text-sm font-medium">{network.bssid_name}</span>}
                            <span className="block break-all font-mono text-xs">{network.bssid}</span>
                            {network.ssid && <span className="block text-xs text-text-dim">{network.ssid}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                  <fieldset disabled={busy} className="space-y-2 rounded-2xl border border-glass-border-soft bg-glass-bg-soft p-4">
                    <legend className="px-1 font-medium">Zone à exporter</legend>
                    {([
                      { value: 'full', label: 'Plan complet', detail: 'Toute la surface du plan' },
                      { value: 'visible', label: 'Zone visible', detail: 'Partie affichée dans la carte' },
                    ] as const).map((option) => (
                      <label key={option.value} className={['flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3',
                        region === option.value ? 'border-accent-border bg-accent-soft' : 'border-glass-border-soft hover:bg-white/5'].join(' ')}>
                        <input type="radio" name={id + '-region'} value={option.value} checked={region === option.value}
                          onChange={() => setRegion(option.value)} className="mt-1 h-4 w-4 accent-accent" />
                        <span><span className="block font-medium">{option.label}</span>
                          <span className="block text-xs text-text-dim">{option.detail}</span></span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}

              <div className="rounded-xl border border-glass-border-soft bg-glass-bg-soft p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Récapitulatif</h3>
                  <span className="rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent">ZIP</span>
                </div>
                <p className="mt-1 text-sm">{chosen.length} BSSID · {area === 'full' ? 'Plan complet' : 'Zone visible'}</p>
                <p className="mt-1 text-xs text-text-dim">Un PNG par BSSID, avec les filtres SSID, bande et connexion actuels.</p>
              </div>
              {progress && <p role="status" aria-live="polite" className="rounded-xl border border-accent-border bg-accent-soft p-3 text-sm">{progress}</p>}
              {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">{error}</p>}
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-glass-border-soft px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-5 sm:pb-4">
              <button type="button" disabled={busy || disabled || chosen.length === 0}
                onClick={() => onExport(chosen, area)} className={primary + ' min-w-0 flex-1'}>
                <Download size={17} aria-hidden="true" />
                {busy ? 'Export en cours…' : 'Exporter ' + chosen.length + ' BSSID en ZIP'}
              </button>
              {busy
                ? <button type="button" onClick={onCancel} className={secondary}>Annuler l'export</button>
                : <button type="button" onClick={close} className={secondary}>Fermer</button>}
            </footer>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
