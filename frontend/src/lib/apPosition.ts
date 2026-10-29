const BSSID_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

export interface ApPositionRecord {
  planId: string;
  bssid: string;
  x: number;
  y: number;
  updatedAt: string;
}

export class ApPositionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApPositionValidationError';
  }
}

function normalizeBssid(bssid: string): string {
  const value = bssid.trim().toLowerCase();
  if (!BSSID_RE.test(value)) throw new ApPositionValidationError('BSSID invalide.');
  return value;
}

function validateCoord(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ApPositionValidationError(`${name} invalide.`);
  }
}

const store = new Map<string, ApPositionRecord>();

function key(planId: string, bssid: string): string {
  return `${planId}|${bssid}`;
}

export function listApPositions(planId: string): ApPositionRecord[] {
  const out: ApPositionRecord[] = [];
  for (const rec of store.values()) {
    if (rec.planId === planId) out.push({ ...rec });
  }
  return out;
}

export function upsertApPosition(planId: string, bssid: string, x: number, y: number): ApPositionRecord {
  const nb = normalizeBssid(bssid);
  validateCoord(x, 'x');
  validateCoord(y, 'y');
  const rec: ApPositionRecord = {
    planId,
    bssid: nb,
    x,
    y,
    updatedAt: new Date().toISOString(),
  };
  store.set(key(planId, nb), rec);
  return { ...rec };
}

export function deleteApPosition(planId: string, bssid: string): void {
  const nb = normalizeBssid(bssid);
  store.delete(key(planId, nb));
}
