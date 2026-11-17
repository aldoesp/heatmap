import heroUrl from '../assets/hero.png';

export interface DemoPlan {
  /** Nom de fichier envoyé au backend (sert aussi à nommer le plan) */
  fileName: string;
  mime: string;
  /** URL packagée par Vite (dev + build) */
  url: string;
  label: string;
}

export const DEMO_PLANS: DemoPlan[] = [
  {
    fileName: 'hero.png',
    mime: 'image/png',
    url: heroUrl,
    label: "Plan d'exemple",
  },
];

/** Récupère un plan de démo packagé et le présente comme un File local. */
export async function fetchDemoFile(demo: DemoPlan): Promise<File> {
  let res: Response;
  try {
    res = await fetch(demo.url);
  } catch {
    throw new Error('Impossible de charger le plan de démo.');
  }
  if (!res.ok) {
    throw new Error(`Impossible de charger le plan de démo (${res.status}).`);
  }
  const blob = await res.blob();
  return new File([blob], demo.fileName, { type: demo.mime });
}
