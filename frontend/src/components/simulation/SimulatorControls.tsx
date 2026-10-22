import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ANTENNA_OPTIONS } from '../../lib/antennas';
import { FREQUENCY_OPTIONS, RESOLUTION_OPTIONS_M, SURFACE_LIMITS_M } from '../../lib/defaults';
import { clamp } from '../../lib/heatmap';
import type {
  AntennaId,
  FrequencyMHz,
  PropagationModelId,
  RadioParams,
  SimulatorConfig,
} from '../../types/wifi';

interface SimulatorControlsProps {
  config: SimulatorConfig;
  effectiveResolutionM: number;
  /** EIRP de crête (Ptx + gain max), en dBm, calculée. */
  peakEirpDbm: number;
  onConfigChange: (next: SimulatorConfig) => void;
  onReset: () => void;
  /**
   * Masque l'édition de la largeur/hauteur (simulation sur plan : la surface
   * est fixée par la calibration mètres/pixel, pas par l'utilisateur).
   */
  disableSurfaceEditing?: boolean;
}

const inputCls =
  'w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400';

interface NumberInputProps {
  id: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}

/** Champ numérique : valide (et borne) à la sortie du champ ou sur Entrée. */
function NumberInput({ id, value, min, max, onCommit }: NumberInputProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    const bounded = clamp(parsed, min, max);
    setText(String(bounded));
    onCommit(bounded);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={`${inputCls} text-right tabular-nums`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

interface FieldProps {
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}

function NumberField({ id, label, unit, ...rest }: FieldProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-slate-300">
        {label}
      </label>
      <div className="flex w-28 items-center gap-1">
        <NumberInput id={id} {...rest} />
        <span className="w-9 text-xs text-slate-400">{unit}</span>
      </div>
    </div>
  );
}

function SliderField({ id, label, unit, step, ...rest }: FieldProps & { step: number }) {
  return (
    <div className="space-y-1">
      <NumberField id={id} label={label} unit={unit} {...rest} />
      <input
        type="range"
        aria-label={`${label} (curseur)`}
        className="w-full accent-sky-400"
        min={rest.min}
        max={rest.max}
        step={step}
        value={rest.value}
        onChange={(e) => rest.onCommit(Number(e.target.value))}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
      <legend className="px-1 text-sm font-medium text-slate-200">{title}</legend>
      {children}
    </fieldset>
  );
}

export function SimulatorControls({
  config,
  effectiveResolutionM,
  peakEirpDbm,
  onConfigChange,
  onReset,
  disableSurfaceEditing = false,
}: SimulatorControlsProps) {
  const { surface, radio, colorStops, resolutionM } = config;
  const setRadio = (patch: Partial<RadioParams>) =>
    onConfigChange({ ...config, radio: { ...radio, ...patch } });

  const setThreshold = (index: number, value: number) => {
    const upper = index > 0 ? colorStops[index - 1].thresholdDbm - 1 : 20;
    const lower = index < colorStops.length - 1 ? colorStops[index + 1].thresholdDbm + 1 : -120;
    const next = colorStops.map((s, i) =>
      i === index ? { ...s, thresholdDbm: clamp(value, lower, upper) } : s,
    );
    onConfigChange({ ...config, colorStops: next });
  };

  return (
    <div className="space-y-3">
      <Group title="Surface">
        {disableSurfaceEditing ? (
          <p className="text-xs text-slate-400">
            Surface imposée par la calibration du plan :{' '}
            {surface.widthM.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ×{' '}
            {surface.heightM.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m.
          </p>
        ) : (
          <>
            <NumberField id="width" label="Largeur" unit="m" value={surface.widthM} min={SURFACE_LIMITS_M.min} max={SURFACE_LIMITS_M.max}
              onCommit={(v) => onConfigChange({ ...config, surface: { ...surface, widthM: v } })} />
            <NumberField id="height" label="Hauteur" unit="m" value={surface.heightM} min={SURFACE_LIMITS_M.min} max={SURFACE_LIMITS_M.max}
              onCommit={(v) => onConfigChange({ ...config, surface: { ...surface, heightM: v } })} />
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="resolution" className="text-sm text-slate-300">Résolution</label>
          <select id="resolution" className={`${inputCls} w-28`} value={resolutionM}
            onChange={(e) => onConfigChange({ ...config, resolutionM: Number(e.target.value) })}>
            {RESOLUTION_OPTIONS_M.map((r) => (
              <option key={r} value={r}>{String(r).replace('.', ',')} m</option>
            ))}
          </select>
        </div>
        {effectiveResolutionM > resolutionM + 1e-9 && (
          <p className="text-xs text-amber-300">
            Résolution effective : {effectiveResolutionM.toFixed(2).replace('.', ',')} m (limite du nombre de cellules).
          </p>
        )}
      </Group>

      <Group title="Radio">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="freq" className="text-sm text-slate-300">Fréquence</label>
          <select id="freq" className={`${inputCls} w-28`} value={radio.frequencyMHz}
            onChange={(e) => setRadio({ frequencyMHz: Number(e.target.value) as FrequencyMHz })}>
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="antenna" className="text-sm text-slate-300">Antenne</label>
          <select id="antenna" className={`${inputCls} w-44`} value={radio.antennaId}
            onChange={(e) => setRadio({ antennaId: e.target.value as AntennaId })}>
            {ANTENNA_OPTIONS.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
        <SliderField id="txpower" label="Puissance d'émission" unit="dBm" step={0.5} value={radio.txPowerDbm} min={0} max={30}
          onCommit={(v) => setRadio({ txPowerDbm: v })} />
        <p className="text-xs text-slate-400">
          EIRP de crête (calculée) : {peakEirpDbm.toFixed(1).replace('.', ',')} dBm. Le gain
          d'antenne n'est ajouté qu'une fois, selon la direction.
        </p>
        <SliderField id="rxgain" label="Gain réception" unit="dBi" step={0.5} value={radio.rxGainDbi} min={-10} max={15}
          onCommit={(v) => setRadio({ rxGainDbi: v })} />
        <SliderField id="rotation" label="Orientation AP" unit="°" step={1} value={radio.apRotationDeg} min={0} max={359}
          onCommit={(v) => setRadio({ apRotationDeg: v })} />
        <NumberField id="apheight" label="Hauteur AP" unit="m" value={radio.apHeightM} min={0.5} max={20}
          onCommit={(v) => setRadio({ apHeightM: v })} />
        <NumberField id="rxheight" label="Hauteur récepteur" unit="m" value={radio.rxHeightM} min={0} max={5}
          onCommit={(v) => setRadio({ rxHeightM: v })} />
      </Group>

      <Group title="Modèle de propagation">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="model" className="text-sm text-slate-300">Modèle</label>
          <select id="model" className={`${inputCls} w-44`} value={radio.model}
            onChange={(e) => setRadio({ model: e.target.value as PropagationModelId })}>
            <option value="fspl">FSPL (espace libre)</option>
            <option value="log-distance">Log-distance (optionnel)</option>
          </select>
        </div>
        {radio.model === 'log-distance' && (
          <>
            <SliderField id="n" label="Exposant n" unit="" step={0.1} value={radio.pathLossExponent} min={1} max={6}
              onCommit={(v) => setRadio({ pathLossExponent: v })} />
            <NumberField id="d0" label="Distance d0" unit="m" value={radio.referenceDistanceM} min={0.1} max={10}
              onCommit={(v) => setRadio({ referenceDistanceM: v })} />
            <p className="text-xs text-slate-400">
              Pr(d0) est ancré sur le FSPL à d0. Avec n = 2, le résultat est identique au FSPL.
            </p>
          </>
        )}
      </Group>

      <Group title="Seuils de la légende (dBm)">
        {colorStops.map((s, i) => (
          <NumberField key={s.label} id={`th-${i}`} label={s.label} unit="dBm" value={s.thresholdDbm} min={-120} max={20}
            onCommit={(v) => setThreshold(i, v)} />
        ))}
      </Group>

      <button
        type="button"
        onClick={onReset}
        className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        Réinitialiser les paramètres
      </button>
    </div>
  );
}
