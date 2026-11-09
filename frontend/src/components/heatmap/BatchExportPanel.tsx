import { useId, useState } from 'react';
import type { ExportArea } from '../../lib/exportRegion';
import type { NetworkInfo } from '../../types/api';

export function BatchExportPanel({ networks, onExport, busy, progress, error, disabled, onCancel }: {
  networks: NetworkInfo[];
  onExport: (bssids: string[], area: ExportArea) => void;
  busy: boolean; progress: string; error: string | null; disabled: boolean; onCancel: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [region, setRegion] = useState<ExportArea>('full');
  const bssids = [...new Set(networks.map((network) => network.bssid).filter(Boolean))];
  const count = bssids.filter((bssid) => selected.includes(bssid)).length;
  const buttonClass = 'h-11 px-4 rounded-xl border border-glass-border-soft text-sm text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="mb-4">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={buttonClass}>
        Exporter plusieurs BSSID
      </button>
      {open && (
        <section id={id} aria-label="Export en lot" className="mt-3 p-4 rounded-xl border border-glass-border-soft space-y-4 text-sm text-text">
          <p>Sélectionne les BSSID du plan à exporter. Cette sélection ne modifie pas les filtres de la carte.</p>
          <fieldset disabled={busy} className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={bssids.length === 0} onClick={() => setSelected(bssids)}>Tout sélectionner</button>
            <button type="button" className={buttonClass} disabled={count === 0} onClick={() => setSelected([])}>Tout désélectionner</button>
          </fieldset>
          <fieldset disabled={busy}>
            <legend className="mb-2 font-medium">BSSID disponibles</legend>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {bssids.length === 0 && <p className="text-text-dim">Aucun BSSID disponible pour ce plan.</p>}
              {bssids.map((bssid) => {
                const network = networks.find((item) => item.bssid === bssid)!;
                return (
                  <label key={bssid} className="flex items-center gap-2 break-all">
                    <input type="checkbox" checked={selected.includes(bssid)} onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((previous) => checked ? [...previous, bssid] : previous.filter((item) => item !== bssid));
                    }} />
                    <span>{network.bssid_name && network.bssid_name !== bssid ? `${network.bssid_name} · ` : ''}{bssid}{network.ssid ? ` · ${network.ssid}` : ''}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset disabled={busy} className="flex flex-wrap gap-4">
            <legend className="mb-2 font-medium">Zone d’export</legend>
            <label className="flex items-center gap-2"><input type="radio" name={`${id}-region`} value="full" checked={region === 'full'} onChange={() => setRegion('full')} />Plan complet</label>
            <label className="flex items-center gap-2"><input type="radio" name={`${id}-region`} value="visible" checked={region === 'visible'} onChange={() => setRegion('visible')} />Zone visible</label>
          </fieldset>
          <p role="status" aria-live="polite">{count} BSSID sélectionné{count > 1 ? 's' : ''} sur {bssids.length}</p>
          <button type="button" disabled={busy || disabled || count === 0} onClick={() => onExport(bssids.filter((bssid) => selected.includes(bssid)), region)} aria-describedby={`${id}-help`} className={buttonClass}>Exporter en ZIP</button>
          <p id={`${id}-help`} className="text-text-dim">Un PNG par BSSID, avec les filtres SSID, bande et connexion actuels.</p>
          {progress && <p role="status" aria-live="polite">{progress}</p>}
          {error && <p role="alert" className="text-danger">{error}</p>}
          {busy && <button type="button" className={buttonClass} onClick={onCancel}>Annuler l’export</button>}
        </section>
      )}
    </div>
  );
}
