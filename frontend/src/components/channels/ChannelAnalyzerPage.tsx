import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  CircleAlert,
  Info,
  Radio,
  RefreshCw,
  ScanLine,
  Upload,
  Wifi,
} from 'lucide-react';
import {
  aggregateChannelNetworks,
  CHANNEL_PALETTE,
  filterBestNetworks,
  findChannelOverlaps,
  recommendChannel,
  type ChannelAdvice,
  type ChannelBand,
  type ChannelNetwork,
  type ChannelOverlap,
  type ChannelLoadLabel,
} from '../../lib/channelAnalysis';
import { rssiColor } from '../../lib/signal';
import { useChannelAnalysis } from '../../hooks/useChannelAnalysis';
import { ChannelChart } from './ChannelChart';

const BAND_OPTIONS: Array<{ value: ChannelBand; label: string }> = [
  { value: '2.4', label: '2,4 GHz' },
  { value: '5', label: '5 GHz' },
];

const LOAD_COLOUR: Record<ChannelLoadLabel, string> = {
  Libre: 'var(--color-accent)',
  Chargé: 'var(--color-warn)',
  Saturé: 'var(--color-danger)',
};

const NETWORK_PAGE_SIZE = 8;
const OVERLAP_PAGE_SIZE = 6;

type NetworkFilter =
  | { kind: 'all' }
  | { kind: 'hidden' }
  | { kind: 'ssid'; ssid: string };

type OverlapFilter = 'all' | 'co' | 'adjacent';

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

function signalPercent(rssi: number): number {
  return Math.max(4, Math.min(100, Math.round(((rssi + 100) / 60) * 100)));
}

/** Repère visuel : au-delà de deux réseaux sur un canal, il est encombré. */
function channelLoadWord(count: number): string | null {
  if (count >= 4) return 'saturé';
  if (count >= 2) return 'chargé';
  return null;
}

function buildNetworkRows(networks: readonly ChannelNetwork[]) {
  const ordered = [...networks].sort(
    (a, b) =>
      a.channel - b.channel ||
      b.rssi - a.rssi ||
      a.bssid.localeCompare(b.bssid),
  );

  let current: number | null = null;
  return ordered.map((network) => {
    const showGroup = network.channel !== current;
    current = network.channel;
    return { network, showGroup };
  });
}

