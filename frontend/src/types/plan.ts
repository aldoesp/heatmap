export interface AccessPoint {
  id: string;
  name: string;
  /** Normalized 0–1 relative to image */
  x: number;
  y: number;
}

export interface PlanData {
  name: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  image: Blob;
  imageUrl: string;
}

export interface PlanState {
  plan: PlanData | null;
  accessPoints: AccessPoint[];
  selectedApId: string | null;
  placing: boolean;
}

export interface PersistedPlan {
  plan: Omit<PlanData, 'image' | 'imageUrl'>;
  accessPoints: AccessPoint[];
}