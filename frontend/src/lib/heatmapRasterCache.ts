import { heatmapRasterSize, type HeatmapRenderInput, type HeatmapRenderResult } from './heatmapRender.js';
import { createHeatmapSession, type HeatmapWorkerPort } from './heatmapWorkerClient.js';
import type { HybridSample } from './rssiHybridField.js';

const DEFAULT_MAX_ENTRIES = 30;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export function heatmapRasterKey(input: HeatmapRenderInput): string {
  const { plan, metric, polygons } = input;
  const { width, height } = heatmapRasterSize(input);
  const common = [metric, plan.id, plan.width, plan.height, width, height,
    polygons.map(({ id, vertices }) => [id, vertices.map(({ x, y }) => [x, y])])];
  const zonedHybrid = input.calculation === 'hybrid' && polygons.length > 0;
  const dependencies = metric === 'speed'
    ? [
      input.points.map(({ x, y, value }) => [x, y, value]),
      input.radius, input.bands.map(({ min, color }) => [min, color]),
    ]
    : [
      input.calculation,
      input.measurements.map(row => [
        row.plan_id, row.survey_id, row.scan_point_id, row.x, row.y,
        row.bssid, row.band, row.frequency_mhz, row.rssi,
      ]),
      Array.from(input.lut),
      input.calculation === 'regularized' || zonedHybrid ? input.showEstimated : null,
      zonedHybrid ? input.apPositions.map(({ bssid, x, y }) => [bssid, x, y]) : null,
      zonedHybrid ? input.accessPoints.map(({ x, y, bssids }) => [x, y, bssids]) : null,
    ];
  // L'ordre des listes compte pour les égalités et les opérations flottantes.
  // JSON convertirait les nombres non finis en null et confondrait -0 avec 0.
  return JSON.stringify([common, dependencies], (_key, value: unknown) => {
    if (typeof value !== 'number') return value;
    if (Object.is(value, -0)) return '-0';
    return Number.isFinite(value) ? value : String(value);
  });
}

function estimatedBytes(key: string, { image, metadata }: HeatmapRenderResult): number {
  let total = 512 + key.length * 2 + image.data.buffer.byteLength + image.contours.length * 192;
  for (const bssid of metadata.bssids) total += 32 + bssid.length * 2;
  for (const { id, reason } of metadata.uncoveredZones) total += 96 + (id.length + reason.length) * 2;
  return total;
}

