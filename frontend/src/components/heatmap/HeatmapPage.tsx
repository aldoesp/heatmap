import { PngZip, sanitizeZipName, type HeatmapZipManifestImage } from '../../lib/exportZip';
import { planRegionFromBounds, type ExportArea, type PlanRegion } from '../../lib/exportRegion';
import type { HeatmapWorkerResponse } from '../../lib/heatmapWorkerClient';
import type { RssiCalculation } from '../../lib/regularizedRssi';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  ImageOverlay,
  CircleMarker,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Check, Download, Eye, EyeOff, LocateFixed, Pencil, Plus, Minus, Trash, Undo2, Wifi, X, ScanLine } from 'lucide-react';
import L from 'leaflet';
import { useApPositions } from '../../hooks/useApPositions';
import type { ApiRead } from '../../lib/apiRead';
import { useApiQuery } from '../../hooks/useApiQuery';
import { usePlanImage } from '../../hooks/usePlanImage';
import {
  createPolygon,
  deletePolygon,
  getHeatmap,
  getHeatmapForExport,
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
import { CoverageOverlay } from './CoverageOverlay';
import { BatchExportPanel } from './BatchExportPanel';
import { useHeatmapRender } from '../../hooks/useHeatmapRender';
import type { CoverageBand, CoveragePoint, HeatmapRenderInput, HeatmapRenderResult } from '../../lib/heatmapRender';
import { RssiProbeLayer } from './RssiProbeLayer';
import {
  PolygonEditorLayer,
  type PolygonEditingState,
} from './PolygonEditorLayer';
import { ApiError, type HeatmapRow, type NetworkInfo, type SpeedHeatmapRow } from '../../types/api';
import {
  clampCoord,
  dataToLatLng,
  latlngToData,
  type NormalizedCoord,
} from '../../lib/coords';
import { ApMarkersLayer } from '../scan/markers/ApMarkersLayer';
import { Combobox, type ComboboxOption } from '../ui/Combobox';
import { isValidPolygon, polygonSelfIntersects } from '../../lib/polygon';
import type { PlanPolygon } from '../../types/polygon';
import { formatPercent, formatMbps } from '../../lib/format';
import { average, RSSI_BANDS } from '../../lib/signal';
import type { AccessPoint } from '../../types/plan';
import { useHeatmapColours } from '../../hooks/useHeatmapColours';
import { buildColourLut, colourLutToCssGradient, lutColourForRssi, rssiToPosition, RSSI_MAX, RSSI_MIN } from '../../lib/heatmapColours';
import { createPlanPngBlob, downloadBlob, exportPlanPng, planPngFileName } from '../../lib/exportPng';
import { EXPORT_RASTER_DIMENSION } from '../../lib/heatmapRaster';

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
        <div className="flex flex-col rounded-xl overflow-hidden border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150">
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

function ApPlacementClickCatcher({
  active,
  onPlace,
}: {
  active: boolean;
  onPlace: (latlng: L.LatLng) => void;
}) {
  useMapEvents({
    click(event) {
      if (!active) return;
      const target = event.originalEvent.target;
      if (
        target instanceof Element &&
        target.closest('button, a, input, select, textarea, .leaflet-control')
      ) {
        return;
      }
      onPlace(event.latlng);
    },
  });
  return null;
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
  '-55': 'Excellent · ≥ −55 dBm',
  '-67': 'Bon · −67 à −55 dBm',
  '-75': 'Moyen · −75 à −67 dBm',
  '-85': 'Faible · −85 à −75 dBm',
  '-inf': 'Très faible · < −85 dBm',
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
  const { plan, imageUrl, loading: planLoading, imageMissing, error: planError } = usePlanImage({ waitForImageCheck: false });
  const planId = plan?.id;
  const { positions: apPositions, save: saveApPosition } = useApPositions(
    plan?.id ?? null
  );
  const [placingAp, setPlacingAp] = useState(false);
  const [showEstimated, setShowEstimated] = useState(true);
  const { colours } = useHeatmapColours();
  const rssiLut = useMemo(() => buildColourLut(colours), [colours]);
  const legendGradient = useMemo(() => colourLutToCssGradient(rssiLut), [rssiLut]);
  const [layerOpacity, setLayerOpacity] = useState(1);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const batchRef = useRef<AbortController | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [batchError, setBatchError] = useState<string | null>(null);
  useEffect(() => () => { batchRef.current?.abort(); }, [plan?.id]);
  const [exportingPng, setExportingPng] = useState(false);
  const [exportPngError, setExportPngError] = useState<string | null>(null);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [calculation, setCalculation] = useState<RssiCalculation>('regularized');
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [networksPlanId, setNetworksPlanId] = useState<string | null>(null);
  const [ssid, setSsid] = useState('');
  const [bssid, setBssid] = useState('');
  // Bande affichée ('' = toutes), façon sélecteur 2.4/5/6 GHz d'UniFi.
  const [band, setBand] = useState<BandChoice>('');
  // Les imports peuvent ne pas porter de marqueur de connexion : afficher tous les réseaux par défaut.
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [speedRows, setSpeedRows] = useState<SpeedHeatmapRow[]>([]);
  const [accessPoints, setAccessPoints] = useState<{
    planId: string;
    items: AccessPoint[];
  } | null>(null);
  const [metric] = useState<'rssi' | 'speed'>('rssi');
  const [loading, setLoading] = useState(true);
  const [speedLoading, setSpeedLoading] = useState(true);
  const [speedError, setSpeedError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRadius, setSelectedRadius] = useState<number | null>(
    () => getHeatmapRadius()
  );
  const recenterRef = useRef<(() => void) | null>(null);

  // Mode dessin : polygones validés et tracé en cours, propres au plan actif.
  const [drawing, setDrawing] = useState(false);
  const [activeVertices, setActiveVertices] = useState<NormalizedCoord[]>([]);
  const [polygons, setPolygons] = useState<PlanPolygon[]>([]);
  const [polygonsLoading, setPolygonsLoading] = useState(true);
  const [polygonError, setPolygonError] = useState<string | null>(null);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PolygonEditingState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [polygonBusy, setPolygonBusy] = useState(false);
  // Affichage des zones sur la carte (masquées par défaut). Le découpage de la
  // heatmap reste appliqué : seul le rendu bleu des polygones est concerné.
  const [showZones, setShowZones] = useState(false);
  const [showProbe, setShowProbe] = useState(true);

  const registerRecenter = useCallback((fn: () => void) => {
    recenterRef.current = fn;
  }, []);

  const handleRecenter = useCallback(() => {
    recenterRef.current?.();
  }, []);

  const toggleDrawing = useCallback(() => {
    setPlacingAp(false);
    setPolygonError(null);
    setPendingDeleteId(null);
    if (drawing) {
      setDrawing(false);
      setActiveVertices([]);
    } else {
      setDrawing(true);
      setShowZones(true);
      setEditing(null);
      setSelectedPolygonId(null);
    }
  }, [drawing]);

  const toggleZones = useCallback(() => {
    setPendingDeleteId(null);
    setPolygonError(null);
    setSelectedPolygonId(null);
    setShowZones((prev) => !prev);
  }, []);

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

  const handleStartEdit = useCallback((polygonId: string) => {
    const polygon = polygons.find((item) => item.id === polygonId);
    if (!polygon) return;
    setDrawing(false);
    setActiveVertices([]);
    setPendingDeleteId(null);
    setPolygonError(null);
    setShowZones(true);
    setSelectedPolygonId(polygonId);
    setEditing({
      polygonId: polygon.id,
      vertices: polygon.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    });
  }, [polygons]);

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
    updatePolygon(polygonId, vertices, plan.id)
      .then(() => {
        setEditing(null);
        setSelectedPolygonId(null);
        setPendingDeleteId(null);
        setPolygonError(null);
      })
      .catch((err) => {
        const apiErr = err instanceof ApiError ? err : null;
        setPolygonError(apiErr?.message ?? 'Impossible d’enregistrer la zone.');
      })
      .finally(() => setPolygonBusy(false));
  }, [plan, editing, polygonBusy]);

  const handleRequestDelete = useCallback((polygonId: string) => {
    setEditing(null);
    setPendingDeleteId(polygonId);
    setPolygonError(null);
  }, []);

  const handleSelectZone = useCallback(
    (polygonId: string) => {
      setShowZones(true);
      handleSelectPolygon(polygonId);
    },
    [handleSelectPolygon]
  );

  const handleConfirmDelete = useCallback(() => {
    const polygonId = pendingDeleteId;
    if (!polygonId || polygonBusy) return;
    setPolygonBusy(true);
    deletePolygon(polygonId, planId)
      .then(() => {
        setSelectedPolygonId((prev) => (prev === polygonId ? null : prev));
        setPendingDeleteId(null);
        setPolygonError(null);
      })
      .catch((err) => {
        const apiErr = err instanceof ApiError ? err : null;
        setPolygonError(apiErr?.message ?? 'Impossible de supprimer la zone.');
      })
      .finally(() => setPolygonBusy(false));
  }, [pendingDeleteId, planId, polygonBusy]);

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const loadPolygons = useCallback((read: ApiRead) => listPolygons(planId!, read), [planId]);
  useApiQuery(planId ? loadPolygons : null, {
    success: loaded => setPolygons(loaded.filter(polygon => polygon.planId === planId)),
    error: err => setPolygonError(err instanceof ApiError ? err.message : 'Impossible de charger les zones de délimitation.'),
    settled: () => setPolygonsLoading(false),
  });

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

  const loadNetworks = useCallback((read: ApiRead) => getNetworks(planId!, read), [planId]);
  useApiQuery(planId ? loadNetworks : null, {
    success: rows => {
      setNetworks(rows);
      setNetworksPlanId(planId ?? null);
    },
  });

  const loadAccessPoints = useCallback((read: ApiRead) => listAccessPoints(planId!, read), [planId]);
  useApiQuery(planId ? loadAccessPoints : null, {
    success: items => { if (planId) setAccessPoints({ planId, items }); },
  });

  const loadRssiRows = useCallback(async (read: ApiRead) => {
    const start = performance.now();
    const data = await getHeatmap(planId!, {
      ssid: ssid || undefined,
      bssid: bssid || undefined,
      connected: onlyConnected || undefined,
      band: band || undefined,
    }, read);
    console.info(`[heatmap] getHeatmap ${(performance.now() - start).toFixed(1)} ms · rows.length=${data.length}`);
    return data;
  }, [planId, ssid, bssid, onlyConnected, band]);
  const load = useApiQuery(planLoading || !planId ? null : loadRssiRows, {
    start: () => { setLoading(true); setError(null); },
    success: setRows,
    error: err => setError(err instanceof ApiError ? err.message : 'Impossible de charger la heatmap.'),
    settled: () => setLoading(false),
  });

  const loadSpeedRows = useCallback((read: ApiRead) => getHeatmapSpeed(planId!, read), [planId]);
  const loadSpeed = useApiQuery(planId && metric === 'speed' ? loadSpeedRows : null, {
    start: () => { setSpeedLoading(true); setSpeedError(null); },
    success: setSpeedRows,
    error: err => setSpeedError(err instanceof ApiError ? err.message : 'Impossible de charger les mesures de débit.'),
    settled: () => setSpeedLoading(false),
  });

  // Options du combobox « Réseau Wi-Fi » : « Tous les réseaux » en tête,
  // puis les SSID triés par ordre alphabétique. La recherche filtre la liste
  // instantanément, comme pour le sélecteur de radio.
  const ssidOptions = useMemo<ComboboxOption[]>(() => {
    const items = [...new Set(networks.map((n) => n.ssid).filter((s): s is string => !!s))]
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map<ComboboxOption>((s) => ({ value: s, label: s }));
    return [{ value: '', label: 'Tous les réseaux' }, ...items];
  }, [networks]);
  const bssids = useMemo(() => [...new Set(networks.map((n) => n.bssid))], [networks]);

  // Options du combobox « Borne / radio » : « Toutes les radios » en tête,
  // puis chaque BSSID avec libellé = bssid_name (fallback BSSID). La recherche
  // couvre le BSSID, son alias et le SSID, à l'identique de l'ancien sélecteur.
  const radioOptions = useMemo<ComboboxOption[]>(() => {
    const items = bssids.map<ComboboxOption>((b) => {
      const network = networks.find((n) => n.bssid === b);
      return {
        value: b,
        label: network?.bssid_name ?? b,
        searchText: [b, network?.bssid_name, network?.ssid]
          .filter((part): part is string => !!part)
          .join(' '),
      };
    });
    return [{ value: '', label: 'Toutes les radios' }, ...items];
  }, [bssids, networks]);

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

  const dataLoading = (showingSpeed ? speedLoading : loading) || polygonsLoading;
  const dataError = showingSpeed ? speedError : error;
  const visibleAccessPoints = useMemo(
    () => plan && accessPoints?.planId === plan.id ? accessPoints.items : [],
    [accessPoints, plan],
  );
  const renderInput = useMemo<HeatmapRenderInput | null>(() => {
    if (!plan || dataLoading || imageMissing || (showingSpeed ? !speedRows.length : !rows.length)) return null;
    return {
      metric, calculation, plan: { id: plan.id, width: plan.width, height: plan.height },
      measurements: rows, points: coveragePoints, polygons: visiblePolygons,
      apPositions, accessPoints: visibleAccessPoints, radius,
      bands: showingSpeed ? SPEED_BANDS : RSSI_BANDS, lut: rssiLut, showEstimated,
    };
  }, [plan, dataLoading, imageMissing, showingSpeed, speedRows, rows, metric, calculation,
    coveragePoints, visiblePolygons, apPositions, visibleAccessPoints, radius, rssiLut, showEstimated]);
  const rendering = useHeatmapRender(renderInput);
  const renderForExport = rendering.renderForExport;

  const handleExportZip = async (selected: string[], area: ExportArea) => {
    if (!plan || !imageUrl || batchRef.current || !selected.length) return;
    const controller = new AbortController();
    batchRef.current = controller;
    setBatchBusy(true); setBatchError(null); setBatchProgress('Préparation…');
    let added = 0;
    const errors: Array<{ bssid: string; message: string }> = [];
    const manifestImages: HeatmapZipManifestImage[] = [];
    const zip = new PngZip();
    const base = planPngFileName(plan.name).replace(/-heatmap\.png$/, '');
    const exportedAt = new Date();
    const workers = [0, 1].map(() => new Worker(new URL('../../lib/heatmap.worker.ts', import.meta.url), { type: 'module' }));
    let region: PlanRegion | undefined;

    // zip.add touche un état partagé : les écritures sont sérialisées.
    let addQueue = Promise.resolve();
    const serializeAdd = (task: () => Promise<void>): Promise<void> => {
      const next = addQueue.then(task);
      addQueue = next.catch(() => undefined);
      return next;
    };

    const renderExport = (worker: Worker, input: HeatmapRenderInput, id: number): Promise<HeatmapRenderResult> =>
      new Promise((resolve, reject) => {
        const cancel = () => { worker.terminate(); reject(new DOMException('Export annulé', 'AbortError')); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        const cleanup = () => controller.signal.removeEventListener('abort', cancel);
        worker.onmessage = ({ data }: MessageEvent<HeatmapWorkerResponse>) => {
          if (data.type === 'export' && data.id === id) { cleanup(); resolve(data.result); }
          else if (data.type === 'export-error' && 'id' in data && data.id === id) { cleanup(); reject(new Error(data.message)); }
          else if (data.type === 'error') { cleanup(); reject(new Error(data.message)); }
        };
        worker.onerror = () => { cleanup(); reject(new Error('Calcul de l’export interrompu.')); };
        worker.postMessage({ type: 'export', id, input });
      });

    const exportOne = async (worker: Worker, target: string, index: number): Promise<void> => {
      const step = (text: string) => setBatchProgress(`${index + 1} / ${selected.length} · ${target} · ${text}`);
      try {
        step('Récupération…');
        const measurements = await getHeatmapForExport(plan.id, {
          ssid: ssid || undefined, bssid: target, band: band || undefined, connected: onlyConnected || undefined,
        }, controller.signal);
        controller.signal.throwIfAborted();
        if (!measurements.length) throw new Error(`${target} : aucune mesure pour les filtres actuels.`);
        const best = new Map<string, HeatmapRow>();
        for (const row of measurements) {
          if (!best.has(row.scan_point_id) || row.rssi > best.get(row.scan_point_id)!.rssi) best.set(row.scan_point_id, row);
        }
        const points = [...best.values()];
        const input: HeatmapRenderInput = {
          metric: 'rssi', calculation, plan: { id: plan.id, width: plan.width, height: plan.height },
          measurements, points: [], polygons: visiblePolygons, apPositions, accessPoints: visibleAccessPoints,
          radius: selectedRadius ?? calculateAutoRadius(points, plan.width, plan.height),
          bands: RSSI_BANDS, lut: rssiLut, showEstimated, maxRasterDimension: EXPORT_RASTER_DIMENSION,
        };
        step('Rasterisation…');
        const result = await renderExport(worker, input, index);
        controller.signal.throwIfAborted();
        const fileName = `${sanitizeZipName(base, 50)}_${sanitizeZipName(target, 30) || 'bssid'}_${area}.png`;
        step('Compression…');
        const blob = await createPlanPngBlob({
          planImageUrl: imageUrl, heatmapImage: result.image, width: plan.width, height: plan.height,
          opacity: layerOpacity, fileName, rssiLut, region,
          metadata: { planName: plan.name, ssid, bssid: target, band, calculation, exportedAt },
          accessPoints: visibleAccessPoints,
          measurementPoints: points, showMeasurementPoints: showMeasurements,
        });
        controller.signal.throwIfAborted();
        step('Écriture ZIP…');
        await serializeAdd(() => zip.add(fileName, blob));
        added++;
        manifestImages.push({ file: fileName, bssid: target, ssid: ssid ?? '', band: band ?? '', calculation });
      } catch (err) {
        if (controller.signal.aborted) return;
        errors.push({ bssid: target, message: err instanceof Error ? err.message : String(err) });
      }
    };

    try {
      const bounds = mapRef.current?.getBounds();
      if (area === 'visible' && !bounds) throw new Error('Zone visible indisponible.');
      region = area === 'visible' && bounds ? planRegionFromBounds({
        south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast(),
      }, plan.width, plan.height) : undefined;

      await Promise.all(workers.map(async (worker, offset) => {
        for (let index = offset; index < selected.length; index += workers.length) {
          if (controller.signal.aborted) return;
          await exportOne(worker, selected[index], index);
        }
      }));
      controller.signal.throwIfAborted();

      if (added === 0) throw new Error(errors.length ? errors[0].message : 'Aucune image à exporter.');
      zip.addManifest({
        format: 'heatmap-zip', version: 1,
        exportedAt: exportedAt.toISOString(),
        plan: { id: plan.id, name: plan.name, width: plan.width, height: plan.height },
        images: manifestImages,
      });
      const zipBlob = zip.finish();
      const fileName = `${sanitizeZipName(base, 50)}-heatmaps-${area}.zip`;
      if (!downloadBlob(zipBlob, fileName)) { setBatchProgress('Téléchargement annulé.'); return; }

      if (errors.length) {
        setBatchProgress(`${added} images exportées (ZIP partiel).`);
        setBatchError(`${added} exportée${added > 1 ? 'es' : ''}, ${errors.length} en erreur : ${errors.map((entry) => `${entry.bssid} (${entry.message})`).join('; ')}`);
      } else {
        setBatchProgress(`${added} images exportées en ZIP.`);
      }
    } catch (error) {
      if (controller.signal.aborted) setBatchProgress('Export annulé.');
      else { setBatchProgress(''); setBatchError(error instanceof Error ? error.message : 'Export ZIP impossible.'); }
    } finally {
      for (const worker of workers) worker.terminate();
      batchRef.current = null; setBatchBusy(false);
    }
  };

  const handleExportPng = useCallback(async () => {
    if (!plan || !imageUrl || !renderInput || exportingPng || showingSpeed) return;
    setExportingPng(true);
    setExportPngError(null);
    try {
      const exported = await renderForExport({
        ...renderInput,
        maxRasterDimension: EXPORT_RASTER_DIMENSION,
      });
      await exportPlanPng({
        planImageUrl: imageUrl,
        heatmapImage: exported.image,
        width: plan.width,
        height: plan.height,
        opacity: layerOpacity,
        fileName: planPngFileName(plan.name),
        rssiLut,
        metadata: {
          planName: plan.name,
          ssid,
          bssid,
          band,
          calculation,
          exportedAt: new Date(),
        },
        accessPoints: visibleAccessPoints,
        measurementPoints: bestPerPoint,
        showMeasurementPoints: showMeasurements,
      });
    } catch (err) {
      setExportPngError(
        err instanceof Error ? err.message : 'Impossible d’exporter le plan en PNG.'
      );
    } finally {
      setExportingPng(false);
    }
  }, [
    plan,
    imageUrl,
    renderInput,
    renderForExport,
    exportingPng,
    showingSpeed,
    layerOpacity,
    rssiLut,
    ssid,
    bssid,
    band,
    calculation,
    visibleAccessPoints,
    bestPerPoint,
    showMeasurements,
  ]);

  const displayedBssid = useMemo(() => {
    if (bssid) return bssid;
    const visible = rendering.metadata.bssids;
    return visible.length === 1 ? visible[0] : null;
  }, [bssid, rendering.metadata.bssids]);

  const selectedApPositions = useMemo(() => {
    if (!displayedBssid) return [];
    const target = displayedBssid.trim().toLowerCase();
    return apPositions.filter(
      (position) => position.bssid.trim().toLowerCase() === target
    );
  }, [apPositions, displayedBssid]);

  const handlePlaceAp = useCallback(
    (latlng: L.LatLng) => {
      if (!plan || !displayedBssid) return;
      const clamped = clampCoord(latlngToData(latlng, plan.width, plan.height));
      saveApPosition(displayedBssid, clamped.x, clamped.y).catch(
        () => undefined
      );
    },
    [plan, displayedBssid, saveApPosition]
  );

  const handleApDragEnd = useCallback(
    (draggedBssid: string, latlng: L.LatLng) => {
      if (!plan) return;
      const clamped = clampCoord(latlngToData(latlng, plan.width, plan.height));
      saveApPosition(draggedBssid, clamped.x, clamped.y).catch(() => undefined);
    },
    [plan, saveApPosition]
  );

  const zoneCoverageNotice = useMemo<string | null>(() => {
    const uncovered = rendering.metadata.uncoveredZones;
    if (showingSpeed || !uncovered.length) return null;
    const labels = uncovered.map(zone => `Zone ${zone.zoneNumber} (${zone.reason})`);
    return labels.length === 1
      ? `${labels[0]} : la zone reste transparente.`
      : `${labels.join(' · ')} : ces zones restent transparentes.`;
  }, [showingSpeed, rendering.metadata.uncoveredZones]);

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

  if (planLoading) {
    return <div role="status" className="max-w-300 mx-auto px-4 py-8 text-text-dim">Chargement du plan…</div>;
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
  const estimatedRgb = lutColourForRssi(rssiLut, -67);
  const estimatedColor = `rgb(${estimatedRgb[0]}, ${estimatedRgb[1]}, ${estimatedRgb[2]})`;
  const showEstimatedControls =
    !showingSpeed && rows.length > 0 && (calculation === 'regularized' || visiblePolygons.length > 0);
  const isEmpty = !dataLoading && (showingSpeed ? speedRows.length === 0 : rows.length === 0);

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
    <div className="page-shell max-w-none">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-glass-border-soft bg-glass-bg-soft p-4">
        <h1 className="page-title">Couverture</h1>
        <p className="text-text-dim text-sm">
          {plan.name} · {visibleCount} mesure{visibleCount > 1 ? 's' : ''}
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
      <aside aria-label="Réglages de la couverture" className="order-2 rounded-2xl border border-glass-border-soft bg-glass-bg-soft p-3 sm:p-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <h2 className="mb-3 text-sm font-semibold text-text">Analyser mon réseau</h2>
        {!showingSpeed && (
          <div className="space-y-3">
            <Combobox
              label="Réseau Wi-Fi"
              value={ssid}
              onChange={setSsid}
              options={ssidOptions}
              icon={<Wifi size={16} strokeWidth={1.75} />}
              searchPlaceholder="Rechercher un réseau…"
              emptyMessage="Aucun réseau ne correspond à la recherche."
            />
            <div role="group" aria-label="Bande de fréquence" className="flex h-11 overflow-hidden rounded-xl border border-glass-border-soft">
              {BAND_TABS.map((b) => (
                <button key={b.value || 'all'} type="button" aria-pressed={band === b.value} onClick={() => setBand(b.value)}
                  className={`min-w-0 flex-1 whitespace-nowrap px-1 text-xs font-medium ${band === b.value ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text'}`}>
                  {b.label}
                </button>
              ))}
            </div>
            {!ssid && !bssid && !onlyConnected && <p className="text-xs leading-relaxed text-text-dim">Tous réseaux : meilleur signal disponible. Choisis ton réseau pour évaluer sa couverture.</p>}
          </div>
        )}
        <button type="button" aria-expanded={showDisplayOptions} aria-controls="heatmap-display-options"
          onClick={() => setShowDisplayOptions((value) => !value)}
          className="mt-3 min-h-11 w-full rounded-xl border border-glass-border-soft px-3 text-sm text-text hover:bg-white/5">
          {showDisplayOptions ? 'Masquer les réglages avancés' : 'Réglages avancés'}{!showDisplayOptions && (bssid || onlyConnected) ? ' · filtre actif' : ''}
        </button>
        <div id="heatmap-display-options" hidden={!showDisplayOptions} className="mt-3 space-y-3">
          {!showingSpeed && <>
            <label className="flex min-h-11 items-center gap-2 text-sm text-text-dim">
              <input type="checkbox" checked={onlyConnected} onChange={(e) => setOnlyConnected(e.target.checked)} className="h-4 w-4 accent-accent" />
              Réseau connecté uniquement
            </label>
            <Combobox
              label="Borne / radio (BSSID)"
              value={bssid}
              onChange={setBssid}
              options={radioOptions}
              searchPlaceholder="Rechercher une radio…"
              emptyMessage="Aucune radio ne correspond à la recherche."
            />
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-xs text-text-dim">Méthode de calcul</legend>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-glass-border-soft bg-black/15 p-1" role="group" aria-label="Méthode de calcul de couverture">
                {([
                  { value: 'regularized', label: 'Régularisé', help: 'Lisse le signal et estime au-delà des points.' },
                  { value: 'hybrid', label: 'Hybride', help: 'Privilégie les mesures proches.' },
                ] as const).map((option) => {
                  const active = calculation === option.value;
                  return (
                    <button key={option.value} type="button" aria-pressed={active}
                      aria-label={`${option.label} : ${option.help}`}
                      onClick={() => setCalculation(option.value as RssiCalculation)}
                      className={`min-h-11 rounded-lg px-2 text-xs font-medium transition-colors sm:text-sm ${active ? 'border border-accent-border bg-accent-soft text-accent shadow-sm' : 'border border-transparent text-text-dim hover:bg-white/5 hover:text-text'}`}>
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 min-h-8 text-[11px] leading-relaxed text-text-dim" aria-live="polite">
                {calculation === 'regularized'
                  ? 'Carte lissée, avec estimation possible hors des points mesurés.'
                  : 'Combine les mesures proches et limite les estimations éloignées.'}
              </p>
            </fieldset>
          </>}
          <label className="block text-xs text-text-dim">Opacité {Math.round(layerOpacity * 100)} %
            <input type="range" min={0} max={100} step={5} value={Math.round(layerOpacity * 100)} onChange={(e) => setLayerOpacity(Number(e.target.value) / 100)} className="mt-2 block h-8 w-full accent-accent" />
          </label>
          {showingSpeed && <label className="block text-xs text-text-dim">Lissage {radius} px
            <input type="range" min={10} max={120} step={1} value={radius}
              onChange={(e) => { const nextRadius = Number(e.target.value); setSelectedRadius(nextRadius); setHeatmapRadius(nextRadius); }} className="mt-2 block h-8 w-full accent-accent" />
          </label>}
        </div>
        {(hasFilter || onlyConnected) && <button type="button" onClick={() => { setSsid(''); setBssid(''); setBand(''); setOnlyConnected(false); }} className="mt-2 min-h-11 w-full rounded-xl px-3 text-sm text-text-dim hover:text-text">Réinitialiser les filtres</button>}
        <a href="#/scan" className="btn-secondary mt-3 min-h-11 w-full">Ajouter des mesures</a>
        <h3 className="mb-2 mt-4 text-xs font-semibold text-text-dim">Outils de la carte</h3>
          <div id="heatmap-map-tools" aria-label="Outils de la carte" className="mb-3 flex flex-col items-stretch gap-2 rounded-xl border border-glass-border-soft bg-glass-bg-soft p-2 sm:p-3 [&>button]:w-full [&>button]:justify-start">
            <button
              type="button"
              aria-pressed={showMeasurements}
              onClick={() => setShowMeasurements((value) => !value)}
              title={showMeasurements ? 'Masquer les points de mesure noirs' : 'Afficher les points de mesure noirs'}
              className={[
                'inline-flex items-center gap-2 h-11 px-4 rounded-xl border text-sm font-medium transition-colors',
                showMeasurements
                  ? 'bg-accent-soft text-accent border-accent-border'
                  : 'text-text-dim border-glass-border-soft hover:text-text',
              ].join(' ')}
            >
              {showMeasurements ? (
                <EyeOff size={16} strokeWidth={1.75} aria-hidden />
              ) : (
                <Eye size={16} strokeWidth={1.75} aria-hidden />
              )}
              {showMeasurements ? 'Masquer les points' : 'Afficher les points'}
            </button>
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

            {polygons.length > 0 && (
              <button
                type="button"
                aria-pressed={showZones}
                onClick={toggleZones}
                disabled={drawing || !!editing}
                title={showZones ? 'Masquer les zones' : 'Afficher les zones'}
                className={[
                  'inline-flex items-center gap-2 h-11 px-4 rounded-xl border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  showZones
                    ? 'bg-accent-soft text-accent border-accent-border'
                    : 'text-text-dim border-glass-border-soft hover:text-text',
                ].join(' ')}
              >
                {showZones ? (
                  <Eye size={16} strokeWidth={1.75} aria-hidden />
                ) : (
                  <EyeOff size={16} strokeWidth={1.75} aria-hidden />
                )}
                Zones
              </button>
            )}

            {!showingSpeed && (
              <button
                type="button"
                aria-pressed={showProbe}
                onClick={() => setShowProbe((prev) => !prev)}
                disabled={drawing || !!editing}
                title={showProbe ? 'Masquer les valeurs RSSI' : 'Afficher les valeurs RSSI au survol'}
                className={[
                  'inline-flex items-center gap-2 h-11 px-4 rounded-xl border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  showProbe
                    ? 'bg-accent-soft text-accent border-accent-border'
                    : 'text-text-dim border-glass-border-soft hover:text-text',
                ].join(' ')}
              >
                <ScanLine size={16} strokeWidth={1.75} aria-hidden />
                Valeurs RSSI
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                void handleExportPng();
              }}
              disabled={
                showingSpeed ||
                !renderInput ||
                !rendering.imageUrl ||
                rendering.processing ||
                dataLoading ||
                exportingPng
              }
              title={
                showingSpeed
                  ? 'Export disponible en mode Signal'
                  : 'Exporter le plan complet avec la heatmap RSSI'
              }
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-glass-border-soft text-sm font-medium text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={16} strokeWidth={1.75} aria-hidden />
              {exportingPng ? 'Export…' : 'Exporter PNG'}
            </button>

            {displayedBssid && (
              <button
                type="button"
                aria-pressed={placingAp}
                onClick={() => setPlacingAp((prev) => !prev)}
                disabled={drawing || !!editing || polygonBusy}
                title={`Placer l’AP ${displayedBssid}`}
                className={[
                  'inline-flex items-center gap-2 h-11 px-4 rounded-xl border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  placingAp
                    ? 'bg-accent-soft text-accent border-accent-border'
                    : 'text-text-dim border-glass-border-soft hover:text-text',
                ].join(' ')}
              >
                <LocateFixed size={16} strokeWidth={1.75} aria-hidden />
                Placer l'AP
              </button>
            )}

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
                  onClick={() => handleStartEdit(selectedPolygon.id)}
                  disabled={polygonBusy}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-glass-border-soft text-sm text-text-dim hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Pencil size={16} strokeWidth={1.75} aria-hidden />
                  Modifier les sommets
                </button>
                <button
                  type="button"
                  onClick={() => handleRequestDelete(selectedPolygon.id)}
                  disabled={polygonBusy}
                  className="inline-flex items-center gap-2 h-11 px-3 rounded-xl border border-danger text-danger text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash size={16} strokeWidth={1.75} aria-hidden />
                  Supprimer la zone
                </button>
              </>
            )}

            {showZones && !drawing && !editing && !selectedPolygon && polygons.length > 0 && (
              <span className="text-[12px] text-text-dim">
                Clique sur une zone pour la sélectionner.
              </span>
            )}
          </div>
        {polygons.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-xs font-semibold text-text-dim">Zones dessinées ({polygons.length})</h3>
            <ul className="mb-3 space-y-1 rounded-xl border border-glass-border-soft bg-glass-bg-soft p-2">
              {visiblePolygons.map((polygon) => {
                const zoneNumber = polygonNumber(polygons, polygon.id);
                const isSelected = polygon.id === selectedPolygonId;
                const isPendingDelete = pendingDeleteId === polygon.id;
                return (
                  <li
                    key={polygon.id}
                    className={`flex items-center gap-1 rounded-lg px-1 ${isSelected ? 'bg-accent-soft' : ''}`}
                  >
                    {isPendingDelete ? (
                      <>
                        <span className="min-w-0 flex-1 px-1 text-xs text-text">
                          Supprimer la zone {zoneNumber ?? '?'} ?
                        </span>
                        <button
                          type="button"
                          onClick={handleConfirmDelete}
                          disabled={polygonBusy}
                          aria-label={`Confirmer la suppression de la zone ${zoneNumber ?? ''}`}
                          title="Confirmer la suppression"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-danger hover:bg-danger-soft disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Check size={16} strokeWidth={2} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelDelete}
                          disabled={polygonBusy}
                          aria-label="Annuler la suppression"
                          title="Annuler"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-dim hover:bg-white/5 hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <X size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelectZone(polygon.id)}
                          title="Sélectionner la zone sur la carte"
                          className="min-w-0 flex-1 px-1 py-2 text-left text-sm text-text hover:text-accent"
                        >
                          Zone {zoneNumber ?? '?'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(polygon.id)}
                          disabled={polygonBusy}
                          aria-label={`Modifier la zone ${zoneNumber ?? ''}`}
                          title="Modifier les sommets"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-dim hover:bg-white/5 hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Pencil size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRequestDelete(polygon.id)}
                          disabled={polygonBusy}
                          aria-label={`Supprimer la zone ${zoneNumber ?? ''}`}
                          title="Supprimer la zone"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-danger hover:bg-danger-soft disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <h3 className="mb-2 mt-4 text-xs font-semibold text-text-dim">Exporter</h3>
        <div className="rounded-xl border border-glass-border-soft bg-glass-bg-soft p-3">
          <p className="mb-2 text-xs leading-relaxed text-text-dim">Créer une archive ZIP des relevés de plusieurs radios.</p>
          {plan && <BatchExportPanel
            key={plan.id}
            onExport={handleExportZip}
            busy={batchBusy}
            progress={batchProgress}
            error={batchError}
            disabled={showingSpeed || dataLoading || !imageUrl || imageMissing || exportingPng}
            onCancel={() => batchRef.current?.abort()}
            networks={networksPlanId === plan.id ? networks : []}
            activeBssid={bssid}
          />}
        </div>
      </aside>
      <section aria-label="Résultat de couverture" className="order-1 min-w-0">
      {dataError && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-sm text-text">
          {dataError}{' '}
          <button type="button" onClick={showingSpeed ? loadSpeed : load} className="underline font-medium">
            Réessayer
          </button>
        </div>
      )}

      {(dataLoading || rendering.processing) && (
        <div role="status" aria-live="polite" className="mb-3 px-4 py-3 rounded-xl border border-glass-border-soft text-sm text-text-dim">
          {dataLoading ? 'Chargement des mesures…' : 'Préparation de la couverture…'}
        </div>
      )}
      {rendering.error && (
        <div role="alert" className="mb-3 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-sm text-text">
          {rendering.error}{' '}
          <button type="button" onClick={rendering.retry} className="underline font-medium">Réessayer</button>
        </div>
      )}
      {exportPngError && (
        <div role="alert" className="mb-3 px-4 py-3 rounded-xl border border-danger bg-danger-soft text-sm text-text">
          {exportPngError}{' '}
          <button type="button" onClick={() => setExportPngError(null)} className="underline font-medium">Fermer</button>
        </div>
      )}



      {isEmpty && !dataError ? (
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
            Prendre des mesures
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-text">Carte de couverture</h2>
            <span className="text-xs text-text-dim">Déplace et zoome sur le plan</span>
          </div>

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

          <div className="relative rounded-2xl overflow-hidden border-2 border-glass-border-soft shadow-xl">
            <button
              type="button"
              aria-label="Recentrer la carte sur le plan"
              title="Recentrer la carte sur le plan"
              onClick={handleRecenter}
              className="absolute top-3 right-3 z-10 inline-flex items-center justify-center h-11 w-11 rounded-xl text-text bg-glass-bg-soft border border-glass-border-soft backdrop-blur-ui hover:bg-glass-bg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <LocateFixed size={18} strokeWidth={1.75} aria-hidden />
            </button>
            <MapContainer
              ref={mapRef}
              center={[plan.height / 2, plan.width / 2]}
              zoom={0}
              crs={L.CRS.Simple}
              attributionControl={false}
              zoomControl={false}
              zoomSnap={0.25}
              zoomDelta={0.5}
              scrollWheelZoom
              touchZoom
              className="w-full h-[62vh] min-h-[360px] sm:h-[72vh] lg:h-[78vh] z-0"
            >
              <MapSetup
                width={plan.width}
                height={plan.height}
                registerRecenter={registerRecenter}
              />
              <ZoomControl />
              <ApPlacementClickCatcher
                active={placingAp && !drawing && !editing}
                onPlace={handlePlaceAp}
              />
              <ImageOverlay url={imageUrl} bounds={bounds} />
              <CoverageOverlay imageUrl={rendering.imageUrl} bounds={bounds} opacity={layerOpacity} />
              {!showingSpeed && (
                <RssiProbeLayer
                  calculation={calculation}
                  sampleAt={rendering.sampleAt}
                  lut={rssiLut}
                  enabled={!rendering.processing && !dataLoading && showProbe && !drawing && !editing && !placingAp}
                  showEstimated={showEstimated}
                />
              )}
              {showMeasurements && !dataLoading && (showingSpeed
                ? speedRows.map((row) => ({ id: row.scan_point_id, x: row.x, y: row.y, value: row.speed_bps / 1_000_000 }))
                : bestPerPoint.map((row) => ({ id: row.scan_point_id, x: row.x, y: row.y, value: row.rssi }))
              ).map((point) => (
                <CircleMarker key={`measurement-${point.id}`}
                  center={dataToLatLng(point.x, point.y, plan.width, plan.height)} radius={4}
                  bubblingMouseEvents={false}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: '#0d1319', fillOpacity: 1 }}>
                  <Tooltip direction="top">Mesure · {formatValue(point.value)}</Tooltip>
                </CircleMarker>
              ))}
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
              {selectedApPositions.length > 0 && (
                <ApMarkersLayer
                  positions={selectedApPositions}
                  width={plan.width}
                  height={plan.height}
                  draggable={placingAp}
                  onDragEnd={handleApDragEnd}
                />
              )}
              <PolygonEditorLayer
                width={plan.width}
                height={plan.height}
                drawing={drawing}
                activeVertices={activeVertices}
                polygons={showZones ? visiblePolygons : []}
                selectedPolygonId={selectedPolygonId}
                editing={editing}
                onAddVertex={handleAddVertex}
                onFinish={handleFinishPolygon}
                onSelectPolygon={handleSelectPolygon}
                onMoveVertex={handleMoveVertex}
              />
            </MapContainer>
          </div>

          <p className="mt-3 rounded-xl border border-glass-border-soft px-3 py-2 text-xs leading-relaxed text-text-dim">
            Les points indiquent les mesures. Les couleurs entre les points sont estimées.
            {!showingSpeed && calculation === 'regularized' && ' Les hachures signalent une estimation au-delà des points mesurés.'}
            {' '}Une zone sans couleur ne signifie pas un signal faible : elle peut manquer de mesures ou être exclue de l’affichage. Ajoute des mesures pour la vérifier.
          </p>

          {/* Légende : barre segmentée par seuil + meilleur relevé, comme
              le bandeau « Primary Coverage » d'UniFi. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {showingSpeed ? (
              <>
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
              </>
            ) : (
              <>
                <div className="min-w-64 flex-1 max-w-120" aria-label="Échelle du signal de −100 à −40 dBm">
                  <div className="h-3 rounded-full border border-white/10"
                    style={{ backgroundImage: legendGradient, opacity: layerOpacity }} aria-hidden />
                  <div className="relative mt-1 h-5 text-[10px] text-text-dim font-mono" aria-hidden>
                    {[RSSI_MIN, -85, -75, -67, -55, RSSI_MAX].map((value, index, values) => (
                      <span key={value} className="absolute"
                        style={{ left: `${rssiToPosition(value) * 100}%`, transform: index === 0 ? undefined : index === values.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
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
                  style={{ backgroundColor: showingSpeed ? bandDef.color : (() => {
                    const [r, g, b] = lutColourForRssi(rssiLut, Number.isFinite(bandDef.min) ? bandDef.min : RSSI_MIN);
                    return `rgb(${r}, ${g}, ${b})`;
                  })() }}
                />
                {activeLabels[bandKey(bandDef.min)]}
              </span>
            ))}
            {showEstimatedControls && (
              <>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-text-dim font-mono">
                  <span
                    className="inline-block w-3 h-3 rounded-full border border-white/20"
                    style={{
                      backgroundColor: estimatedColor,
                      backgroundImage: calculation === 'regularized' ? 'repeating-linear-gradient(135deg, transparent 0 3px, #ffffff99 3px 4px)' : undefined,
                      opacity: calculation === 'regularized' ? .8 : .45,
                    }}
                    aria-hidden
                  />
                  {calculation === 'regularized' ? 'extrapolation · trame' : 'estimé · transparence variable'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showEstimated}
                  onClick={() => setShowEstimated((prev) => !prev)}
                  className="inline-flex items-center gap-2 text-[12px] text-text-dim font-mono rounded-md cursor-pointer select-none transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <span
                    className={[
                      'relative inline-flex h-4 w-7 items-center rounded-full border transition-colors',
                      showEstimated
                        ? 'bg-accent-soft border-accent-border'
                        : 'bg-white/5 border-glass-border-soft',
                    ].join(' ')}
                    aria-hidden
                  >
                    <span
                      className={[
                        'inline-block h-2.5 w-2.5 rounded-full transition-transform',
                        showEstimated
                          ? 'translate-x-[14px] bg-accent'
                          : 'translate-x-[3px] bg-text-dim',
                      ].join(' ')}
                    />
                  </span>
                  <span className={showEstimated ? 'text-text' : undefined}>
                    Afficher les zones estimées
                  </span>
                </button>
              </>
            )}
          </div>



          {/* Panneau de synthèse : l'état du parc en un coup d'œil. */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-xl border border-glass-border-soft bg-glass-bg-soft px-3 py-2.5">
              <div className="text-[12px] text-text-dim">Points mesurés</div>
              <div className="text-text text-[15px] font-medium font-mono">{stats.count}</div>
            </div>
            <div className="rounded-xl border border-glass-border-soft bg-glass-bg-soft px-3 py-2.5">
              <div className="text-[12px] text-text-dim">Moyen</div>
              <div className="text-text text-[15px] font-medium font-mono">
                {stats.avg !== null ? formatValue(stats.avg) : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-glass-border-soft bg-glass-bg-soft px-3 py-2.5">
              <div className="text-[12px] text-text-dim">Plus faible</div>
              <div className="text-text text-[15px] font-medium font-mono">
                {stats.worst !== null ? formatValue(stats.worst) : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-glass-border-soft bg-glass-bg-soft px-3 py-2.5">
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
      </section>
      </div>
    </div>
  );
}

