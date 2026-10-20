import { useCallback, useMemo, useState } from 'react';
import { createDefaultConfig, DEFAULT_PROBE } from '../../lib/defaults';
import {
  clampPoint,
  computeHeatmapGrid,
  effectiveResolutionM,
  surfaceCenter,
} from '../../lib/wifiHeatmap';
import { signalAt } from '../../lib/radioPropagation';
import type { Point, SimulatorConfig } from '../../types/wifi';
import { HeatmapCanvas } from './HeatmapCanvas';
import { ProbeResults } from './ProbeResults';
import { SignalLegend } from './SignalLegend';
import { SimulatorControls } from './SimulatorControls';

interface WifiHeatmapSimulatorProps {
  className?: string;
}

export function WifiHeatmapSimulator({ className = '' }: WifiHeatmapSimulatorProps) {
  const [config, setConfig] = useState<SimulatorConfig>(createDefaultConfig);
  const [apRaw, setApRaw] = useState<Point>(() => surfaceCenter(createDefaultConfig().surface));
  const [probeRaw, setProbeRaw] = useState<Point | null>(DEFAULT_PROBE);

  const { surface, radio, resolutionM, colorStops } = config;

  // Positions toujours bornées à la surface, même si celle-ci est réduite.
  const ap = useMemo(() => clampPoint(apRaw, surface), [apRaw, surface]);
  const probe = useMemo(
    () => (probeRaw ? clampPoint(probeRaw, surface) : null),
    [probeRaw, surface],
  );

  // Recalculé uniquement si la surface, la résolution, l'AP ou la radio changent.
  const grid = useMemo(
    () => computeHeatmapGrid(surface, resolutionM, ap, radio),
    [surface, resolutionM, ap, radio],
  );
  const sample = useMemo(
    () => (probe ? signalAt(probe, ap, radio) : null),
    [probe, ap, radio],
  );

  const handleReset = useCallback(() => {
    const defaults = createDefaultConfig();
    setConfig(defaults);
    setApRaw(surfaceCenter(defaults.surface));
    setProbeRaw(DEFAULT_PROBE);
  }, []);

  return (
    <div className={`bg-slate-950 p-4 text-slate-100 ${className}`}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Simulateur de propagation Wi-Fi</h2>
          <p className="text-sm text-slate-400">
            Un point d'accès, espace libre, vue 2D. Glissez l'AP, cliquez pour sonder un point.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setApRaw(surfaceCenter(surface))}
          className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          Recentrer l'AP
        </button>
      </header>

      <p
        role="note"
        className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
      >
        Résultats simulés, aucune mesure réelle. Le modèle ignore murs, obstacles,
        interférences et multi-trajets : il donne un ordre de grandeur théorique.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <HeatmapCanvas
            surface={surface}
            grid={grid}
            colorStops={colorStops}
            ap={ap}
            probe={probe}
            onApMove={setApRaw}
            onProbeMove={setProbeRaw}
          />
          <SignalLegend colorStops={colorStops} />
          <ProbeResults ap={ap} probe={probe} sample={sample} radio={radio} colorStops={colorStops} />
          <details className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-300">
            <summary className="cursor-pointer font-medium text-slate-200">
              Hypothèses et limites du modèle
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
              <li>FSPL(dB) = 32,44 + 20·log10(f en MHz) + 20·log10(d en km) ; Pr = EIRP − FSPL + Gr.</li>
              <li>L'EIRP inclut déjà le gain de l'antenne d'émission : il n'est pas ajouté deux fois.</li>
              <li>Antennes isotropes, un seul AP, pas de murs, d'obstacles, de fading ni d'interférences.</li>
              <li>Distance plancher configurée (0,1 m) pour éviter la singularité à l'AP.</li>
              <li>Le modèle log-distance est ancré sur le FSPL à d0 ; n = 2 redonne le FSPL.</li>
            </ul>
          </details>
        </div>
        <SimulatorControls
          config={config}
          effectiveResolutionM={effectiveResolutionM(surface, resolutionM)}
          onConfigChange={setConfig}
          onReset={handleReset}
        />
      </div>
    </div>
  );
}

export default WifiHeatmapSimulator;
