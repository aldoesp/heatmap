import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { usePlanImage } from '../../hooks/usePlanImage';
import { useScanStore } from '../../hooks/useScanStore';
import { listAccessPoints, getStatus } from '../../lib/api';
import { latlngToData, dataToLatLng, clampCoord } from '../../lib/coords';
import { formatPercent } from '../../lib/format';
import { ScanMap } from './ScanMap';
import { InfoChip } from './InfoChip';
import { ActionPanel } from './ActionPanel';
import { EmptyPlanState } from './EmptyPlanState';
import { DoneDialog } from './DoneDialog';
import { ScanConfirmDialog } from './ScanConfirmDialog';
import type { AccessPoint } from '../../types/project';

export function ScanPage() {
  const { plan, imageUrl, loading, imageMissing, error: planError } = usePlanImage();
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);

  const {
    scanPoints,
    loading: pointsLoading,
    scanning,
    error: scanError,
    lastResult,
    addScan,
    removeLast,
    dismissError,
  } = useScanStore(plan?.id ?? null);

  const [pendingLatLng, setPendingLatLng] = useState<L.LatLng | null>(null);
  const [scanConfirmed, setScanConfirmed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<'live' | 'test' | null>(null);
  // Position du dernier scan, pour le dialogue de confirmation
  const [lastCoords, setLastCoords] = useState<{ x: number; y: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!plan) return;
    let alive = true;
    listAccessPoints(plan.id)
      .then((aps) => {
        if (alive) setAccessPoints(aps);
      })
      .catch(() => {
        /* APs indisponibles : la carte reste utilisable sans eux */
      });
    return () => {
      alive = false;
    };
  }, [plan]);

  const registerFit = useCallback((fn: () => void) => {
    fitRef.current = fn;
  }, []);

  /* Mode de scan (bouton Test/Réel des Paramètres) : relecture à chaque retour */
  useEffect(() => {
    let alive = true;
    const fetchMode = () => {
      getStatus()
        .then((st) => {
          if (alive) setMode(st.scan_mode);
        })
        .catch(() => {
          /* badge masqué si serveur injoignable */
        });
    };
    fetchMode();
    const onHash = () => {
      const isScan = location.hash === '#/scan' || location.hash === '';
      if (isScan) {
        fetchMode();
        requestAnimationFrame(() => fitRef.current?.());
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      alive = false;
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const handleMapClick = useCallback(
    (latlng: L.LatLng) => {
      if (!plan || scanning || confirmOpen) return;
      dismissError();
      const clamped = clampCoord(latlngToData(latlng, plan.width, plan.height));
      const [lat, lng] = dataToLatLng(clamped.x, clamped.y, plan.width, plan.height);
      setPendingLatLng(L.latLng(lat, lng));
    },
    [plan, scanning, confirmOpen, dismissError]
  );

  const handlePinDragEnd = useCallback(
    (latlng: L.LatLng) => {
      if (!plan || scanning || confirmOpen) return;
      const clamped = clampCoord(latlngToData(latlng, plan.width, plan.height));
      const [lat, lng] = dataToLatLng(clamped.x, clamped.y, plan.width, plan.height);
      setPendingLatLng(L.latLng(lat, lng));
    },
    [plan, scanning, confirmOpen]
  );

  const handleScan = useCallback(async () => {
    if (!plan || !pendingLatLng || scanning) return;
    const data = clampCoord(latlngToData(pendingLatLng, plan.width, plan.height));
    const result = await addScan(data.x, data.y);
    if (result) {
      setPendingLatLng(null);
      setLastCoords({ x: data.x, y: data.y });
      setConfirmOpen(true);
      setScanConfirmed(true);
      window.setTimeout(() => setScanConfirmed(false), 1200);
    }
  }, [plan, pendingLatLng, scanning, addScan]);

  const handleKeepScan = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const handleDiscardScan = useCallback(async () => {
    // Le point venant d'être créé est toujours le dernier (verrou scanning).
    const removed = await removeLast();
    if (removed) setConfirmOpen(false);
    // En cas d'échec, le dialogue reste ouvert avec l'erreur affichée.
  }, [removeLast]);

  const handleUndo = useCallback(() => {
    removeLast();
  }, [removeLast]);

  const handleRecenter = useCallback(() => {
    fitRef.current?.();
  }, []);

  const handleDone = useCallback(() => {
    if (scanPoints.length === 0) return;
    setDialogOpen(true);
  }, [scanPoints.length]);

  const handleImport = useCallback(() => {
    location.hash = '#/upload?test=1';
  }, []);

  const handleSurveys = useCallback(() => {
    setDialogOpen(false);
    location.hash = '#/releves';
  }, []);

  const hint = useMemo(() => {
    if (scanning) return 'Scan en cours… ne bouge pas.';
    if (scanError) return scanError;
    if (lastResult) {
      return `${lastResult.count} réseau${lastResult.count > 1 ? 'x' : ''} enregistré${lastResult.count > 1 ? 's' : ''} (${lastResult.mode === 'test' ? 'mode test' : 'mesure réelle'}).`;
    }
    if (!plan) return '';
    if (pendingLatLng) {
      const data = latlngToData(pendingLatLng, plan.width, plan.height);
      return `Position définie · x ${formatPercent(data.x)} · y ${formatPercent(data.y)}`;
    }
    return 'Touche le plan à ton emplacement, puis appuie sur Scan.';
  }, [plan, pendingLatLng, scanning, scanError, lastResult]);

  if (loading || (plan && pointsLoading)) {
    return <div className="fixed inset-0 bg-bg" />;
  }

  if (planError && !plan) {
    return (
      <div className="max-w-150 mx-auto px-4 pt-16 pb-28 md:pb-16 text-center">
        <p className="text-text text-[15px] mb-4">{planError}</p>
        <button
          type="button"
          onClick={handleImport}
          className="inline-flex items-center h-12 px-5 rounded-[14px] bg-accent text-bg font-medium text-[15px]"
        >
          Importer un plan
        </button>
      </div>
    );
  }

  if (!plan || !imageUrl) {
    if (imageMissing && plan) {
      return (
        <div className="max-w-150 mx-auto px-4 pt-16 pb-28 md:pb-16 text-center">
          <p className="text-text text-[15px] mb-2">
            L’image du plan « {plan.name} » est introuvable sur le serveur.
          </p>
          <p className="text-text-dim text-sm mb-4">
            Les relevés restent conservés. Réimporte le plan ou contacte l’administrateur.
          </p>
          <button
            type="button"
            onClick={handleImport}
            className="inline-flex items-center h-12 px-5 rounded-[14px] bg-accent text-bg font-medium text-[15px]"
          >
            Importer un plan
          </button>
        </div>
      );
    }
    return <EmptyPlanState onImport={handleImport} />;
  }

  return (
    <>
      <ScanMap
        imageUrl={imageUrl}
        width={plan.width}
        height={plan.height}
        accessPoints={accessPoints}
        scanPoints={scanPoints}
        pendingLatLng={pendingLatLng}
        onMapClick={handleMapClick}
        onPinDragEnd={handlePinDragEnd}
        registerFit={registerFit}
      />

      <InfoChip planName={plan.name} pointCount={scanPoints.length} mode={mode} />

      <ActionPanel
        hint={hint}
        hasPin={!!pendingLatLng}
        canScan={!!pendingLatLng && !scanning && !confirmOpen}
        canUndo={scanPoints.length > 0 && !scanning && !confirmOpen}
        canDone={scanPoints.length > 0 && !scanning && !confirmOpen}
        scanConfirmed={scanConfirmed}
        onScan={handleScan}
        onUndo={handleUndo}
        onDone={handleDone}
        onRecenter={handleRecenter}
      />

      <ScanConfirmDialog
        open={confirmOpen && !!lastResult}
        result={lastResult}
        x={lastCoords?.x ?? 0}
        y={lastCoords?.y ?? 0}
        discarding={scanning}
        error={scanError}
        onKeep={handleKeepScan}
        onDiscard={handleDiscardScan}
      />

      <DoneDialog
        open={dialogOpen}
        planName={plan.name}
        pointCount={scanPoints.length}
        onContinue={() => setDialogOpen(false)}
        onSurveys={handleSurveys}
      />
    </>
  );
}
