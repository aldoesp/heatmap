import { useId, useMemo, useState } from 'react';
import { ChevronDown, CircleAlert, Filter, Info, Radio, RefreshCw, ScanLine, Upload, Wifi } from 'lucide-react';
import {
  aggregateChannelNetworks,
  CHANNEL_PALETTE,
  filterBestNetworks,
  findChannelOverlaps,
  type ChannelBand,
  type ChannelNetwork,
  type ChannelOverlap,
} from '../../lib/channelAnalysis';
import { rssiColor } from '../../lib/signal';
import { useChannelAnalysis } from '../../hooks/useChannelAnalysis';
import { ChannelChart } from './ChannelChart';

const BAND_OPTIONS: Array<{ value: ChannelBand; label: string; short: string }> = [
  { value: '2.4', label: '2,4 GHz', short: '2,4' },
  { value: '5', label: '5 GHz', short: '5' },
];

function networkLabel(network: ChannelNetwork): string {
  if (network.ssid) return network.ssid;
  return network.hidden ? 'Réseau masqué' : 'SSID inconnu';
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatChannel(network: ChannelNetwork): string {
  if (network.centerChannel !== network.channel) {
    return `${network.channel} · centre ${network.centerChannel}`;
  }
  return String(network.channel);
}

function formatWidth(network: ChannelNetwork): string {
  return `${network.widthEstimated ? '~' : ''}${network.widthMhz} MHz`;
}

export function ChannelAnalyzerPage() {
  const { plan, planLoading, planError, samples, loading, error, reload } =
    useChannelAnalysis();
  const [band, setBand] = useState<ChannelBand>('2.4');
  const [bestOnly, setBestOnly] = useState(false);
  const [selectedBssid, setSelectedBssid] = useState<string | null>(null);

  const networks24 = useMemo(
    () => aggregateChannelNetworks(samples, '2.4'),
    [samples],
  );
  const networks5 = useMemo(
    () => aggregateChannelNetworks(samples, '5'),
    [samples],
  );
  const bandNetworks = band === '2.4' ? networks24 : networks5;
  const otherNetworks = band === '2.4' ? networks5 : networks24;
  const networks = useMemo(
    () => (bestOnly ? filterBestNetworks(bandNetworks) : bandNetworks),
    [bandNetworks, bestOnly],
  );

  // Couleurs calculées sur la bande complète : elles ne changent pas quand le
  // filtre masque puis réaffiche un BSSID.
  const colours = useMemo(() => {
    const map = new Map<string, string>();
    bandNetworks.forEach((network, index) => {
      map.set(network.bssid, CHANNEL_PALETTE[index % CHANNEL_PALETTE.length]);
    });
    return map;
  }, [bandNetworks]);

  const overlaps = useMemo(() => findChannelOverlaps(networks), [networks]);
  const selected =
    networks.find((network) => network.bssid === selectedBssid) ?? null;

  const changeBand = (next: ChannelBand) => {
    setBand(next);
    setSelectedBssid(null);
  };

  const hasAnyNetwork = networks24.length + networks5.length > 0;
  const totalSamples = samples.length;

  return (
    <div className="page-shell">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="label mb-2">Spectre</p>
          <h1 className="page-title">Analyseur Wi-Fi</h1>
          <p className="mt-1.5 text-sm text-text-dim">
            {plan ? `${plan.name} · ${networks.length} BSSID en ${band === '2.4' ? '2,4' : '5'} GHz` : 'Analyse des canaux enregistrés'}
            {totalSamples > 0 ? ` · ${totalSamples} observation${totalSamples > 1 ? 's' : ''}` : ''}
          </p>
        </div>

        <div
          role="group"
          aria-label="Bande de fréquence"
          className="flex h-11 w-full shrink-0 overflow-hidden rounded-xl border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui sm:w-auto"
        >
          {BAND_OPTIONS.map((option) => {
            const count = option.value === '2.4' ? networks24.length : networks5.length;
            const active = band === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => changeBand(option.value)}
                className={[
                  'flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors duration-ui sm:flex-none',
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-dim hover:bg-glass-bg hover:text-text',
                ].join(' ')}
              >
                <span>{option.label}</span>
                <span className="font-mono text-[11px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-text"
        >
          <CircleAlert className="h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="btn-secondary h-9 px-3 text-[13px]"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Réessayer
          </button>
        </div>
      )}

      {planError && !plan && !planLoading ? (
        <EmptyPanel
          icon={<CircleAlert className="h-6 w-6 text-danger" strokeWidth={1.75} aria-hidden />}
          title="Plan indisponible"
          description={planError}
        />
      ) : planLoading || loading ? (
        <div className="panel flex min-h-[320px] items-center justify-center">
          <p role="status" className="text-sm text-text-dim">
            Chargement des observations Wi-Fi…
          </p>
        </div>
      ) : !plan ? (
        <EmptyPanel
          icon={<Wifi className="h-6 w-6 text-accent" strokeWidth={1.75} aria-hidden />}
          title="Aucun plan actif"
          description="Importe un plan, place des points de mesure puis lance un scan pour analyser les canaux."
          action={{ href: '#/upload', label: 'Importer un plan', icon: <Upload className="h-4 w-4" strokeWidth={1.75} aria-hidden /> }}
        />
      ) : !hasAnyNetwork && totalSamples === 0 ? (
        <EmptyPanel
          icon={<ScanLine className="h-6 w-6 text-accent" strokeWidth={1.75} aria-hidden />}
          title="Aucune observation Wi-Fi"
          description="Effectue au moins un scan sur ce plan. Les canaux, fréquences et largeurs enregistrés par le backend seront utilisés ici."
          action={{ href: '#/scan', label: 'Aller aux mesures', icon: <Radio className="h-4 w-4" strokeWidth={1.75} aria-hidden /> }}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
          <section aria-label={`Canaux ${band === '2.4' ? '2,4' : '5'} GHz`} className="panel min-w-0 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text">
                Canaux {band === '2.4' ? '2,4 GHz' : '5 GHz'}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={bestOnly}
                  onClick={() => setBestOnly((value) => !value)}
                  title="Ne garder que le BSSID au meilleur RSSI pour chaque SSID"
                  className={[
                    'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors duration-ui',
                    bestOnly
                      ? 'border-accent-border bg-accent-soft text-accent'
                      : 'border-glass-border-soft text-text-dim hover:bg-glass-bg hover:text-text',
                  ].join(' ')}
                >
                  <Filter className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  Meilleurs AP
                </button>
                <p className="font-mono text-[11px] text-text-dim">
                  {networks.length} BSSID · {overlaps.length} chevauchement{overlaps.length > 1 ? 's' : ''}
                  {bestOnly ? ' · filtre actif' : ''}
                </p>
              </div>
            </div>

            {networks.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center px-4 text-center">
                <Radio className="mb-3 h-6 w-6 text-text-dim" strokeWidth={1.75} aria-hidden />
                <p className="text-sm font-medium text-text">
                  Aucun réseau en {band === '2.4' ? '2,4' : '5'} GHz
                </p>
                <p className="mt-1 max-w-sm text-[13px] text-text-dim">
                  Les observations de ce plan ne contiennent aucun BSSID sur cette bande.
                  {otherNetworks.length > 0
                    ? ` ${otherNetworks.length} BSSID sont disponibles en ${band === '2.4' ? '5' : '2,4'} GHz.`
                    : ''}
                </p>
                {otherNetworks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => changeBand(band === '2.4' ? '5' : '2.4')}
                    className="btn-secondary mt-4 h-10 px-4"
                  >
                    Voir {band === '2.4' ? '5 GHz' : '2,4 GHz'}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <ChannelChart
                    band={band}
                    networks={networks}
                    colours={colours}
                    selectedBssid={selectedBssid}
                    onSelect={setSelectedBssid}
                  />
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-text-dim">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span>
                    Meilleur RSSI enregistré par BSSID sur le dernier scan de chaque point.
                    {bestOnly
                      ? ' Seul le BSSID au meilleur signal de chaque SSID est affiché ; les réseaux masqués restent individuels.'
                      : ''}
                    La largeur de courbe suit la largeur de canal mesurée ; sans mesure,
                    une largeur de 20 MHz est tracée en pointillés.
                  </span>
                </p>
              </>
            )}
          </section>

          <aside className="flex min-w-0 flex-col gap-4">
            {selected && (
              <NetworkDetails
                network={selected}
                colour={colours.get(selected.bssid) ?? '#10b981'}
                onClear={() => setSelectedBssid(null)}
              />
            )}

            <CollapsiblePanel
              title="Réseaux"
              meta={<span className="text-[11px] text-text-dim">Triés par signal</span>}
            >
              {networks.length > 0 ? (
                <ul className="max-h-[360px] space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {networks.map((network) => {
                    const active = network.bssid === selectedBssid;
                    return (
                      <li key={network.bssid}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setSelectedBssid(active ? null : network.bssid)
                          }
                          className={[
                            'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors duration-ui',
                            active
                              ? 'border-accent-border bg-accent-soft'
                              : 'border-transparent hover:border-glass-border-soft hover:bg-glass-bg',
                          ].join(' ')}
                        >
                          <span
                            aria-hidden
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: colours.get(network.bssid) }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-text">
                              {networkLabel(network)}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-text-dim">
                              {network.bssid} · canal {network.channel} · {formatWidth(network)}
                            </span>
                          </span>
                          <span
                            className="shrink-0 font-mono text-[12px]"
                            style={{ color: rssiColor(network.rssi) }}
                          >
                            {network.rssi} dBm
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="py-4 text-[13px] text-text-dim">
                  Aucun BSSID sur cette bande.
                </p>
              )}
            </CollapsiblePanel>

            <OverlapPanel overlaps={overlaps} colours={colours} />
          </aside>
        </div>
      )}
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: { href: string; label: string; icon: React.ReactNode };
}) {
  return (
    <div className="panel mx-auto flex max-w-xl flex-col items-center px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-glass-border-soft bg-glass-bg">
        {icon}
      </span>
      <h2 className="text-[16px] font-medium text-text">{title}</h2>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-text-dim">
        {description}
      </p>
      {action && (
        <a href={action.href} className="btn-primary mt-5 h-10 px-4">
          {action.icon}
          {action.label}
        </a>
      )}
    </div>
  );
}

