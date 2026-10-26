export interface AccessPoint {
  id: string;
  name: string;
  /** Normalized 0–1 relative to image */
  x: number;
  y: number;
}

export interface PlanData {
  /** Identifiant serveur du plan (renvoyé par POST /api/v1/plans) */
  id: string;
  name: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  /** URL absolue ou relative servie par le backend */
  imageUrl: string;
}

export interface PlanState {
  plan: PlanData | null;
  accessPoints: AccessPoint[];
  selectedApId: string | null;
  placing: boolean;
}

/**
 * Forme persistée localement : uniquement les métadonnées + l'URL/id serveur.
 * Le fichier image lui-même n'est plus stocké côté client.
 */
export interface PersistedPlan {
  plan: PlanData;
  accessPoints: AccessPoint[];
}