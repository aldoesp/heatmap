import type { HeatmapRenderInput, HeatmapRenderResult } from './heatmapRender.js';
import type { HybridSample } from './rssiHybridField.js';

export type HeatmapWorkerRequest =
  | { type: 'build'; input: HeatmapRenderInput }
  | { type: 'prepare'; input: HeatmapRenderInput }
  | { type: 'probe'; id: number; x: number; y: number }
  | { type: 'export'; id: number; input: HeatmapRenderInput };
export type HeatmapWorkerResponse =
  | { type: 'ready'; result: HeatmapRenderResult }
  | { type: 'sample'; id: number; sample: HybridSample }
  | { type: 'export'; id: number; result: HeatmapRenderResult }
  | { type: 'export-error'; id: number; message: string }
  | { type: 'error'; message: string };

export interface HeatmapWorkerPort {
  postMessage(message: HeatmapWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: HeatmapWorkerResponse }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
}

const noData = (): HybridSample => ({ status: 'NO_DATA', rssi: null });

export function createHeatmapWorkerPort(): HeatmapWorkerPort {
  const worker = new Worker(new URL('./heatmap.worker.ts', import.meta.url), { type: 'module' });
  const port: HeatmapWorkerPort = {
    postMessage: message => worker.postMessage(message), terminate: () => worker.terminate(),
    onmessage: null, onerror: null,
  };
  worker.onmessage = event => port.onmessage?.({ data: event.data });
  worker.onerror = event => port.onerror?.({ message: event.message });
  return port;
}

/** One session per input: disposing terminates expensive work and settles pending probes. */
export function createHeatmapSession(
  port: HeatmapWorkerPort,
  input: HeatmapRenderInput,
  onReady: (result: HeatmapRenderResult) => void,
  onError: (message: string) => void,
  lazyProbe = false,
) {
  let closed = false, ready = lazyProbe, needsPreparation = lazyProbe, nextId = 0;
  const pending = new Map<number, (sample: HybridSample) => void>();
  const pendingExports = new Map<
    number,
    { resolve: (result: HeatmapRenderResult) => void; reject: (error: Error) => void }
  >();
  const dispose = () => {
    if (closed) return;
    closed = true;
    port.onmessage = null; port.onerror = null;
    port.terminate();
    for (const resolve of pending.values()) resolve(noData());
    pending.clear();
    for (const { reject } of pendingExports.values()) {
      reject(new Error('Export interrompu.'));
    }
    pendingExports.clear();
  };
  port.onmessage = ({ data }) => {
    if (closed) return;
    if (data.type === 'ready') { ready = true; onReady(data.result); }
    if (data.type === 'sample') { pending.get(data.id)?.(data.sample); pending.delete(data.id); }
    if (data.type === 'export') {
      pendingExports.get(data.id)?.resolve(data.result);
      pendingExports.delete(data.id);
    }
    if (data.type === 'export-error') {
      pendingExports.get(data.id)?.reject(new Error(data.message));
      pendingExports.delete(data.id);
    }
    if (data.type === 'error') { dispose(); onError(data.message); }
  };
  port.onerror = ({ message }) => { if (!closed) { dispose(); onError(message || 'Calcul de la couverture interrompu.'); } };
  if (!lazyProbe) {
    try { port.postMessage({ type: 'build', input }); }
    catch (error) { dispose(); throw error; }
  }
  return {
    dispose,
    sample(x: number, y: number): Promise<HybridSample> {
      if (closed || !ready) return Promise.resolve(noData());
      return new Promise(resolve => {
        const id = ++nextId;
        pending.set(id, resolve);
        try {
          if (needsPreparation) {
            port.postMessage({ type: 'prepare', input });
            needsPreparation = false;
          }
          port.postMessage({ type: 'probe', id, x, y });
        }
        catch { pending.delete(id); resolve(noData()); }
      });
    },
    renderForExport(input: HeatmapRenderInput): Promise<HeatmapRenderResult> {
      if (closed) {
        return Promise.reject(new Error('Calcul de la couverture indisponible.'));
      }
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pendingExports.set(id, { resolve, reject });
        try { port.postMessage({ type: 'export', id, input }); }
        catch (error) {
          pendingExports.delete(id);
          reject(error instanceof Error ? error : new Error('Export indisponible.'));
        }
      });
    },
  };
}