function NetworkDetails({
  network,
  colour,
  onClear,
}: {
  network: ChannelNetwork;
  colour: string;
  onClear: () => void;
}) {
  return (
    <section className="panel p-3 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colour }}
          />
          <h2 className="truncate text-sm font-semibold text-text">
            {networkLabel(network)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-text-dim hover:bg-glass-bg hover:text-text"
        >
          Effacer
        </button>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <span
          className="font-mono text-[22px] font-medium"
          style={{ color: rssiColor(network.rssi) }}
        >
          {network.rssi} dBm
        </span>
        <span className="text-[11px] text-text-dim">
          qualité {network.quality}/100
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
        <Field label="BSSID" value={network.bssid} mono className="col-span-2 break-all" />
        {network.bssidName && network.bssidName !== network.bssid && (
          <Field label="Nom borne" value={network.bssidName} className="col-span-2" />
        )}
        <Field label="Canal" value={formatChannel(network)} mono />
        <Field label="Largeur" value={formatWidth(network)} mono />
        <Field label="Fréquence" value={`${network.frequencyMhz} MHz`} mono />
        <Field label="Centre" value={`${network.centerFrequencyMhz} MHz`} mono />
        <Field label="Sécurité" value={network.security} />
        <Field label="Standard" value={network.standard} />
        <Field label="Mesures" value={String(network.sampleCount)} mono />
        <Field label="Points" value={String(network.pointCount)} mono />
        <Field label="Dernier relevé" value={formatLastSeen(network.lastSeen)} className="col-span-2" />
      </dl>

      {network.widthEstimated && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          Largeur de canal non fournie par le scan : le tracé utilise 20 MHz à titre indicatif.
        </p>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
  className = '',
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] uppercase tracking-wide text-text-dim">{label}</dt>
      <dd className={`text-text ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  );
}

function OverlapPanel({
  overlaps,
  colours,
}: {
  overlaps: ChannelOverlap[];
  colours: ReadonlyMap<string, string>;
}) {
  return (
    <CollapsiblePanel
      title="Chevauchements"
      meta={<span className="font-mono text-[11px] text-text-dim">{overlaps.length}</span>}
    >
      {overlaps.length === 0 ? (
        <p className="py-3 text-[13px] text-text-dim">
          Aucun chevauchement entre les canaux occupés.
        </p>
      ) : (
        <ul className="max-h-[280px] space-y-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {overlaps.map((overlap) => (
            <li
              key={`${overlap.a.bssid}-${overlap.b.bssid}`}
              className="rounded-xl border border-warn/20 bg-warn-soft px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5 text-[12px] text-text">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colours.get(overlap.a.bssid) }}
                />
                <span className="min-w-0 truncate">{networkLabel(overlap.a)}</span>
                <span className="shrink-0 text-text-dim">×</span>
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colours.get(overlap.b.bssid) }}
                />
                <span className="min-w-0 truncate">{networkLabel(overlap.b)}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-warn">
                  {Math.round(overlap.overlapMhz)} MHz
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-text-dim">
                canal {overlap.a.channel} / {overlap.b.channel}
                {overlap.estimated ? ' · largeur estimée' : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}

/** Panneau repliable : le titre reste cliquable pour masquer le contenu. */
function CollapsiblePanel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const contentId = useId();

  return (
    <section className="panel p-3 sm:p-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="-mx-1 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left"
      >
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        <span className="flex items-center gap-2">
          {meta}
          <ChevronDown
            aria-hidden
            strokeWidth={1.75}
            className={[
              'h-4 w-4 shrink-0 text-text-dim transition-transform duration-ui ease-ui',
              open ? 'rotate-180' : '',
            ].join(' ')}
          />
        </span>
      </button>
      {open && (
        <div id={contentId} className="mt-2">
          {children}
        </div>
      )}
    </section>
  );
}
