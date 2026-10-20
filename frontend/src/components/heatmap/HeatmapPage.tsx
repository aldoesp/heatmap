import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { LocateFixed, Plus, Minus } from 'lucide-react';
import L from 'leaflet';
import { usePlanImage } from '../../hooks/usePlanImage';
import { getHeatmap, getHeatmapSpeed, getHeatmapGateway, getNetworks } from '../../lib/api';
import {
  getHeatmapRadius,
  setHeatmapRadius,
  calculateAutoRadius,
} from '../../lib/heatmap';
import { CoverageOverlay, type CoverageBand, type CoveragePoint } from './CoverageOverlay';
import { ApiError, type GatewayHeatmapRow, type HeatmapRow, type NetworkInfo, type SpeedHeatmapRow } from '../../types/api';
import { formatPercent, formatMbps } from '../../lib/format';
import { average } from '../../lib/signal';

function rssiColor(rssi: number): string {
  if (rssi >= -55) return '#10b981';
  if (rssi >= -67) return '#a3e635';
  if (rssi >= -75) return '#f59e0b';
  if (rssi >= -85) return '#f97316';
  return '#ef4444';
}

function speedColor(mbps: number): string {
  if (mbps >= 50) return '#10b981';
  if (mbps >= 20) return '#a3e635';
  if (mbps >= 5) return '#f59e0b';
  if (mbps >= 1) return '#f97316';
  return '#ef4444';
}

// Latence (ms) : < 30 vert, < 60 jaune, < 120 orange, >= 120 rouge.
function latencyColor(ms: number): string {
  if (ms < 30) return '#10b981';
  if (ms < 60) return '#a3e635';
  if (ms < 120) return '#f59e0b';
  if (ms < 250) return '#f97316';
  return '#ef4444';
}

// Perte (%) : 0 vert, < 5 jaune, < 20 orange, >= 20 rouge.
function lossColor(pct: number): string {
  if (pct === 0) return '#10b981';
  if (pct < 5) return '#a3e635';
  if (pct < 20) return '#f59e0b';
  if (pct < 50) return '#f97316';
  return '#ef4444';
}

// Jitter (ms) : < 5 vert, < 15 jaune, < 40 orange, >= 40 rouge.
function jitterColor(ms: number): string {
  if (ms < 5) return '#10b981';
  if (ms < 15) return '#a3e635';
  if (ms < 40) return '#f59e0b';
  if (ms < 80) return '#f97316';
  return '#ef4444';
}

function MapSetup({
  width,
  height,
  registerRecenter,
}: {
  width: number;
  height: number;
  registerRecenter: (fn: () => void) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds([0, 0], [height, width]);
    const center = L.latLng(height / 2, width / 2);

    // État initial : plan entier visible, centré, sans fitBounds.
    const applyInitialView = () => {
      map.invalidateSize();
      const fitZoom = map.getBoundsZoom(bounds);
      map.setMinZoom(fitZoom - 1);
      map.setView(center, fitZoom, { animate: false });
    };

    applyInitialView();

    // Recentrer = revenir à l'état initial (zoom "plan entier").
    const recenter = () => {
      const fitZoom = map.getBoundsZoom(bounds);
      map.setMinZoom(fitZoom - 1);
      map.setView(center, fitZoom, { animate: true });
    };
    registerRecenter(recenter);

    // Au resize : on garde le zoom utilisateur, on recalcule juste minZoom
    // et on rafraîchit la taille du conteneur.
    let timer: number | null = null;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        map.invalidateSize();
        map.setMinZoom(map.getBoundsZoom(bounds) - 1);
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, [map, width, height, registerRecenter]);

  return null;
}

