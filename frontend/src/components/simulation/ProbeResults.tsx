import { colorForDbm } from '../../lib/wifiHeatmap';
import { FREQUENCY_OPTIONS } from '../../lib/defaults';
import type { ColorStop, Point, RadioParams, SignalSample } from '../../types/wifi';

interface ProbeResultsProps {
  ap: Point;
  probe: Point | null;
  sample: SignalSample | null;
  radio: RadioParams;
  colorStops: readonly ColorStop[];
}

const fmt = (v: number, digits = 2): string => v.toFixed(digits).replace('.', ',');

export function ProbeResults({ ap, probe, sample, radio, colorStops }: ProbeResultsProps) {
  const freqLabel =
    FREQUENCY_OPTIONS.find((f) => f.value === radio.frequencyMHz)?.label ??
    `${radio.frequencyMHz} MHz`;
  const modelLabel =
    radio.model === 'fspl'
      ? 'FSPL (espace libre)'
      : `Log-distance (n = ${fmt(radio.pathLossExponent, 1)}, d0 = ${fmt(radio.referenceDistanceM)} m)`;
  const [r, g, b] = sample ? colorForDbm(sample.powerDbm, colorStops) : [0, 0, 0];

  return (
    <section
      aria-label="Résultats au point sélectionné"
      className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-sm"
    >
      <h3 className="mb-2 font-medium text-slate-200">Point sélectionné (simulé)</h3>
      {sample && probe ? (
        <div className="mb-3 flex items-baseline gap-3">
          <span
            className="inline-block h-4 w-4 rounded-sm"
            style={{ backgroundColor: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` }}
          />
          <span className="text-2xl font-semibold tabular-nums text-slate-50">
            {fmt(sample.powerDbm)} dBm
          </span>
        </div>
      ) : (
        <p className="mb-3 text-slate-400">
          Cliquez sur la surface pour choisir un point.
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-300">
        <dt className="text-slate-400">Position AP</dt>
        <dd className="tabular-nums">x = {fmt(ap.x)} m, y = {fmt(ap.y)} m</dd>
        {probe && (
          <>
            <dt className="text-slate-400">Position point</dt>
            <dd className="tabular-nums">x = {fmt(probe.x)} m, y = {fmt(probe.y)} m</dd>
          </>
        )}
        {sample && (
          <>
            <dt className="text-slate-400">Distance à l'AP</dt>
            <dd className="tabular-nums">{fmt(sample.distanceM)} m</dd>
          </>
        )}
        <dt className="text-slate-400">Fréquence</dt>
        <dd>{freqLabel}</dd>
        <dt className="text-slate-400">Modèle actif</dt>
        <dd>{modelLabel}</dd>
      </dl>
    </section>
  );
}
