import type {
  ColorStop,
  FrequencyMHz,
  Point,
  SimulatorConfig,
} from '../types/wifi';

export const FREQUENCY_OPTIONS: ReadonlyArray<{
  value: FrequencyMHz;
  label: string;
}> = [
  { value: 2400, label: '2,4 GHz' },
  { value: 5000, label: '5 GHz' },
  { value: 6000, label: '6 GHz' },
];

export const RESOLUTION_OPTIONS_M: readonly number[] = [0.05, 0.1, 0.2, 0.5];

export const SURFACE_LIMITS_M = { min: 2, max: 50 } as const;

/**
 * Seuils par défaut : choisis pour rendre le gradient lisible en espace libre
 * sur ~10 × 8 m (la puissance y reste élevée : environ -6 à -50 dBm).
 * Ce ne sont PAS des normes : les seuils usuels en site réel (ex. -67 dBm)
 * s'appliquent à des environnements avec murs et pertes. Modifiables dans l'UI.
 */
export const DEFAULT_COLOR_STOPS: readonly ColorStop[] = [
  { label: 'Excellent', thresholdDbm: -30, rgb: [22, 101, 52] },
  { label: 'Bon', thresholdDbm: -35, rgb: [74, 222, 128] },
  { label: 'Moyen', thresholdDbm: -40, rgb: [250, 204, 21] },
  { label: 'Faible', thresholdDbm: -45, rgb: [249, 115, 22] },
  { label: 'Très faible', thresholdDbm: -50, rgb: [220, 38, 38] },
];

export const DEFAULT_PROBE: Point = { x: 8, y: 4 };

export function createDefaultConfig(): SimulatorConfig {
  return {
    surface: { widthM: 10, heightM: 8 },
    resolutionM: 0.1,
    radio: {
      frequencyMHz: 5000,
      eirpDbm: 20,
      rxGainDbi: 0,
      model: 'fspl',
      pathLossExponent: 2,
      referenceDistanceM: 1,
      minDistanceM: 0.1,
    },
    colorStops: DEFAULT_COLOR_STOPS.map((s) => ({ ...s })),
  };
}
