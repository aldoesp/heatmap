import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { Check, LocateFixed, Pencil, Plus, Minus, Trash, Undo2, X } from 'lucide-react';
import L from 'leaflet';
import { usePlanImage } from '../../hooks/usePlanImage';
import {
  createPolygon,
  deletePolygon,
  getHeatmap,
  getHeatmapSpeed,
  getNetworks,
  listAccessPoints,
  listPolygons,
  updatePolygon,
} from '../../lib/api';
import {
  getHeatmapRadius,
  setHeatmapRadius,
  calculateAutoRadius,
} from '../../lib/heatmap';
import { CoverageOverlay, type CoverageBand, type CoveragePoint } from './CoverageOverlay';
import {
  PolygonEditorLayer,
  type PolygonEditingState,
} from './PolygonEditorLayer';
import { ApiError, type HeatmapRow, type NetworkInfo, type SpeedHeatmapRow } from '../../types/api';
import { dataToLatLng, type NormalizedCoord } from '../../lib/coords';
import { isValidPolygon, polygonSelfIntersects } from '../../lib/polygon';
import type { PlanPolygon } from '../../types/polygon';
import { formatPercent, formatMbps } from '../../lib/format';
import { average, RSSI_BANDS } from '../../lib/signal';
import type { AccessPoint } from '../../types/plan';
import { buildRssiMeshes, findUncoveredZones } from '../../lib/heatmapRssi';

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

/* La bande RSSI est centralisée dans lib/signal.ts, avec rssiColor et les
   mêmes seuils que le backend (rssiToLevel). */

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

const bandKey = (min: number) =>
  min === Number.NEGATIVE_INFINITY ? '-inf' : String(min);

