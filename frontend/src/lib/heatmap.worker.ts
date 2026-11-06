import { createHeatmapRender } from './heatmapRender.js';
import type { HeatmapWorkerRequest, HeatmapWorkerResponse } from './heatmapWorkerClient.js';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HeatmapWorkerRequest>) => void) | null;
  postMessage(message: HeatmapWorkerResponse, transfer?: Transferable[]): void;
};
let render: ReturnType<typeof createHeatmapRender> | null = null;
scope.onmessage = ({ data }) => {
  try {
    if (data.type === 'build') {
      render = createHeatmapRender(data.input);
      const { image, metadata, durationMs } = render;
      scope.postMessage({ type: 'ready', result: { image, metadata, durationMs } }, [image.data.buffer]);
    } else {
      scope.postMessage({ type: 'sample', id: data.id, sample: render?.sample(data.x, data.y) ?? { status: 'NO_DATA', rssi: null } });
    }
  } catch (error) {
    render = null;
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Impossible de calculer la couverture.' });
  }
};