export function ChannelAnalyzerPage() {
  const { plan, planLoading, planError, samples, loading, error, reload } =
    useChannelAnalysis();
  const [band, setBand] = useState<ChannelBand>('2.4');
  const [bestOnly, setBestOnly] = useState(false);
  const [selectedBssid, setSelectedBssid] = useState<string | null>(null);
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>({
    kind: 'all',
  });
  const [overlapFilter, setOverlapFilter] = useState<OverlapFilter>('all');

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

  // Couleurs calculées sur la bande complète : elles ne changent pas quand un
  // filtre masque puis réaffiche un BSSID.
  const colours = useMemo(() => {
    const map = new Map<string, string>();
    bandNetworks.forEach((network, index) => {
      map.set(network.bssid, CHANNEL_PALETTE[index % CHANNEL_PALETTE.length]);
    });
    return map;
  }, [bandNetworks]);

  // Familles de réseaux (même SSID sur plusieurs BSSID) proposées en filtre.
  const ssidFamilies = useMemo(() => {
    const counts = new Map<string, number>();
    for (const network of bandNetworks) {
      if (!network.ssid) continue;
      counts.set(network.ssid, (counts.get(network.ssid) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
      .slice(0, 3);
  }, [bandNetworks]);

  const hiddenCount = bandNetworks.filter((network) => network.hidden).length;

  const filteredBand = useMemo(() => {
    if (networkFilter.kind === 'hidden') {
      return bandNetworks.filter((network) => network.hidden);
    }
    if (networkFilter.kind === 'ssid') {
      return bandNetworks.filter(
        (network) => network.ssid === networkFilter.ssid,
      );
    }
    return bandNetworks;
  }, [bandNetworks, networkFilter]);

  const networks = useMemo(
    () => (bestOnly ? filterBestNetworks(filteredBand) : filteredBand),
    [filteredBand, bestOnly],
  );

  const overlaps = useMemo(() => findChannelOverlaps(networks), [networks]);
  const bandOverlaps = useMemo(
    () => findChannelOverlaps(bandNetworks),
    [bandNetworks],
  );

  const coChannelCount = overlaps.filter(
    (overlap) => overlap.a.channel === overlap.b.channel,
  ).length;

  const visibleOverlaps = useMemo(() => {
    if (overlapFilter === 'co') {
      return overlaps.filter(
        (overlap) => overlap.a.channel === overlap.b.channel,
      );
    }
    if (overlapFilter === 'adjacent') {
      return overlaps.filter(
        (overlap) => overlap.a.channel !== overlap.b.channel,
      );
    }
    return overlaps;
  }, [overlaps, overlapFilter]);

  const advice = useMemo(() => recommendChannel(networks, band), [networks, band]);
  const selected =
    networks.find((network) => network.bssid === selectedBssid) ?? null;

  const resetView = () => {
    setSelectedBssid(null);
    setNetworkFilter({ kind: 'all' });
    setOverlapFilter('all');
  };

  const changeBand = (next: ChannelBand) => {
    resetView();
    setBand(next);
  };

  const hasAnyNetwork = networks24.length + networks5.length > 0;
  const totalSamples = samples.length;
  const bandLabel = band === '2.4' ? '2,4' : '5';
  const listKey = `${band}-${networkFilter.kind}-${
    networkFilter.kind === 'ssid' ? networkFilter.ssid : ''
  }-${bestOnly ? 'best' : 'all'}`;

  return (
    <div className="page-shell">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="label mb-2">Spectre</p>
          <h1 className="page-title">Analyseur Wi-Fi</h1>
          <p className="mt-1.5 text-sm text-text-dim">
            {plan
              ? `${plan.name} · ${bandNetworks.length} BSSID en ${bandLabel} GHz`
              : 'Analyse des canaux enregistrés'}
            {totalSamples > 0
              ? ` · ${totalSamples} observation${totalSamples > 1 ? 's' : ''}`
              : ''}
          </p>
        </div>

        <div
          role="group"
          aria-label="Bande de fréquence"
          className="flex h-11 w-full shrink-0 overflow-hidden rounded-xl border border-glass-border-soft bg-glass-bg-soft p-1 backdrop-blur-ui sm:w-auto"
        >
          {BAND_OPTIONS.map((option) => {
            const count =
              option.value === '2.4' ? networks24.length : networks5.length;
            const active = band === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => changeBand(option.value)}
                className={[
                  'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-ui sm:flex-none',
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-dim hover:bg-glass-bg hover:text-text',
                ].join(' ')}
              >
                <span>{option.label}</span>
                <span className="font-mono text-[11px] opacity-70">· {count}</span>
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
          <CircleAlert
            className="h-4 w-4 shrink-0 text-danger"
            strokeWidth={1.75}
            aria-hidden
          />
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
          icon={
            <CircleAlert
              className="h-6 w-6 text-danger"
              strokeWidth={1.75}
              aria-hidden
            />
          }
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
          icon={
            <Wifi
              className="h-6 w-6 text-accent"
              strokeWidth={1.75}
              aria-hidden
            />
          }
          title="Aucun plan actif"
          description="Importe un plan, place des points de mesure puis lance un scan pour analyser les canaux."
          action={{
            href: '#/upload',
            label: 'Importer un plan',
            icon: <Upload className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
          }}
        />
      ) : !hasAnyNetwork && totalSamples === 0 ? (
        <EmptyPanel
          icon={
            <ScanLine
              className="h-6 w-6 text-accent"
              strokeWidth={1.75}
              aria-hidden
            />
          }
          title="Aucune observation Wi-Fi"
          description="Effectue au moins un scan sur ce plan. Les canaux, fréquences et largeurs enregistrés par le backend seront utilisés ici."
          action={{
            href: '#/scan',
            label: 'Aller aux mesures',
            icon: <Radio className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
          }}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            <section
              aria-label={`Canaux ${bandLabel} GHz`}
              className="panel min-w-0 p-3 sm:p-4"
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-text">
                  Canaux {band === '2.4' ? '2,4 GHz' : '5 GHz'}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip active={!bestOnly} onClick={() => setBestOnly(false)}>
                    Tous
                  </Chip>
                  <Chip
                    active={bestOnly}
                    onClick={() => setBestOnly(true)}
                    title="Ne garder que le BSSID au meilleur RSSI pour chaque SSID"
                  >
                    Meilleurs AP
                  </Chip>
                  <span className="ml-1 font-mono text-[11px] text-text-dim">
                    {networks.length} BSSID · {overlaps.length} chev.
                  </span>
                </div>
              </div>

              {selected && (
                <p className="mb-2 text-[11px] text-text-dim">
                  {networkLabel(selected)} mis en avant · les autres réseaux sont
                  estompés
                </p>
              )}

              {networks.length === 0 ? (
                <div className="flex min-h-[280px] flex-col items-center justify-center px-4 text-center">
                  <Radio
                    className="mb-3 h-6 w-6 text-text-dim"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-text">
                    Aucun réseau en {bandLabel} GHz
                  </p>
                  <p className="mt-1 max-w-sm text-[13px] text-text-dim">
                    {networkFilter.kind === 'all'
                      ? 'Les observations de ce plan ne contiennent aucun BSSID sur cette bande.'
                      : 'Aucun réseau ne correspond à ce filtre.'}
                    {networkFilter.kind === 'all' && otherNetworks.length > 0
                      ? ` ${otherNetworks.length} BSSID sont disponibles en ${band === '2.4' ? '5' : '2,4'} GHz.`
                      : ''}
                  </p>
                  {networkFilter.kind === 'all' && otherNetworks.length > 0 && (
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
                    <Info
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span>
                      Meilleur RSSI enregistré par BSSID sur le dernier scan de
                      chaque point.
                      {bestOnly
                        ? ' Seul le BSSID au meilleur signal de chaque SSID est affiché ; les réseaux masqués restent individuels.'
                        : ''}{' '}
                      La largeur de courbe suit la largeur de canal mesurée ; sans
                      mesure, une largeur de 20 MHz est tracée en pointillés.
                    </span>
                  </p>
                </>
              )}
            </section>

            <CollapsiblePanel
              title="Réseaux"
              meta={
                <span className="text-[11px] text-text-dim">
                  {networks.length} affiché{networks.length > 1 ? 's' : ''}
                </span>
              }
            >
              {bandNetworks.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Chip
                    active={networkFilter.kind === 'all'}
                    onClick={() => setNetworkFilter({ kind: 'all' })}
                  >
                    Tous · {bandNetworks.length}
                  </Chip>
                  {ssidFamilies.map(([ssid, count]) => (
                    <Chip
                      key={ssid}
                      active={
                        networkFilter.kind === 'ssid' &&
                        networkFilter.ssid === ssid
                      }
                      onClick={() =>
                        setNetworkFilter(
                          networkFilter.kind === 'ssid' &&
                            networkFilter.ssid === ssid
                            ? { kind: 'all' }
                            : { kind: 'ssid', ssid },
                        )
                      }
                      title={`${count} BSSID diffusent ce SSID`}
                    >
                      {ssid}
                    </Chip>
                  ))}
                  {hiddenCount > 0 && (
                    <Chip
                      active={networkFilter.kind === 'hidden'}
                      onClick={() =>
                        setNetworkFilter(
                          networkFilter.kind === 'hidden'
                            ? { kind: 'all' }
                            : { kind: 'hidden' },
                        )
                      }
                    >
                      Masqués · {hiddenCount}
                    </Chip>
                  )}
                </div>
              )}

              <NetworkList
                key={listKey}
                networks={networks}
                colours={colours}
                selectedBssid={selectedBssid}
                onSelect={setSelectedBssid}
              />
            </CollapsiblePanel>

            <CollapsiblePanel
              title="Chevauchements"
              meta={
                <span className="font-mono text-[11px] text-text-dim">
                  {overlaps.length}
                </span>
              }
            >
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Chip
                  active={overlapFilter === 'all'}
                  onClick={() => setOverlapFilter('all')}
                >
                  Tous · {overlaps.length}
                </Chip>
                <Chip
                  active={overlapFilter === 'co'}
                  onClick={() => setOverlapFilter('co')}
                >
                  Co-canal · {coChannelCount}
                </Chip>
                <Chip
                  active={overlapFilter === 'adjacent'}
                  onClick={() => setOverlapFilter('adjacent')}
                >
                  Adjacent · {overlaps.length - coChannelCount}
                </Chip>
              </div>

              <OverlapList
                key={`${listKey}-${overlapFilter}`}
                overlaps={visibleOverlaps}
                colours={colours}
              />
            </CollapsiblePanel>
          </div>

          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20">
            {selected ? (
              <NetworkDetails
                network={selected}
                colour={colours.get(selected.bssid) ?? '#10b981'}
                peers={channelPeers(selected, bandOverlaps)}
                colours={colours}
                onClear={() => setSelectedBssid(null)}
              />
            ) : (
              advice && <AdviceCard advice={advice} band={band} />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={[
        'inline-flex min-h-9 items-center rounded-full border px-3 text-[12px] font-medium transition-colors duration-ui',
        active
          ? 'border-accent-border bg-accent-soft text-accent'
          : 'border-line bg-surface text-text-dim hover:border-glass-border hover:text-text',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function NetworkList({
  networks,
  colours,
  selectedBssid,
  onSelect,
}: {
  networks: readonly ChannelNetwork[];
  colours: ReadonlyMap<string, string>;
  selectedBssid: string | null;
  onSelect: (bssid: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => buildNetworkRows(networks), [networks]);

  if (networks.length === 0) {
    return (
      <p className="py-4 text-[13px] text-text-dim">
        Aucun BSSID ne correspond à ce filtre.
      </p>
    );
  }

  const visible = showAll ? rows : rows.slice(0, NETWORK_PAGE_SIZE);
  const remaining = rows.length - visible.length;

  return (
    <>
      <ul className="max-h-[520px] space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map(({ network, showGroup }) => {
          const active = network.bssid === selectedBssid;
          const colour = colours.get(network.bssid) ?? '#10b981';
          const onChannel = networks.filter(
            (item) => item.channel === network.channel,
          ).length;
          const word = channelLoadWord(onChannel);

          return (
            <li key={network.bssid}>
              {showGroup && (
                <p className="mb-1.5 mt-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-text-dim first:mt-0">
                  <span>
                    Canal {network.channel}
                    {word ? ` · ${word}` : ''}
                  </span>
                  <span>
                    {onChannel} affiché{onChannel > 1 ? 's' : ''}
                  </span>
                </p>
              )}
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active ? null : network.bssid)}
                className={[
                  'grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-ui sm:grid-cols-[10px_minmax(0,1fr)_72px_auto]',
                  active
                    ? 'border-accent-border bg-accent-soft'
                    : 'border-transparent bg-surface hover:border-glass-border-soft',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-text">
                    {networkLabel(network)}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-text-dim">
                    {network.bssid} · {formatWidth(network)}
                  </span>
                </span>
                <span className="hidden h-1.5 overflow-hidden rounded-full bg-white/10 sm:block">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${signalPercent(network.rssi)}%`,
                      backgroundColor: rssiColor(network.rssi),
                    }}
                  />
                </span>
                <span
                  className="shrink-0 text-right font-mono text-[12px]"
                  style={{ color: rssiColor(network.rssi) }}
                >
                  {network.rssi} dBm
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 min-h-10 w-full rounded-xl border border-dashed border-line text-[12px] font-medium text-text-dim transition-colors duration-ui hover:border-glass-border hover:text-text"
        >
          Afficher les autres réseaux ({remaining})
        </button>
      )}
      {showAll && rows.length > NETWORK_PAGE_SIZE && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-2 min-h-10 w-full rounded-xl border border-dashed border-line text-[12px] font-medium text-text-dim transition-colors duration-ui hover:border-glass-border hover:text-text"
        >
          Réduire la liste
        </button>
      )}
    </>
  );
}

function OverlapList({
  overlaps,
  colours,
}: {
  overlaps: readonly ChannelOverlap[];
  colours: ReadonlyMap<string, string>;
}) {
  const [showAll, setShowAll] = useState(false);

  if (overlaps.length === 0) {
    return (
      <p className="py-3 text-[13px] text-text-dim">
        Aucun chevauchement pour ce filtre.
      </p>
    );
  }

  const visible = showAll ? overlaps : overlaps.slice(0, OVERLAP_PAGE_SIZE);
  const remaining = overlaps.length - visible.length;

  return (
    <>
      <ul className="max-h-[420px] space-y-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map((overlap) => {
          const coChannel = overlap.a.channel === overlap.b.channel;
          return (
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
                canal {overlap.a.channel} / {overlap.b.channel} ·{' '}
                {coChannel ? 'co-canal' : 'adjacent'}
                {overlap.estimated ? ' · largeur estimée' : ''}
              </p>
            </li>
          );
        })}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 min-h-10 w-full rounded-xl border border-dashed border-line text-[12px] font-medium text-text-dim transition-colors duration-ui hover:border-glass-border hover:text-text"
        >
          Voir les chevauchements restants ({remaining})
        </button>
      )}
      {showAll && overlaps.length > OVERLAP_PAGE_SIZE && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-2 min-h-10 w-full rounded-xl border border-dashed border-line text-[12px] font-medium text-text-dim transition-colors duration-ui hover:border-glass-border hover:text-text"
        >
          Réduire la liste
        </button>
      )}
    </>
  );
}

function AdviceCard({
  advice,
  band,
}: {
  advice: ChannelAdvice;
  band: ChannelBand;
}) {
  const best = advice.rows.find((row) => row.channel === advice.channel);
  const busiest = [...advice.rows].sort((a, b) => b.load - a.load)[0];
  const bandLabel = band === '2.4' ? '2,4' : '5';

  return (
    <section className="panel p-3 sm:p-4" aria-label="Canal conseillé">
      <p className="label">Canal conseillé</p>
      <p className="mt-1 font-mono text-[44px] font-medium leading-none text-accent">
        {advice.channel}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-text">
        {best && best.networks === 0
          ? `Aucun réseau ne recouvre ce canal en ${bandLabel} GHz.`
          : `Le moins occupé en ${bandLabel} GHz : ${
              best?.networks ?? 0
            } réseau${(best?.networks ?? 0) > 1 ? 'x' : ''} à proximité.`}
        {busiest && busiest.channel !== advice.channel && busiest.networks > 0
          ? ` Canal ${busiest.channel} : ${busiest.label.toLowerCase()}.`
          : ''}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {advice.rows.map((row) => (
          <div
            key={row.channel}
            className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-2.5 text-[12px]"
          >
            <span className="font-mono text-text-dim">Canal {row.channel}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(4, Math.round(row.load * 100))}%`,
                  backgroundColor: LOAD_COLOUR[row.label],
                }}
              />
            </span>
            <span className="text-right text-text-dim">{row.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-text-dim">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        Estimation par recouvrement spectral (±10 MHz) pondérée par le RSSI
        observé.
      </p>
    </section>
  );
}

function channelPeers(
  network: ChannelNetwork,
  overlaps: readonly ChannelOverlap[],
): ChannelNetwork[] {
  const peers: ChannelNetwork[] = [];
  for (const overlap of overlaps) {
    if (overlap.a.bssid === network.bssid) peers.push(overlap.b);
    else if (overlap.b.bssid === network.bssid) peers.push(overlap.a);
  }
  return peers.sort((a, b) => b.rssi - a.rssi);
}

function NetworkDetails({
  network,
  colour,
  peers,
  colours,
  onClear,
}: {
  network: ChannelNetwork;
  colour: string;
  peers: readonly ChannelNetwork[];
  colours: ReadonlyMap<string, string>;
  onClear: () => void;
}) {
  return (
    <section
      className="panel p-3 sm:p-4"
      aria-label={`Détails de ${networkLabel(network)}`}
    >
      <div className="flex items-start justify-between gap-2">
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
          className="shrink-0 rounded-full border border-line px-3 py-1 text-[11px] font-medium text-text-dim transition-colors duration-ui hover:border-glass-border hover:text-text"
        >
          Effacer
        </button>
      </div>

      <p
        className="mt-2 font-mono text-[36px] font-medium leading-none"
        style={{ color: rssiColor(network.rssi) }}
      >
        {network.rssi} dBm
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${network.quality}%`, backgroundColor: colour }}
        />
      </div>
      <p className="mt-1 text-[11px] text-text-dim">
        Qualité {network.quality}/100
      </p>

      <SectionTitle>Identité</SectionTitle>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
        <Field label="BSSID" value={network.bssid} mono className="col-span-2 break-all" />
        {network.bssidName && network.bssidName !== network.bssid && (
          <Field label="Nom borne" value={network.bssidName} className="col-span-2" />
        )}
        <Field label="Sécurité" value={network.security} />
        <Field label="Standard" value={network.standard} />
      </dl>

      <SectionTitle>Radio</SectionTitle>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
        <Field label="Canal" value={formatChannel(network)} mono />
        <Field label="Largeur" value={formatWidth(network)} mono />
        <Field label="Fréquence" value={`${network.frequencyMhz} MHz`} mono />
        <Field label="Centre" value={`${network.centerFrequencyMhz} MHz`} mono />
      </dl>

      <SectionTitle>Relevés</SectionTitle>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
        <Field label="Mesures" value={String(network.sampleCount)} mono />
        <Field label="Points" value={String(network.pointCount)} mono />
        <Field
          label="Dernier relevé"
          value={formatLastSeen(network.lastSeen)}
          className="col-span-2"
        />
      </dl>

      {network.widthEstimated && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
          <Info
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            strokeWidth={1.75}
            aria-hidden
          />
          Largeur de canal non fournie par le scan : le tracé utilise 20 MHz à
          titre indicatif.
        </p>
      )}

      <SectionTitle>Partage le canal {network.channel} avec</SectionTitle>
      {peers.length === 0 ? (
        <p className="text-[12px] text-text-dim">
          Aucun autre réseau ne recouvre ce canal.
        </p>
      ) : (
        <ul className="space-y-1">
          {peers.map((peer) => (
            <li
              key={peer.bssid}
              className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2 text-[12px]"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: colours.get(peer.bssid) }}
              />
              <span className="min-w-0 truncate">{networkLabel(peer)}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-warn">
                {peer.rssi} dBm
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 border-t border-line pt-3 text-[10px] uppercase tracking-wide text-text-dim">
      {children}
    </p>
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
      <dt className="text-[10px] uppercase tracking-wide text-text-dim">
        {label}
      </dt>
      <dd className={`text-text ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: { href: string; label: string; icon: ReactNode };
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

/** Panneau repliable : le titre reste cliquable pour masquer le contenu. */
function CollapsiblePanel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
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
