import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, ImageOverlay, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { usePlanImage } from '../../hooks/usePlanImage';
import { getHeatmap, getNetworks } from '../../lib/api';
import { ApiError, type HeatmapRow, type NetworkInfo } from '../../types/api';
import { formatPercent } from '../../lib/format';

function rssiColor(rssi: number): string {
  if (rssi >= -55) return '#10b981';
  if (rssi >= -67) return '#a3e635';
  if (rssi >= -75) return '#f59e0b';
  if (rssi >= -85) return '#f97316';
  return '#ef4444';
}

function FitBounds({ width, height }: { width: number; height: number }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLngBounds([0, 0], [height, width]);
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, width, height]);
  return null;
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
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const data = await getHeatmap(plan.id, {
        ssid: ssid || undefined,
        bssid: bssid || undefined,
      });
      setRows(data);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de charger la heatmap.');
    } finally {
      setLoading(false);
    }
  }, [plan, ssid, bssid]);

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

  if (planLoading || loading) {
    return <div className="fixed inset-0 bg-bg" />;
  }

  if ((planError && !plan) || (!plan && !planLoading)) {
    return (
      <div className="max-w-150 mx-auto px-4 py-16 text-center">
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
      <div className="max-w-150 mx-auto px-4 py-16 text-center">
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

  return (
    <div className="max-w-300 mx-auto px-4 py-6 lg:px-6 lg:py-8">
      <div className="mb-4">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">Heatmap</h1>
        <p className="text-text-dim text-sm">
          {plan.name} · {rows.length} mesure{rows.length > 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
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
              {b}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setSsid('');
              setBssid('');
            }}
            className="h-11 px-4 rounded-xl text-sm font-medium text-text-dim border border-glass-border hover:text-text"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-sm text-text">
          {error}{' '}
          <button type="button" onClick={load} className="underline font-medium">
            Réessayer
          </button>
        </div>
      )}

      {rows.length === 0 && !error ? (
        <div className="text-center py-16">
          <p className="text-text text-[15px] mb-2">
            {hasFilter
              ? 'Aucune mesure pour ce filtre : la carte serait vide.'
              : 'Aucun relevé à afficher : effectue d’abord des scans.'}
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
          <div className="rounded-2xl overflow-hidden border border-glass-border-soft">
            <MapContainer
              bounds={bounds}
              crs={L.CRS.Simple}
              attributionControl={false}
              className="w-full h-[60vh] z-0"
            >
              <FitBounds width={plan.width} height={plan.height} />
              <ImageOverlay url={imageUrl} bounds={bounds} />
              {rows.map((r) => (
                <CircleMarker
                  key={`${r.scan_point_id}-${r.bssid}`}
                  center={[(1 - r.y) * plan.height, r.x * plan.width]}
                  radius={10 + Math.max(0, (r.rssi + 100) / 10)}
                  pathOptions={{
                    color: rssiColor(r.rssi),
                    fillColor: rssiColor(r.rssi),
                    fillOpacity: 0.55,
                    weight: 2,
                  }}
                >
                  <Tooltip>
                    {r.ssid ?? '(réseau masqué)'} · {r.bssid}
                    <br />
                    {r.rssi} dBm · x {formatPercent(r.x)} · y {formatPercent(r.y)}
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {LEGEND.map((l) => (
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
