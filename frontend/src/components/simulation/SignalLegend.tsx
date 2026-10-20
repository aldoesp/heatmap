import type { ColorStop } from '../../types/wifi';

interface SignalLegendProps {
  colorStops: readonly ColorStop[];
}

const toCss = ([r, g, b]: ColorStop['rgb']): string =>
  `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

export function SignalLegend({ colorStops }: SignalLegendProps) {
  const top = colorStops[0].thresholdDbm;
  const bottom = colorStops[colorStops.length - 1].thresholdDbm;
  const span = top - bottom || 1;
  const gradient = colorStops
    .map((s) => `${toCss(s.rgb)} ${(((top - s.thresholdDbm) / span) * 100).toFixed(1)}%`)
    .join(', ');

  return (
    <section
      aria-label="Légende du signal"
      className="rounded-lg border border-slate-700 bg-slate-800/60 p-3"
    >
      <h3 className="mb-2 text-sm font-medium text-slate-200">
        Légende (puissance reçue, dBm)
      </h3>
      <div
        className="h-3 w-full rounded"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      />
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300 sm:grid-cols-5">
        {colorStops.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: toCss(s.rgb) }}
            />
            <span>
              {s.label}{' '}
              <span className="text-slate-400">
                {i === colorStops.length - 1 ? '≤' : '≥'} {s.thresholdDbm}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">
        Seuils indicatifs, configurables : ce ne sont pas des normes. Les
        couleurs sont interpolées entre les ancres.
      </p>
    </section>
  );
}
