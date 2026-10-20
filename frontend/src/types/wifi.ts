/** Fréquences supportées, exprimées en MHz (la formule FSPL attend des MHz). */
export type FrequencyMHz = 2400 | 5000 | 6000;

export type PropagationModelId = 'fspl' | 'log-distance';

/** Coordonnées physiques en mètres. Origine en haut à gauche, y vers le bas. */
export interface Point {
  x: number;
  y: number;
}

export interface Surface {
  widthM: number;
  heightM: number;
}

export interface AntennaPattern {
  peakGainDbi: number;    // gain max de l'antenne
  azimuthDb: number[];    // 360 valeurs, gain relatif au pic (≤ 0 dB), index = degré
  elevationDb: number[];  // 360 valeurs, 0° = horizontal, 270° = vers le bas
}

export type Rgb = readonly [number, number, number];

export interface RadioParams {
  frequencyMHz: FrequencyMHz;
  txPowerDbm: number;     // puissance conduite à l'entrée de l'antenne
  antenna: AntennaPattern;
  apRotationDeg: number;  // orientation de l'AP
  apHeightM: number;      // hauteur de l'AP
  rxHeightM: number;      // hauteur du récepteur
  /** Gain de l'antenne de réception en dBi. */
  rxGainDbi: number;
  model: PropagationModelId;
  /** Exposant de perte n (modèle log-distance uniquement). */
  pathLossExponent: number;
  /** Distance de référence d0 en mètres (modèle log-distance uniquement). */
  referenceDistanceM: number;
  /** Distance plancher en mètres, évite log10(0). */
  minDistanceM: number;
}

/** Point d'ancrage du dégradé : la couleur vaut `rgb` à `thresholdDbm`. */
export interface ColorStop {
  label: string;
  thresholdDbm: number;
  rgb: Rgb;
}

export interface SignalSample {
  distanceM: number;
  powerDbm: number;
}

export interface HeatmapGrid {
  cols: number;
  rows: number;
  /** Largeur / hauteur d'une cellule en mètres. */
  cellWidthM: number;
  cellHeightM: number;
  /** Puissance reçue (dBm) par cellule, ligne par ligne, y = 0 en haut. */
  powersDbm: Float32Array;
}

export interface SimulatorConfig {
  surface: Surface;
  resolutionM: number;
  radio: RadioParams;
  /** Triés par seuil décroissant. */
  colorStops: ColorStop[];
}
