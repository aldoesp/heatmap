import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createHeatmapSession, type HeatmapWorkerPort } from '../lib/heatmapWorkerClient';
import type { HeatmapImage, HeatmapMetadata, HeatmapRenderInput } from '../lib/heatmapRender';

function imageUrl(image: HeatmapImage): Promise<string | null> {
  if (!image.coveredPixels) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Impossible de dessiner la couverture.'));
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  if (image.contours.length) {
    context.strokeStyle = 'rgba(255,255,255,0.7)'; context.lineWidth = .6; context.beginPath();
    for (const line of image.contours) { context.moveTo(...line.a); context.lineTo(...line.b); }
    context.stroke();
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('Impossible de préparer la couverture.')), 'image/png'));
}

const EMPTY_METADATA: HeatmapMetadata = { bssids: [], uncoveredZones: [] };

export function useHeatmapRender(input: HeatmapRenderInput | null) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => input ? { input, attempt } : null, [input, attempt]);
  const active = useRef<{ request: typeof request; session: ReturnType<typeof createHeatmapSession> } | null>(null);
  const [result, setResult] = useState<{ request: typeof request; url: string | null; metadata: HeatmapMetadata; error: string | null } | null>(null);

  useEffect(() => {
    if (!request) return;
    let alive = true, url: string | null = null;
    let session: ReturnType<typeof createHeatmapSession> | undefined;
    const fail = (message: string) => {
      if (alive) setResult({ request, url: null, metadata: EMPTY_METADATA, error: message });
    };
    try {
      const worker = new Worker(new URL('../lib/heatmap.worker.ts', import.meta.url), { type: 'module' });
      const port: HeatmapWorkerPort = {
        postMessage: message => worker.postMessage(message), terminate: () => worker.terminate(),
        onmessage: null, onerror: null,
      };
      worker.onmessage = event => port.onmessage?.({ data: event.data });
      worker.onerror = event => port.onerror?.({ message: event.message });
      session = createHeatmapSession(port, request.input, result => {
        void imageUrl(result.image).then(nextUrl => {
          if (!alive) { if (nextUrl) URL.revokeObjectURL(nextUrl); return; }
          if (url) URL.revokeObjectURL(url);
          url = nextUrl;
          console.info(`[heatmap] calcul en arrière-plan ${result.durationMs.toFixed(1)} ms`);
          setResult({ request, url, metadata: result.metadata, error: null });
        }).catch(error => fail(error instanceof Error ? error.message : 'Impossible de préparer la couverture.'));
      }, fail);
      active.current = { request, session };
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Le calcul en arrière-plan est indisponible.');
    }
    return () => {
      alive = false; session?.dispose();
      if (active.current?.request === request) active.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [request]);

  const sampleAt = useCallback((x: number, y: number) => {
    const current = active.current;
    return current?.request === request
      ? current.session.sample(x, y)
      : Promise.resolve({ status: 'NO_DATA' as const, rssi: null });
  }, [request]);
  const renderForExport = useCallback((input: HeatmapRenderInput) => {
    const current = active.current;
    return current?.request === request
      ? current.session.renderForExport(input)
      : Promise.reject(new Error('Calcul de la couverture indisponible.'));
  }, [request]);
  const current = result?.request === request ? result : null;
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { imageUrl: current?.url ?? null, metadata: current?.metadata ?? EMPTY_METADATA,
    processing: request !== null && current === null, error: current?.error ?? null, sampleAt,
    renderForExport, retry };
}