function ZoomControl() {
  const map = useMap();
  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'none' }}>
      <div
        className="leaflet-control"
        style={{ pointerEvents: 'auto', marginTop: 56 }}
      >
        <div className="flex flex-col rounded-xl overflow-hidden border border-white/10 bg-[#0d1319]/90 backdrop-blur">
          <button
            type="button"
            aria-label="Zoomer"
            onClick={() => map.zoomIn(0.5)}
            className="h-11 w-11 inline-flex items-center justify-center text-text hover:bg-white/10 transition-colors"
          >
            <Plus size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="h-px bg-white/10" />
          <button
            type="button"
            aria-label="Dézoomer"
            onClick={() => map.zoomOut(0.5)}
            className="h-11 w-11 inline-flex items-center justify-center text-text hover:bg-white/10 transition-colors"
          >
            <Minus size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

/* Bandes du champ de couverture : mêmes seuils/réseaux que rssiColor et
   le backend (rssiToLevel) — aucune valeur inventée ici. */
const RSSI_BANDS: CoverageBand[] = [
  { min: -55, color: '#10b981' },
  { min: -67, color: '#a3e635' },
  { min: -75, color: '#f59e0b' },
  { min: -85, color: '#f97316' },
  { min: Number.NEGATIVE_INFINITY, color: '#ef4444' },
];

const SPEED_BANDS: CoverageBand[] = [
  { min: 50, color: '#10b981' },
  { min: 20, color: '#a3e635' },
  { min: 5, color: '#f59e0b' },
  { min: 1, color: '#f97316' },
  { min: Number.NEGATIVE_INFINITY, color: '#ef4444' },
];

const RSSI_LABELS: Record<string, string> = {
  '-55': '≥ −55 dBm · excellent',
  '-67': '≥ −67 dBm · bon',
  '-75': '≥ −75 dBm · moyen',
  '-85': '≥ −85 dBm · faible',
  '-inf': '< −85 dBm · très faible',
};

const SPEED_LABELS: Record<string, string> = {
  '50': '≥ 50 Mb/s',
  '20': '≥ 20 Mb/s',
  '5': '≥ 5 Mb/s',
  '1': '≥ 1 Mb/s',
  '-inf': '< 1 Mb/s',
};

// Latence : < 30 ms excellent, < 60 bon, < 120 moyen, < 250 faible, ≥ 250 très faible.
const LATENCY_BANDS: CoverageBand[] = [
  { min: 30, color: '#10b981' },
  { min: 60, color: '#a3e635' },
  { min: 120, color: '#f59e0b' },
  { min: 250, color: '#f97316' },
  { min: Number.NEGATIVE_INFINITY, color: '#ef4444' },
];
const LATENCY_LABELS: Record<string, string> = {
  '30': '< 30 ms · excellent',
  '60': '< 60 ms · bon',
  '120': '< 120 ms · moyen',
  '250': '< 250 ms · faible',
  '-inf': '≥ 250 ms · très faible',
};

// Perte : 0 % excellent, < 5 bon, < 20 moyen, < 50 faible, ≥ 50 très faible.
const LOSS_BANDS: CoverageBand[] = [
  { min: 5, color: '#10b981' },
  { min: 20, color: '#a3e635' },
  { min: 50, color: '#f59e0b' },
  { min: Number.NEGATIVE_INFINITY, color: '#ef4444' },
];
const LOSS_LABELS: Record<string, string> = {
  '5': '< 5 % · excellent',
  '20': '< 20 % · bon',
  '50': '< 50 % · moyen',
  '-inf': '≥ 50 % · très faible',
};

// Jitter : < 5 ms excellent, < 15 bon, < 40 moyen, < 80 faible, ≥ 80 très faible.
const JITTER_BANDS: CoverageBand[] = [
  { min: 15, color: '#10b981' },
  { min: 40, color: '#a3e635' },
  { min: 80, color: '#f59e0b' },
  { min: Number.NEGATIVE_INFINITY, color: '#ef4444' },
];
const JITTER_LABELS: Record<string, string> = {
  '15': '< 15 ms · excellent',
  '40': '< 40 ms · bon',
  '80': '< 80 ms · moyen',
  '-inf': '≥ 80 ms · très faible',
};

const bandKey = (min: number) =>
  min === Number.NEGATIVE_INFINITY ? '-inf' : String(min);

