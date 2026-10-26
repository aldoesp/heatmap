/** Fréquences supportées, exprimées en MHz (la formule FSPL attend des MHz). */
export type FrequencyMHz = 2400 | 5000 | 6000;

export type PropagationModelId = 'fspl' | 'log-distance';

export type AntennaId = 'isotropic' | 'u7-pro-xgs';

/**
 * Diagramme d'antenne : deux coupes, en dB relatifs au pic (≤ 0, 0 = maximum).
 * Approximation séparable : G(az, nadir) = pic + A_az(az) + A_el(nadir).
 */
export interface AntennaPattern {
  /** Gain de crête en dBi (fiche technique). */
  peakGainDbi: number;
  /** 360 valeurs, 1 par degré d'azimut. */
  azimuthDb: readonly number[];
  /**
   * 360 valeurs, angle mesuré depuis le nadir :
   * 0° = droit sous l'AP, 90° = horizon, 180° = zénith.
   */
  elevationDb: readonly number[];
}

/** Coordonnées physiques en mètres. Origine en haut à gauche, y vers le bas. */
export interface Point {
  x: number;
  y: number;
}

export interface Surface {
  widthM: number;
  heightM: number;
}

export type Rgb = readonly [number, number, number];

export interface RadioParams {
  frequencyMHz: FrequencyMHz;
  /** Puissance conduite à l'entrée de l'antenne, en dBm (sans le gain d'antenne). */
  txPowerDbm: number;
  antennaId: AntennaId;
  /** Orientation de l'AP : direction (en degrés, y vers le bas) de l'azimut 0° du diagramme. */
  apRotationDeg: number;
  /** Hauteur de l'AP et du récepteur au-dessus du sol, en mètres. */
  apHeightM: number;
  rxHeightM: number;
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
  /** Distance 3D AP -> récepteur (m). */
  distanceM: number;
  /** Distance horizontale (m). */
  horizontalM: number;
  /** Gain d'émission dans cette direction (dBi). */
  txGainDbi: number;
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
