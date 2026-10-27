import type { NormalizedCoord } from '../lib/coords';

/**
 * Zone de délimitation dessinée à la main sur un plan.
 * Les sommets sont dans le repère normalisé du projet (x, y ∈ [0,1],
 * y = 0 en bas), le même que les mesures Wi-Fi et les points d'accès.
 */
export interface PlanPolygon {
  id: string;
  planId: string;
  /** Sommets du tracé, dans l'ordre de saisie. */
  vertices: NormalizedCoord[];
}
