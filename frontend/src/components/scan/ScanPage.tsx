import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { usePlanImage } from '../../hooks/usePlanImage';
import { useScanStore } from '../../hooks/useScanStore';
import { loadProject } from '../../lib/storage';
import { latlngToData, dataToLatLng, clampCoord } from '../../lib/coords';
import { formatPercent } from '../../lib/format';
import { ScanMap } from './ScanMap';
import { InfoChip } from './InfoChip';
import { ActionPanel } from './ActionPanel';
import { EmptyPlanState } from './EmptyPlanState';
import { DoneDialog } from './DoneDialog';
import type { AccessPoint } from '../../types/project';

export function ScanPage() {
  const { plan, imageUrl, loading } = usePlanImage();
  const accessPoints = useMemo<AccessPoint[]>(
    () => loadProject()?.accessPoints ?? [],
    []
  );

  const { scanPoints, addScan, removeLast } = useScanStore(
    plan?.name ?? null,
    plan
      ? {
          width: plan.width,
          height: plan.height,
          fileName: plan.fileName,
          sizeBytes: plan.sizeBytes,
        }
      : null,
    accessPoints
  );

  const [pendingLatLng, setPendingLatLng] = useState<L.LatLng | null>(null);
  const [scanConfirmed, setScanConfirmed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const fitRef = useRef<(() => void) | null>(null);

  const registerFit = useCallback((fn: () => void) => {
    fitRef.current = fn;
  }, []);

  /* Re-fit à chaque retour sur #/scan */
  useEffect(() => {
    const onHash = () => {
      const isScan = location.hash === '#/scan' || location.hash === '';
      if (isScan) requestAnimationFrame(() => fitRef.current?.());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleMapClick = useCallback(
    (latlng: L.LatLng) => {
      if (!plan) return;
      const clamped = clampCoord(latlngToData(latlng, plan.width, plan.height));
      const [lat, lng] = dataToLatLng(clamped.x, clamped.y, plan.width, plan.height);
      setPendingLatLng(L.latLng(lat, lng));
    },
    [plan]
  );

  const handlePinDragEnd = useCallback(
    (latlng: L.LatLng) => {
      if (!plan) return;
      const clamped = clampCoord(latlngToData(latlng, plan.width, plan.height));
      const [lat, lng] = dataToLatLng(clamped.x, clamped.y, plan.width, plan.height);
      setPendingLatLng(L.latLng(lat, lng));
    },
    [plan]
  );

  const handleScan = useCallback(() => {
    if (!plan || !pendingLatLng) return;
    const data = clampCoord(latlngToData(pendingLatLng, plan.width, plan.height));
    addScan(data.x, data.y);
    setPendingLatLng(null);
    if (navigator.vibrate) navigator.vibrate(30);

    setScanConfirmed(true);
    window.setTimeout(() => setScanConfirmed(false), 600);
  }, [plan, pendingLatLng, addScan]);

  const handleUndo = useCallback(() => {
    removeLast();
  }, [removeLast]);

  const handleDone = useCallback(() => {
    if (scanPoints.length === 0) return;
    setDialogOpen(true);
  }, [scanPoints.length]);

  const handleImport = useCallback(() => {
    location.hash = '#/upload';
  }, []);

  const handleSurveys = useCallback(() => {
    setDialogOpen(false);
    location.hash = '#/surveys';
  }, []);

  const hint = useMemo(() => {
    if (!plan) return '';
    if (pendingLatLng) {
      const data = latlngToData(pendingLatLng, plan.width, plan.height);
      return `Position définie · x ${formatPercent(data.x)} · y ${formatPercent(data.y)}`;
    }
    return 'Touche le plan à ton emplacement, puis appuie sur Scan.';
  }, [plan, pendingLatLng]);

  if (loading) {
    return <div className="fixed inset-0 bg-bg" />;
  }

  if (!plan || !imageUrl) {
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

      <InfoChip planName={plan.name} pointCount={scanPoints.length} />

      <ActionPanel
        hint={hint}
        hasPin={!!pendingLatLng}
        canScan={!!pendingLatLng}
        canUndo={scanPoints.length > 0}
        canDone={scanPoints.length > 0}
        scanConfirmed={scanConfirmed}
        onScan={handleScan}
        onUndo={handleUndo}
        onDone={handleDone}
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