type BandChoice = '' | '2.4' | '5' | '6';
const BAND_TABS: Array<{ value: BandChoice; label: string }> = [
  { value: '', label: 'Toutes' },
  { value: '2.4', label: '2.4 GHz' },
  { value: '5', label: '5 GHz' },
  { value: '6', label: '6 GHz' },
];

export function HeatmapPage() {
  const { plan, imageUrl, loading: planLoading, imageMissing, error: planError } = usePlanImage();
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [ssid, setSsid] = useState('');
  const [bssid, setBssid] = useState('');
  // Bande affichée ('' = toutes), façon sélecteur 2.4/5/6 GHz d'UniFi.
  const [band, setBand] = useState<BandChoice>('');
  // Par défaut : seuls les cercles du réseau connecté (marqué au scan).
  const [onlyConnected, setOnlyConnected] = useState(true);
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [speedRows, setSpeedRows] = useState<SpeedHeatmapRow[]>([]);
  const [gatewayRows, setGatewayRows] = useState<GatewayHeatmapRow[]>([]);
  const [metric, setMetric] = useState<'rssi' | 'latency' | 'loss' | 'jitter' | 'speed'>('rssi');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRadius, setSelectedRadius] = useState<number | null>(
    () => getHeatmapRadius()
  );
  const recenterRef = useRef<(() => void) | null>(null);

  const registerRecenter = useCallback((fn: () => void) => {
    recenterRef.current = fn;
  }, []);

  const handleRecenter = useCallback(() => {
    recenterRef.current?.();
  }, []);

  // Liste des réseaux pour les filtres
  useEffect(() => {
    if (!plan) return;
    let alive = true;
    getNetworks(plan.id)
      .then((n) => {
        if (alive) setNetworks(n);
      })
      .catch(() => {
        /* filtres indisponibles : la heatmap reste affichable sans filtre */
      });
    return () => {
      alive = false;
    };
  }, [plan]);

  const load = useCallback(async () => {
    if (!plan) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [data, speeds, gateway] = await Promise.all([
        getHeatmap(plan.id, {
          ssid: ssid || undefined,
          bssid: bssid || undefined,
          connected: onlyConnected || undefined,
          band: band || undefined,
        }),
        getHeatmapSpeed(plan.id).catch(() => [] as SpeedHeatmapRow[]),
        getHeatmapGateway(plan.id).catch(() => [] as GatewayHeatmapRow[]),
      ]);
      setRows(data);
      setSpeedRows(speeds);
      setGatewayRows(gateway);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de charger la heatmap.');
    } finally {
      setLoading(false);
    }
  }, [plan, ssid, bssid, onlyConnected, band]);

  useEffect(() => {
    if (planLoading) return;
    (async () => {
      await load();
    })();
  }, [planLoading, load]);

  const ssids = useMemo(
    () => [...new Set(networks.map((n) => n.ssid).filter((s): s is string => !!s))],
    [networks]
  );
  const bssids = useMemo(() => [...new Set(networks.map((n) => n.bssid))], [networks]);

  const bounds = useMemo<L.LatLngBoundsExpression | null>(
    () => (plan ? [[0, 0], [plan.height, plan.width]] : null),
    [plan]
  );

  // Rayon auto d'après l'emprise des points (comme l'upstream), ajustable.
  const autoRadius = useMemo(() => {
    if (!plan) return 30;
    const seen = new Map<string, { x: number; y: number }>();
    for (const r of rows) {
      if (!seen.has(r.scan_point_id)) seen.set(r.scan_point_id, { x: r.x, y: r.y });
    }
    return calculateAutoRadius([...seen.values()], plan.width, plan.height);
  }, [rows, plan]);
  const radius = selectedRadius ?? autoRadius;

  const isRssi = metric === 'rssi';
  const isLatency = metric === 'latency';
  const isLoss = metric === 'loss';
  const isJitter = metric === 'jitter';
  const isGatewayMetric = isLatency || isLoss || isJitter;
  const showingSpeed = metric === 'speed';
  const wifiOnly = isRssi;

  // Une valeur par point de mesure : le meilleur RSSI (l'API renvoie une
  // ligne par BSSID, superposer toutes les pastilles n'apporte rien).
  const bestPerPoint = useMemo<HeatmapRow[]>(() => {
    const best = new Map<string, HeatmapRow>();
    for (const row of rows) {
      const prev = best.get(row.scan_point_id);
      if (!prev || row.rssi > prev.rssi) best.set(row.scan_point_id, row);
    }
    return [...best.values()];
  }, [rows]);

  const coveragePoints = useMemo<CoveragePoint[]>(() => {
    if (showingSpeed) {
      return speedRows.map((r) => ({ x: r.x, y: r.y, value: r.speed_bps / 1_000_000 }));
    }
    if (isLatency) {
      return gatewayRows
        .filter((r) => r.gateway_rtt_ms !== null)
        .map((r) => ({ x: r.x, y: r.y, value: r.gateway_rtt_ms as number }));
    }
    if (isLoss) {
      return gatewayRows
        .filter((r) => r.gateway_loss_percent !== null)
        .map((r) => ({ x: r.x, y: r.y, value: r.gateway_loss_percent as number }));
    }
    if (isJitter) {
      return gatewayRows
        .filter((r) => r.gateway_jitter_ms !== null)
        .map((r) => ({ x: r.x, y: r.y, value: r.gateway_jitter_ms as number }));
    }
    return bestPerPoint.map((r) => ({ x: r.x, y: r.y, value: r.rssi }));
  }, [showingSpeed, speedRows, bestPerPoint, isLatency, isLoss, isJitter, gatewayRows]);

  const stats = useMemo(() => {
    const values = showingSpeed
      ? speedRows.map((r) => r.speed_bps / 1_000_000)
      : isLatency
        ? gatewayRows
            .map((r) => r.gateway_rtt_ms)
            .filter((v): v is number => v !== null)
        : isLoss
          ? gatewayRows
              .map((r) => r.gateway_loss_percent)
              .filter((v): v is number => v !== null)
          : isJitter
            ? gatewayRows
                .map((r) => r.gateway_jitter_ms)
                .filter((v): v is number => v !== null)
            : bestPerPoint.map((r) => r.rssi);
    const avg = average(values);
    // Seuil « à améliorer » : RSSI < -75 dBm, débit < 5 Mb/s,
    // latence ≥ 120 ms, perte ≥ 20 %, jitter ≥ 80 ms.
    const weakThreshold = showingSpeed ? 5 : isRssi ? -75 : isLatency ? 120 : isLoss ? 20 : 80;
    const weakCount = values.filter((v) =>
      isRssi ? v < weakThreshold : showingSpeed ? v < weakThreshold : v >= weakThreshold
    ).length;
    return {
      count: values.length,
      avg,
      best: values.length ? Math.max(...values) : null,
      worst: values.length ? Math.min(...values) : null,
      weakCount,
    };
  }, [showingSpeed, speedRows, bestPerPoint, isLatency, isLoss, isJitter, isRssi, gatewayRows]);

  if (planLoading || loading) {
    return <div className="fixed inset-0 bg-bg" />;
  }

  if ((planError && !plan) || (!plan && !planLoading)) {
    return (
      <div className="max-w-150 mx-auto px-4 pt-16 pb-28 md:pb-16 text-center">
        <p className="text-text text-[15px] mb-4">
          {planError ?? 'Aucun plan pour le moment.'}
        </p>
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

  if (!plan || !imageUrl || !bounds) {
    return (
      <div className="max-w-150 mx-auto px-4 pt-16 pb-28 md:pb-16 text-center">
        <p className="text-text text-[15px] mb-2">
          {imageMissing
            ? `L’image du plan « ${plan?.name} » est introuvable sur le serveur.`
            : 'Aucun plan pour le moment.'}
        </p>
        <p className="text-text-dim text-sm">
          Les relevés restent conservés.
        </p>
      </div>
    );
  }

  const hasFilter = !!ssid || !!bssid || !!band;
  const onlyDefaultFilter = onlyConnected && !ssid && !bssid && !band;
  const visibleCount = showingSpeed
    ? speedRows.length
    : isGatewayMetric
      ? coveragePoints.length
      : rows.length;
  const activeBands = showingSpeed
    ? SPEED_BANDS
    : isLatency
      ? LATENCY_BANDS
      : isLoss
        ? LOSS_BANDS
        : isJitter
          ? JITTER_BANDS
          : RSSI_BANDS;
  const activeLabels = showingSpeed
    ? SPEED_LABELS
    : isLatency
      ? LATENCY_LABELS
      : isLoss
        ? LOSS_LABELS
        : isJitter
          ? JITTER_LABELS
          : RSSI_LABELS;
  const isEmpty = showingSpeed
    ? speedRows.length === 0
    : isGatewayMetric
      ? coveragePoints.length === 0
      : rows.length === 0;

  const emptyMessage = showingSpeed
    ? 'Aucune mesure de débit : configure un serveur iperf3 dans Paramètres, puis effectue des scans.'
    : isGatewayMetric
      ? 'Aucune mesure de passerelle : effectue des scans en mode réel (le ping de la passerelle est désactivé en mode test).'
      : onlyDefaultFilter
        ? 'Aucune mesure du réseau connecté : décoche « Connecté » pour tout voir, ou refais des scans en mode réel (le marquage demande Termux:API).'
        : hasFilter
          ? 'Aucune mesure pour ce filtre : la carte serait vide.'
          : 'Aucun relevé à afficher : effectue d’abord des scans.';

  // stats.values sont en Mb/s (débit), ms (latence/jitter), % (perte) ou dBm (RSSI).
  const formatValue = (v: number) => {
    if (showingSpeed) return formatMbps(v * 1_000_000);
    if (isLatency || isJitter) return `${Math.round(v)} ms`;
    if (isLoss) return `${Math.round(v)} %`;
    return `${Math.round(v)} dBm`;
  };

  const metricLabel = showingSpeed
    ? 'Débit'
    : isLatency
      ? 'Latence'
      : isLoss
        ? 'Perte'
        : isJitter
          ? 'Jitter'
          : 'Signal';

  return (
    <div className="max-w-300 mx-auto px-4 pt-6 pb-28 md:pb-8 lg:px-6 lg:py-8">
      <div className="mb-4">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">Heatmap</h1>
        <p className="text-text-dim text-sm">
          {plan.name} · {visibleCount} mesure{visibleCount > 1 ? 's' : ''} · {metricLabel}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div
          role="group"
          aria-label="Métrique affichée"
          className="flex h-11 rounded-xl border border-glass-border-soft overflow-hidden"
        >
          {([
            { value: 'rssi' as const, label: 'Signal' },
            { value: 'latency' as const, label: 'Latence' },
            { value: 'loss' as const, label: 'Perte' },
            { value: 'jitter' as const, label: 'Jitter' },
            { value: 'speed' as const, label: 'Débit' },
          ].map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={metric === m.value}
              onClick={() => setMetric(m.value)}
              className={[
                'px-3 text-sm font-medium transition-colors whitespace-nowrap',
                metric === m.value ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text',
              ].join(' ')}
            >
              {m.label}
            </button>
          )))}
        </div>
        {wifiOnly && (
          <>
            <div
              role="group"
              aria-label="Bande de fréquence"
              className="flex h-11 rounded-xl border border-glass-border-soft overflow-hidden"
            >
              {BAND_TABS.map((b) => (
                <button
                  key={b.value || 'all'}
                  type="button"
                  aria-pressed={band === b.value}
                  onClick={() => setBand(b.value)}
                  className={[
                    'px-3 text-sm font-medium transition-colors whitespace-nowrap',
                    band === b.value ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text',
                  ].join(' ')}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                aria-label="Réseau connecté uniquement"
                checked={onlyConnected}
                onChange={(e) => setOnlyConnected(e.target.checked)}
                className="w-4 h-4 accent-[#10b981]"
              />
              <span className={onlyConnected ? 'text-text font-medium' : 'text-text-dim'}>
                Connecté
              </span>
            </label>
            <select
              aria-label="Filtrer par SSID"
              value={ssid}
              onChange={(e) => {
                setSsid(e.target.value);
              }}
              className="h-11 px-3 bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-xl text-sm text-text outline-none"
            >
              <option value="">Tous les SSID</option>
              {ssids.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrer par BSSID"
              value={bssid}
              onChange={(e) => {
                setBssid(e.target.value);
              }}
              className="h-11 px-3 bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-xl text-sm text-text outline-none"
            >
              <option value="">Tous les BSSID</option>
              {bssids.map((b) => (
                <option key={b} value={b}>
                  {networks.find((network) => network.bssid === b)?.bssid_name ?? b}
                </option>
              ))}
            </select>
          </>
        )}
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setSsid('');
              setBssid('');
              setBand('');
              setOnlyConnected(true);
            }}
            className="h-11 px-4 rounded-xl text-sm font-medium text-text-dim border border-glass-border hover:text-text"
          >
            Réinitialiser
          </button>
        )}
        <label className="flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm text-text-dim">
          <span className="whitespace-nowrap">Lissage {radius} px</span>
          <input
            type="range"
            aria-label="Rayon de lissage du champ de couverture en pixels"
            min={10}
            max={120}
            step={1}
            value={radius}
            onChange={(e) => {
              const nextRadius = Number(e.target.value);
              setSelectedRadius(nextRadius);
              setHeatmapRadius(nextRadius);
            }}
            className="w-28 accent-[#10b981]"
          />
        </label>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-sm text-text">
          {error}{' '}
          <button type="button" onClick={load} className="underline font-medium">
            Réessayer
          </button>
        </div>
      )}

      {isEmpty && !error ? (
        <div className="text-center py-16">
          <p className="text-text text-[15px] mb-2">
            {emptyMessage}
          </p>
          <button
            type="button"
            onClick={() => {
              location.hash = '#/scan';
            }}
            className="inline-flex items-center h-12 px-5 rounded-[14px] bg-accent text-bg font-medium text-[15px]"
          >
            Aller au scan
          </button>
        </div>
      ) : (
        <>
          <div className="relative rounded-2xl overflow-hidden border border-glass-border-soft">
            <button
              type="button"
              aria-label="Recentrer la carte sur le plan"
              title="Recentrer la carte sur le plan"
              onClick={handleRecenter}
              className="absolute top-3 right-3 z-10 inline-flex items-center justify-center h-11 w-11 rounded-xl text-text bg-[#0d1319]/90 border border-white/10 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <LocateFixed size={18} strokeWidth={1.75} aria-hidden />
            </button>
            <MapContainer
              center={[plan.height / 2, plan.width / 2]}
              zoom={0}
              crs={L.CRS.Simple}
              attributionControl={false}
              zoomControl={false}
              zoomSnap={0.25}
              zoomDelta={0.5}
              scrollWheelZoom
              touchZoom
              className="w-full h-[60vh] z-0"
            >
              <MapSetup
                width={plan.width}
                height={plan.height}
                registerRecenter={registerRecenter}
              />
              <ZoomControl />
              <ImageOverlay url={imageUrl} bounds={bounds} />
              {/* Champ interpolé sous les points de mesure. */}
              <CoverageOverlay
                points={coveragePoints}
                width={plan.width}
                height={plan.height}
                radius={radius}
                bounds={bounds}
                bands={activeBands}
              />
              {!showingSpeed && !isGatewayMetric && bestPerPoint.map((r) => (
                <CircleMarker
                  key={r.scan_point_id}
                  center={[r.y * plan.height, r.x * plan.width]}
                  radius={6}
                  pathOptions={{
                    color: '#0d1319',
                    fillColor: rssiColor(r.rssi),
                    fillOpacity: 0.95,
                    weight: 1.5,
                  }}
                >
                  <Tooltip>
                    {r.ssid ?? '(réseau masqué)'} · {r.bssid_name}
                    <br />
                    {r.rssi} dBm · x {formatPercent(r.x)} · y {formatPercent(r.y)}
                  </Tooltip>
                </CircleMarker>
              ))}
              {showingSpeed && speedRows.map((r) => {
                const mbps = r.speed_bps / 1_000_000;
                return (
                  <CircleMarker
                    key={r.scan_point_id}
                    center={[r.y * plan.height, r.x * plan.width]}
                    radius={6}
                    pathOptions={{
                      color: '#0d1319',
                      fillColor: speedColor(mbps),
                      fillOpacity: 0.95,
                      weight: 1.5,
                    }}
                  >
                    <Tooltip>
                      {formatMbps(r.speed_bps)} · x {formatPercent(r.x)} · y {formatPercent(r.y)}
                    </Tooltip>
                  </CircleMarker>
                );
              })}
              {isGatewayMetric && gatewayRows.map((r) => {
                const value = isLatency
                  ? r.gateway_rtt_ms
                  : isLoss
                    ? r.gateway_loss_percent
                    : r.gateway_jitter_ms;
                if (value == null) return null;
                const colorFn = isLatency ? latencyColor : isLoss ? lossColor : jitterColor;
                return (
                  <CircleMarker
                    key={r.scan_point_id}
                    center={[r.y * plan.height, r.x * plan.width]}
                    radius={6}
                    pathOptions={{
                      color: '#0d1319',
                      fillColor: colorFn(value),
                      fillOpacity: 0.95,
                      weight: 1.5,
                    }}
                  >
                    <Tooltip>
                      {r.gateway_ip ?? '(pas de passerelle)'} · {formatValue(value)}
                      <br />
                      x {formatPercent(r.x)} · y {formatPercent(r.y)}
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>

          {/* Légende : barre segmentée par seuil + meilleur relevé, comme
              le bandeau « Primary Coverage » d'UniFi. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex h-3 rounded-full overflow-hidden border border-white/10 min-w-64 flex-1 max-w-120">
              {activeBands
                .slice()
                .reverse()
                .map((bandDef) => (
                  <div
                    key={bandKey(bandDef.min)}
                    className="flex-1"
                    style={{ backgroundColor: bandDef.color }}
                    aria-hidden
                  />
                ))}
            </div>
            <span className="text-[12px] text-text-dim font-mono">
              {metricLabel} · meilleur relevé{' '}
              <span className="text-text font-medium">
                {stats.best !== null ? formatValue(stats.best) : '—'}
              </span>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {activeBands.map((bandDef) => (
              <span
                key={bandKey(bandDef.min)}
                className="inline-flex items-center gap-1.5 text-[12px] text-text-dim font-mono"
              >
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: bandDef.color }}
                />
                {activeLabels[bandKey(bandDef.min)]}
              </span>
            ))}
          </div>

          {/* Panneau de synthèse : l'état du parc en un coup d'œil. */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-xl border border-glass-border-soft bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
              <div className="text-[12px] text-text-dim">Points mesurés</div>
              <div className="text-text text-[15px] font-medium font-mono">{stats.count}</div>
            </div>
            <div className="rounded-xl border border-glass-border-soft bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
              <div className="text-[12px] text-text-dim">Moyen</div>
              <div className="text-text text-[15px] font-medium font-mono">
                {stats.avg !== null ? formatValue(stats.avg) : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-glass-border-soft bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
              <div className="text-[12px] text-text-dim">Plus faible</div>
              <div className="text-text text-[15px] font-medium font-mono">
                {stats.worst !== null ? formatValue(stats.worst) : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-glass-border-soft bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
              <div className="text-[12px] text-text-dim">À améliorer</div>
              <div
                className="text-[15px] font-medium font-mono"
                style={{ color: stats.weakCount > 0 ? '#f97316' : '#10b981' }}
              >
                {stats.weakCount} point{stats.weakCount > 1 ? 's' : ''}
                {stats.count > 0 && (
                  <span className="text-text-dim">
                    {' '}({formatPercent(stats.weakCount / stats.count)})
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
