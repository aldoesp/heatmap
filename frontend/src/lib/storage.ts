const ACTIVE_PLAN_KEY = 'heatmap:activePlanId';

/* ==========================================================================
   Plan actif : seul l'identifiant serveur est persisté localement.
   Le backend (SQLite) est la source de vérité pour tout le reste.
   ========================================================================== */

export function getActivePlanId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PLAN_KEY);
  } catch {
    return null;
  }
}

export function setActivePlanId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PLAN_KEY, id);
    else localStorage.removeItem(ACTIVE_PLAN_KEY);
  } catch {
    /* stockage indisponible : on ignore */
  }
}

export function clearActivePlan(): void {
  setActivePlanId(null);
}

/* ==========================================================================
   Migration depuis l'ancien format local (upload:plan).
   Utilisé une seule fois pour retrouver le plan actif si possible.
   ========================================================================== */

export function readLegacyPlanId(): string | null {
  try {
    const raw = localStorage.getItem('upload:plan');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { plan?: { id?: unknown } };
    return typeof parsed?.plan?.id === 'string' ? parsed.plan.id : null;
  } catch {
    return null;
  }
}
