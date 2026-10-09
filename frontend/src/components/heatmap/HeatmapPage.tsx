import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { LocateFixed, Plus, Minus } from 'lucide-react';
import L from 'leaflet';
import { usePlanImage } from '../../hooks/usePlanImage';
import { getHeatmap, getHeatmapSpeed, getNetworks } from '../../lib/api';
import {
  getHeatmapRadius,
  setHeatmapRadius,
  calculateAutoRadius,
} from '../../lib/heatmap';
import { ApiError, type HeatmapRow, type NetworkInfo, type SpeedHeatmapRow } from '../../types/api';
import { formatPercent, formatMbps } from '../../lib/format';

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

const LEGEND: Array<{ label: string; color: string }> = [
  { label: '≥ −55 dBm · excellent', color: '#10b981' },
  { label: '≥ −67 dBm · bon', color: '#a3e635' },
  { label: '≥ −75 dBm · moyen', color: '#f59e0b' },
  { label: '≥ −85 dBm · faible', color: '#f97316' },
  { label: '< −85 dBm · très faible', color: '#ef4444' },
];

export function HeatmapPage() {
  const { plan, imageUrl, loading: planLoading, imageMissing, error: planError } = usePlanImage();
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [ssid, setSsid] = useState('');
  const [bssid, setBssid] = useState('');
  // Par défaut : seuls les cercles du réseau connecté (marqué au scan).
  const [onlyConnected, setOnlyConnected] = useState(true);
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [speedRows, setSpeedRows] = useState<SpeedHeatmapRow[]>([]);
  const [metric, setMetric] = useState<'rssi' | 'speed'>('rssi');
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
      const [data, speeds] = await Promise.all([
        getHeatmap(plan.id, {
          ssid: ssid || undefined,
          bssid: bssid || undefined,
          connected: onlyConnected || undefined,
        }),
        getHeatmapSpeed(plan.id).catch(() => [] as SpeedHeatmapRow[]),
      ]);
      setRows(data);
      setSpeedRows(speeds);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de charger la heatmap.');
    } finally {
      setLoading(false);
    }
  }, [plan, ssid, bssid, onlyConnected]);

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

  const hasFilter = !!ssid || !!bssid;
  const showingSpeed = metric === 'speed';
  const visibleCount = showingSpeed ? speedRows.length : rows.length;
  const onlyDefaultFilter = onlyConnected && !ssid && !bssid;
  const SPEED_LEGEND: Array<{ label: string; color: string }> = [
    { label: '≥ 50 Mb/s', color: '#10b981' },
    { label: '≥ 20 Mb/s', color: '#a3e635' },
    { label: '≥ 5 Mb/s', color: '#f59e0b' },
    { label: '≥ 1 Mb/s', color: '#f97316' },
    { label: '< 1 Mb/s', color: '#ef4444' },
  ];
  const activeLegend = showingSpeed ? SPEED_LEGEND : LEGEND;
  const isEmpty = showingSpeed ? speedRows.length === 0 : rows.length === 0;

  const emptyMessage = showingSpeed
    ? 'Aucune mesure de débit : configure un serveur iperf3 dans Paramètres, puis effectue des scans.'
    : onlyDefaultFilter
      ? 'Aucune mesure du réseau connecté : décoche « Connecté » pour tout voir, ou refais des scans en mode réel (le marquage demande Termux:API).'
      : hasFilter
        ? 'Aucune mesure pour ce filtre : la carte serait vide.'
        : 'Aucun relevé à afficher : effectue d’abord des scans.';

  return (
    <div className="max-w-300 mx-auto px-4 pt-6 pb-28 md:pb-8 lg:px-6 lg:py-8">
      <div className="mb-4">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">Heatmap</h1>
        <p className="text-text-dim text-sm">
          {plan.name} · {visibleCount} mesure{visibleCount > 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div
          role="group"
          aria-label="Métrique affichée"
          className="flex h-11 rounded-xl border border-glass-border-soft overflow-hidden"
        >
          {(['rssi', 'speed'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={[
                'px-4 text-sm font-medium transition-colors',
                metric === m ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text',
              ].join(' ')}
            >
              {m === 'rssi' ? 'Signal' : 'Débit'}
            </button>
          ))}
        </div>
        {!showingSpeed && (
          <>
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
        {hasFilter && !showingSpeed && (
          <button
            type="button"
            onClick={() => {
              setSsid('');
              setBssid('');
              setOnlyConnected(true);
            }}
            className="h-11 px-4 rounded-xl text-sm font-medium text-text-dim border border-glass-border hover:text-text"
          >
            Réinitialiser
          </button>
        )}
        <label className="flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm text-text-dim">
          <span className="whitespace-nowrap">Rayon {radius} px</span>
          <input
            type="range"
            aria-label="Rayon des pastilles en pixels"
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
              {!showingSpeed && rows.map((r) => (
                <CircleMarker
                  key={`${r.scan_point_id}-${r.bssid}`}
                  center={[(1 - r.y) * plan.height, r.x * plan.width]}
                  radius={radius}
                  pathOptions={{
                    color: rssiColor(r.rssi),
                    fillColor: rssiColor(r.rssi),
                    fillOpacity: 0.55,
                    weight: 2,
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
                    center={[(1 - r.y) * plan.height, r.x * plan.width]}
                    radius={radius}
                    pathOptions={{
                      color: speedColor(mbps),
                      fillColor: speedColor(mbps),
                      fillOpacity: 0.55,
                      weight: 2,
                    }}
                  >
                    <Tooltip>
                      {formatMbps(r.speed_bps)} · x {formatPercent(r.x)} · y {formatPercent(r.y)}
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {activeLegend.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5 text-[12px] text-text-dim font-mono">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
