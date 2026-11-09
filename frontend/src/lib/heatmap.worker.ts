import { createHeatmapRender } from './heatmapRender.js';
import type { HeatmapWorkerRequest, HeatmapWorkerResponse } from './heatmapWorkerClient.js';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HeatmapWorkerRequest>) => void) | null;
  postMessage(message: HeatmapWorkerResponse, transfer?: Transferable[]): void;
};
let render: ReturnType<typeof createHeatmapRender> | null = null;
scope.onmessage = ({ data }) => {
  if (data.type === 'build') {
    try {
      render = createHeatmapRender(data.input);
      const { image, metadata, durationMs } = render;
      scope.postMessage({ type: 'ready', result: { image, metadata, durationMs } }, [image.data.buffer]);
    } catch (error) {
      render = null;
      scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Impossible de calculer la couverture.' });
    }
    return;
  }
  if (data.type === 'export') {
    try {
      const { image, metadata, durationMs } = createHeatmapRender(data.input);
      scope.postMessage({ type: 'export', id: data.id, result: { image, metadata, durationMs } }, [image.data.buffer]);
    } catch (error) {
      scope.postMessage({
        type: 'export-error',
        id: data.id,
        message: error instanceof Error ? error.message : 'Impossible de générer le raster d’export.',
      });
    }
    return;
  }
  scope.postMessage({ type: 'sample', id: data.id, sample: render?.sample(data.x, data.y) ?? { status: 'NO_DATA', rssi: null } });
};