function limit(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

const noData = (): HybridSample => ({ status: 'NO_DATA', rssi: null });
const interrupted = () => new Error('Calcul de la couverture interrompu.');
type Session = ReturnType<typeof createHeatmapSession>;
interface DisplayJob {
  pending: Promise<HeatmapRenderResult> | null;
  clients: number;
  session?: Session;
  errors: Set<(message: string) => void>;
  cancel(): void;
}

/** Cache sur le thread principal, où arrive le buffer transféré par le worker. */
export function createHeatmapDisplayCache(
  createPort: () => HeatmapWorkerPort,
  options: { maxEntries?: number; maxBytes?: number } = {},
) {
  const maxEntries = limit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxBytes = limit(options.maxBytes, DEFAULT_MAX_BYTES);
  const entries = new Map<string, { result: HeatmapRenderResult; bytes: number }>();
  const jobs = new Map<string, DisplayJob>();
  let hits = 0, misses = 0, evictions = 0, coalesced = 0, bytes = 0;

  function store(key: string, result: HeatmapRenderResult) {
    const { width, height, data } = result.image;
    if (!data.byteLength || data.byteLength !== width * height * 4) {
      throw new Error('Buffer de couverture invalide.');
    }
    const size = estimatedBytes(key, result);
    if (!maxEntries || size > maxBytes) return;
    for (const [oldest, entry] of entries) {
      if (entries.size < maxEntries && bytes + size <= maxBytes) break;
      entries.delete(oldest);
      bytes -= entry.bytes;
      evictions++;
    }
    entries.set(key, { result, bytes: size });
    bytes += size;
  }

  function start(key: string, input: HeatmapRenderInput) {
    let resolve!: (result: HeatmapRenderResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<HeatmapRenderResult>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const job: DisplayJob = {
      pending: promise, clients: 0, errors: new Set(),
      cancel() {
        if (jobs.get(key) === job) {
          jobs.delete(key);
          job.pending = null;
          reject(interrupted());
        }
        job.session?.dispose();
      },
    };
    jobs.set(key, job);
    const fail = (message: string) => {
      if (jobs.get(key) === job) {
        jobs.delete(key);
        job.pending = null;
        reject(new Error(message));
      } else {
        for (const notify of job.errors) notify(message);
      }
    };
    try {
      // postMessage capture l'entrée dans le même tour que le calcul de sa clé.
      job.session = createHeatmapSession(createPort(), input, result => {
        if (jobs.get(key) !== job) return;
        try {
          store(key, result);
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Raster de couverture invalide.');
          job.session?.dispose();
          return;
        }
        jobs.delete(key);
        job.pending = null;
        resolve(result);
      }, fail);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Le calcul en arrière-plan est indisponible.');
    }
    return { job, promise };
  }

  return {
    stats() {
      return { hits, misses, evictions, coalesced, bytes, entries: entries.size };
    },
    acquire(input: HeatmapRenderInput, onError: (message: string) => void = () => {}) {
      const key = heatmapRasterKey(input);
      const cached = entries.get(key);
      let job: DisplayJob | undefined;
      let source: Promise<HeatmapRenderResult>;
      const notify = (message: string) => onError(message);
      if (cached) {
        hits++;
        entries.delete(key);
        entries.set(key, cached);
        source = Promise.resolve(cached.result);
      } else {
        misses++;
        job = jobs.get(key);
        if (job) {
          coalesced++;
          source = job.pending!;
        } else {
          ({ job, promise: source } = start(key, input));
        }
        job.clients++;
        job.errors.add(notify);
      }

      let disposed = false;
      let lazy: Session | undefined;
      let isolatedExport: Session | undefined;
      const cancellations = new Set<() => void>();
      function whileActive<T>(
        operation: Promise<T>,
        cancel: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
      ): Promise<T> {
        return new Promise((resolve, reject) => {
          const onCancel = () => cancel(resolve, reject);
          cancellations.add(onCancel);
          operation.then(value => {
            cancellations.delete(onCancel);
            if (disposed) onCancel();
            else resolve(value);
          }, error => {
            cancellations.delete(onCancel);
            if (disposed) onCancel();
            else reject(error);
          });
          if (disposed) {
            cancellations.delete(onCancel);
            onCancel();
          }
        });
      }
      function session() {
        if (job) return job.session;
        lazy ??= createHeatmapSession(createPort(), input, () => {}, onError, true);
        return lazy;
      }

      // Chaque consommateur reçoit sa propre copie. Même un transfert ultérieur
      // par un consommateur laisse intact le buffer possédé par le cache.
      const result = whileActive(source.then(value => {
        if (disposed) throw interrupted();
        return structuredClone(value);
      }), (_, reject) => reject(interrupted()));
      return {
        result,
        sample(x: number, y: number): Promise<HybridSample> {
          if (disposed || input.metric === 'speed') return Promise.resolve(noData());
          try {
            const operation = session()?.sample(x, y) ?? Promise.resolve(noData());
            return whileActive(operation, resolve => resolve(noData()));
          } catch (error) {
            onError(error instanceof Error ? error.message : 'La sonde de couverture est indisponible.');
            return Promise.resolve(noData());
          }
        },
        renderForExport(exportInput: HeatmapRenderInput): Promise<HeatmapRenderResult> {
          const exportError = () => new Error('Export interrompu.');
          if (disposed) return Promise.reject(exportError());
          const operation = (job?.pending ?? Promise.resolve()).then(() => {
            if (disposed) throw exportError();
            // Une exportation propre à un consommateur doit rester annulable
            // même si d'autres consommateurs utilisent le worker d'affichage.
            const worker = job && job.clients > 1
              ? (isolatedExport ??= createHeatmapSession(createPort(), input, () => {}, () => {}, true))
              : session();
            if (!worker) throw new Error('Calcul de la couverture indisponible.');
            return worker.renderForExport(exportInput);
          });
          return whileActive(operation, (_, reject) => reject(exportError()));
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const cancel of cancellations) cancel();
          cancellations.clear();
          lazy?.dispose();
          isolatedExport?.dispose();
          if (job) {
            job.errors.delete(notify);
            if (--job.clients === 0) job.cancel();
          }
        },
      };
    },
  };
}