/** Numéro affiché d'une zone (1-indexé), null si elle n'existe pas. */
function polygonNumber(
  polygons: PlanPolygon[],
  polygonId: string | null,
): number | null {
  if (!polygonId) return null;
  const index = polygons.findIndex((polygon) => polygon.id === polygonId);
  return index === -1 ? null : index + 1;
}

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
  const [accessPoints, setAccessPoints] = useState<{
    planId: string;
    items: AccessPoint[];
  } | null>(null);
  const [metric, setMetric] = useState<'rssi' | 'speed'>('rssi');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRadius, setSelectedRadius] = useState<number | null>(
    () => getHeatmapRadius()
  );
  const recenterRef = useRef<(() => void) | null>(null);
  const loadRequestRef = useRef(0);

  // Mode dessin : polygones validés et tracé en cours, propres au plan actif.
  const [drawing, setDrawing] = useState(false);
  const [activeVertices, setActiveVertices] = useState<NormalizedCoord[]>([]);
  const [polygons, setPolygons] = useState<PlanPolygon[]>([]);
  const [polygonError, setPolygonError] = useState<string | null>(null);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PolygonEditingState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [polygonBusy, setPolygonBusy] = useState(false);

  const registerRecenter = useCallback((fn: () => void) => {
    recenterRef.current = fn;
  }, []);

  const handleRecenter = useCallback(() => {
    recenterRef.current?.();
  }, []);

  const toggleDrawing = useCallback(() => {
    setPolygonError(null);
    setPendingDeleteId(null);
    if (drawing) {
      setDrawing(false);
      setActiveVertices([]);
    } else {
      setDrawing(true);
      setEditing(null);
      setSelectedPolygonId(null);
    }
  }, [drawing]);

  const handleAddVertex = useCallback((vertex: NormalizedCoord) => {
    setPolygonError(null);
    setActiveVertices((prev) => [...prev, vertex]);
  }, []);

  const handleUndoVertex = useCallback(() => {
    setPolygonError(null);
    setActiveVertices((prev) => prev.slice(0, -1));
  }, []);

  const handleCancelDrawing = useCallback(() => {
    setPolygonError(null);
    setActiveVertices([]);
  }, []);

  const handleFinishPolygon = useCallback(() => {
    if (!plan || polygonBusy) return;
    if (!isValidPolygon(activeVertices, plan.width, plan.height)) {
      setPolygonError(
        'Un polygone doit comporter au moins 3 sommets distincts et une aire non nulle.'
      );
      return;
    }
    if (polygonSelfIntersects(activeVertices, plan.width, plan.height)) {
      setPolygonError(
        'Le tracé se croise. Corrige les sommets avant de terminer la zone.'
      );
      return;
    }

    const vertices = activeVertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    setPolygonBusy(true);
    createPolygon(plan.id, vertices)
      .then((created) => {
        setPolygons((prev) => [...prev, created]);
        setActiveVertices([]);
        setSelectedPolygonId(created.id);
        setPolygonError(null);
      })
      .catch((err) => {
        const apiErr = err instanceof ApiError ? err : null;
        setPolygonError(apiErr?.message ?? 'Impossible d’enregistrer la zone.');
      })
      .finally(() => setPolygonBusy(false));
  }, [plan, activeVertices, polygonBusy]);

  const handleSelectPolygon = useCallback(
    (polygonId: string | null) => {
      if (drawing) return;
      setPendingDeleteId(null);
      setPolygonError(null);
      setSelectedPolygonId(polygonId);
      setEditing((prev) =>
        prev && prev.polygonId !== polygonId ? null : prev
      );
    },
    [drawing]
  );

  const handleStartEdit = useCallback(() => {
    if (!selectedPolygonId) return;
    const polygon = polygons.find((item) => item.id === selectedPolygonId);
    if (!polygon) return;
    setDrawing(false);
    setActiveVertices([]);
    setPendingDeleteId(null);
    setPolygonError(null);
    setEditing({
      polygonId: polygon.id,
      vertices: polygon.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    });
  }, [selectedPolygonId, polygons]);

  const handleMoveVertex = useCallback(
    (index: number, moved: NormalizedCoord) => {
      setEditing((prev) => {
        if (!prev || index < 0 || index >= prev.vertices.length) return prev;
        const vertices = prev.vertices.map((vertex, position) =>
          position === index ? { x: moved.x, y: moved.y } : vertex
        );
        return { ...prev, vertices };
      });
    },
    []
  );

  const handleCancelEdit = useCallback(() => {
    setEditing(null);
    setPolygonError(null);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!plan || !editing || polygonBusy) return;
    const { polygonId, vertices } = editing;
    if (!isValidPolygon(vertices, plan.width, plan.height)) {
      setPolygonError(
        'Un polygone doit comporter au moins 3 sommets distincts et une aire non nulle.'
      );
      return;
    }
    if (polygonSelfIntersects(vertices, plan.width, plan.height)) {
      setPolygonError(
        'Les arêtes se croisent. Corrige les sommets avant d’enregistrer.'
      );
      return;
    }

    setPolygonBusy(true);
    updatePolygon(polygonId, vertices)
      .then((updated) => {
        setPolygons((prev) =>
          prev.map((polygon) => (polygon.id === polygonId ? updated : polygon))
        );
        setEditing(null);
        setSelectedPolygonId(polygonId);
        setPolygonError(null);
      })
      .catch((err) => {
        const apiErr = err instanceof ApiError ? err : null;
        setPolygonError(apiErr?.message ?? 'Impossible d’enregistrer la zone.');
      })
      .finally(() => setPolygonBusy(false));
  }, [plan, editing, polygonBusy]);

  const handleRequestDelete = useCallback(() => {
    if (!selectedPolygonId) return;
    setEditing(null);
    setPendingDeleteId(selectedPolygonId);
    setPolygonError(null);
  }, [selectedPolygonId]);

  const handleConfirmDelete = useCallback(() => {
    const polygonId = pendingDeleteId;
    if (!polygonId || polygonBusy) return;
    setPolygonBusy(true);
    deletePolygon(polygonId)
      .then(() => {
        setPolygons((prev) => prev.filter((polygon) => polygon.id !== polygonId));
        setSelectedPolygonId((prev) => (prev === polygonId ? null : prev));
        setPendingDeleteId(null);
        setPolygonError(null);
      })
      .catch((err) => {
        const apiErr = err instanceof ApiError ? err : null;
        setPolygonError(apiErr?.message ?? 'Impossible de supprimer la zone.');
      })
      .finally(() => setPolygonBusy(false));
  }, [pendingDeleteId, polygonBusy]);

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  // Chargement des zones persistées du plan actif (backend = source de vérité).
  useEffect(() => {
    if (!plan) return;
    let alive = true;
    listPolygons(plan.id)
      .then((loaded) => {
        if (!alive) return;
        setPolygons(loaded.filter((polygon) => polygon.planId === plan.id));
      })
      .catch((err) => {
        if (!alive) return;
        const apiErr = err instanceof ApiError ? err : null;
        setPolygonError(
          apiErr?.message ?? 'Impossible de charger les zones de délimitation.'
        );
      });
    return () => {
      alive = false;
    };
  }, [plan]);

  const visiblePolygons = useMemo(
    () =>
      plan ? polygons.filter((polygon) => polygon.planId === plan.id) : [],
    [polygons, plan]
  );

  const selectedPolygon = useMemo(
    () => polygons.find((polygon) => polygon.id === selectedPolygonId) ?? null,
    [polygons, selectedPolygonId]
  );

  const selectedZoneNumber = polygonNumber(polygons, selectedPolygonId);
  const editingZoneNumber = editing
    ? polygonNumber(polygons, editing.polygonId)
    : null;
  const pendingDeleteZoneNumber = polygonNumber(polygons, pendingDeleteId);

  const draftSelfIntersects = useMemo(
    () =>
      drawing && plan && activeVertices.length >= 4
        ? polygonSelfIntersects(activeVertices, plan.width, plan.height)
        : false,
    [drawing, plan, activeVertices]
  );

  const editingSelfIntersects = useMemo(
    () =>
      editing && plan
        ? polygonSelfIntersects(editing.vertices, plan.width, plan.height)
        : false,
    [editing, plan]
  );

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

  // AP placés sur le plan (page Import) : seuls repères affichés sur la carte.
  useEffect(() => {
    if (!plan) return;
    let alive = true;
    listAccessPoints(plan.id)
      .then((aps) => {
        if (alive) setAccessPoints({ planId: plan.id, items: aps });
      })
      .catch(() => {
        /* AP indisponibles : la heatmap reste affichable sans eux */
      });
    return () => {
      alive = false;
    };
  }, [plan]);

  const load = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

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
          band: band || undefined,
        }),
        getHeatmapSpeed(plan.id).catch(() => [] as SpeedHeatmapRow[]),
      ]);
      if (loadRequestRef.current !== requestId) return;
      setRows(data);
      setSpeedRows(speeds);
    } catch (err) {
      if (loadRequestRef.current !== requestId) return;
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de charger la heatmap.');
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false);
    }
  }, [plan, ssid, bssid, onlyConnected, band]);

  useEffect(
    () => () => {
      loadRequestRef.current += 1;
    },
    []
  );

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

  const showingSpeed = metric === 'speed';

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

  const coveragePoints = useMemo<CoveragePoint[]>(
    () => speedRows.map((r) => ({ x: r.x, y: r.y, value: r.speed_bps / 1_000_000 })),
    [speedRows]
  );

  const rssiMeshModel = useMemo(
    () =>
      !showingSpeed && plan
        ? buildRssiMeshes(
            rows,
            {
              id: plan.id,
              width: plan.width,
              height: plan.height,
            },
            { polygons: visiblePolygons }
          )
        : null,
    [showingSpeed, rows, plan, visiblePolygons]
  );

  // Retour discret sur les zones présentes sur le plan mais non couvertes :
  // `findUncoveredZones` ne remonte que les zones réellement sans triangle
  // (status + skipped[].polygonId) et renvoie une liste vide quand tout va
  // bien — aucun message n'est alors affiché.
  const zoneCoverageNotice = useMemo<string | null>(() => {
    if (showingSpeed || !plan || !rssiMeshModel) return null;
    const uncovered = findUncoveredZones(rssiMeshModel, visiblePolygons, plan);
    if (uncovered.length === 0) return null;

    const labels = uncovered.map(
      (zone) => `Zone ${zone.zoneNumber} (${zone.reason})`
    );
    return labels.length === 1
      ? `${labels[0]} : la zone reste transparente.`
      : `${labels.join(' · ')} : ces zones restent transparentes.`;
  }, [showingSpeed, plan, rssiMeshModel, visiblePolygons]);

  const stats = useMemo(() => {
    const values = showingSpeed
      ? speedRows.map((r) => r.speed_bps / 1_000_000)
      : bestPerPoint.map((r) => r.rssi);
    const avg = average(values);
    return {
      count: values.length,
      avg,
      best: values.length ? Math.max(...values) : null,
      worst: values.length ? Math.min(...values) : null,
      // « À améliorer » = sous le seuil fair (< -75 dBm / < 5 Mb/s).
      weakCount: values.filter((v) => (showingSpeed ? v < 5 : v < -75)).length,
    };
  }, [showingSpeed, speedRows, bestPerPoint]);

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
  const visibleCount = showingSpeed ? speedRows.length : rows.length;
  const activeBands = showingSpeed ? SPEED_BANDS : RSSI_BANDS;
  const activeLabels = showingSpeed ? SPEED_LABELS : RSSI_LABELS;
  const isEmpty = showingSpeed ? speedRows.length === 0 : rows.length === 0;
  const visibleAccessPoints =
    accessPoints?.planId === plan.id ? accessPoints.items : [];

  const emptyMessage = showingSpeed
    ? 'Aucune mesure de débit : configure un serveur iperf3 dans Paramètres, puis effectue des scans.'
    : onlyDefaultFilter
      ? 'Aucune mesure du réseau connecté : décoche « Connecté » pour tout voir, ou refais des scans en mode réel (le marquage demande Termux:API).'
      : hasFilter
        ? 'Aucune mesure pour ce filtre : la carte serait vide.'
        : 'Aucun relevé à afficher : effectue d’abord des scans.';

  // stats.values sont en Mb/s (débit) ou dBm (RSSI) : formatMbps attend
  // des bits/s, on reconvertit avant de formater.
  const formatValue = (v: number) =>
    showingSpeed ? formatMbps(v * 1_000_000) : `${Math.round(v)} dBm`;

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
        {showingSpeed && (
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
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button
              type="button"
              aria-pressed={drawing}
              onClick={toggleDrawing}
              disabled={!!editing || polygonBusy}
              className={[
                'inline-flex items-center gap-2 h-11 px-4 rounded-xl border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                drawing
                  ? 'bg-accent-soft text-accent border-accent-border'
                  : 'text-text-dim border-glass-border-soft hover:text-text',
              ].join(' ')}
            >
              <Pencil size={16} strokeWidth={1.75} aria-hidden />
              {drawing ? 'Quitter le dessin' : 'Dessiner une zone'}
            </button>

            {drawing && (
              <>
                <button
                  type="button"
                  onClick={handleUndoVertex}
                  disabled={activeVertices.length === 0}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Undo2 size={16} strokeWidth={1.75} aria-hidden />
                  Annuler le sommet
                </button>
                <button
                  type="button"
                  onClick={handleCancelDrawing}
                  disabled={activeVertices.length === 0}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                  Annuler le tracé
                </button>
                <button
                  type="button"
                  onClick={handleFinishPolygon}
                  disabled={
                    activeVertices.length < 3 || polygonBusy || draftSelfIntersects
                  }
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-accent-border bg-accent-soft text-sm font-medium text-accent disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check size={16} strokeWidth={1.75} aria-hidden />
                  Terminer le polygone
                </button>
                <span className="text-[12px] text-text-dim">
                  {activeVertices.length === 0
                    ? 'Clique sur le plan pour placer le premier sommet.'
                    : `${activeVertices.length} sommet${activeVertices.length > 1 ? 's' : ''}`}
                  {draftSelfIntersects ? ' · tracé qui se croise' : ''}
                </span>
              </>
            )}

            {!drawing && editing && (
              <>
                <span className="text-[12px] text-text-dim">
                  Zone {editingZoneNumber ?? '?'} · glisse les sommets
                </span>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={polygonBusy}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                  Annuler l’édition
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={polygonBusy || editingSelfIntersects}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-accent-border bg-accent-soft text-sm font-medium text-accent disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check size={16} strokeWidth={1.75} aria-hidden />
                  Terminer l’édition
                </button>
              </>
            )}

            {!drawing && !editing && selectedPolygon && (
              <>
                <span className="text-[12px] text-text-dim">
                  Zone {selectedZoneNumber ?? '?'} sélectionnée
                </span>
                <button
                  type="button"
                  onClick={handleStartEdit}
                  disabled={polygonBusy}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Pencil size={16} strokeWidth={1.75} aria-hidden />
                  Modifier les sommets
                </button>
                <button
                  type="button"
                  onClick={handleRequestDelete}
                  disabled={polygonBusy}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-danger text-danger text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash size={16} strokeWidth={1.75} aria-hidden />
                  Supprimer la zone
                </button>
              </>
            )}

            {!drawing && !editing && !selectedPolygon && polygons.length > 0 && (
              <span className="text-[12px] text-text-dim">
                Clique sur une zone pour la sélectionner.
              </span>
            )}
          </div>

          {pendingDeleteId && (
            <div className="mb-2 flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl border border-danger bg-danger-soft text-sm text-text">
              <span className="flex-1 min-w-[12rem]">
                Supprimer la zone {pendingDeleteZoneNumber ?? '?'} ? Cette action est définitive.
              </span>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={polygonBusy}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-danger text-danger font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check size={16} strokeWidth={1.75} aria-hidden />
                Confirmer la suppression
              </button>
              <button
                type="button"
                onClick={handleCancelDelete}
                disabled={polygonBusy}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-glass-border-soft text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X size={16} strokeWidth={1.75} aria-hidden />
                Annuler
              </button>
            </div>
          )}

          {drawing && draftSelfIntersects && (
            <div className="mb-2 px-4 py-2.5 rounded-xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.12)] text-sm text-text">
              Le tracé se croise : le polygone ne pourra pas être terminé tel quel.
            </div>
          )}

          {editing && editingSelfIntersects && (
            <div className="mb-2 px-4 py-2.5 rounded-xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.12)] text-sm text-text">
              Les arêtes se croisent : corrige les sommets avant d’enregistrer.
            </div>
          )}

          {polygonError && (
            <div className="mb-2 px-4 py-2.5 rounded-xl border border-danger bg-danger-soft text-sm text-text">
              {polygonError}
            </div>
          )}

          {zoneCoverageNotice && (
            <div className="mb-2 px-4 py-2.5 rounded-xl border border-glass-border-soft text-[13px] text-text-dim">
              {zoneCoverageNotice}
            </div>
          )}

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
              {/* Champ interpolé sous les points de mesure. Le RSSI utilise
                  Delaunay + barycentrique, contraint aux zones ; seul le débit
                  garde l'IDW, masqué hors des zones. */}
              {showingSpeed ? (
                <CoverageOverlay
                  interpolation="idw"
                  points={coveragePoints}
                  width={plan.width}
                  height={plan.height}
                  radius={radius}
                  bounds={bounds}
                  bands={activeBands}
                  polygons={visiblePolygons}
                />
              ) : (
                <CoverageOverlay
                  interpolation="triangulation"
                  meshes={rssiMeshModel?.meshes ?? []}
                  width={plan.width}
                  height={plan.height}
                  bounds={bounds}
                  bands={RSSI_BANDS}
                />
              )}
              {/* Les points de mesure ne sont pas affichés : seuls les AP
                  ajoutés au plan servent de repère sur la carte. */}
              {visibleAccessPoints.map((ap) => (
                <CircleMarker
                  key={ap.id}
                  center={dataToLatLng(ap.x, ap.y, plan.width, plan.height)}
                  radius={6}
                  bubblingMouseEvents={false}
                  pathOptions={{
                    color: '#0d1319',
                    fillColor: '#10b981',
                    fillOpacity: 0.95,
                    weight: 1.5,
                  }}
                >
                  <Tooltip
                    permanent
                    direction="right"
                    offset={[8, 0]}
                    className="heatmap-ap-label"
                  >
                    {ap.name}
                  </Tooltip>
                </CircleMarker>
              ))}
              <PolygonEditorLayer
                width={plan.width}
                height={plan.height}
                drawing={drawing}
                activeVertices={activeVertices}
                polygons={visiblePolygons}
                selectedPolygonId={selectedPolygonId}
                editing={editing}
                onAddVertex={handleAddVertex}
                onFinish={handleFinishPolygon}
                onSelectPolygon={handleSelectPolygon}
                onMoveVertex={handleMoveVertex}
              />
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
              {showingSpeed ? 'Débit' : 'Signal'} · meilleur relevé{' '}
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
