export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

export function formatPercent(v: number): string {
  return `${Math.round(v * 100)} %`;
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function formatApCoords(x: number, y: number): string {
  return `x ${formatPercent(x)} · y ${formatPercent(y)}`;
}

export function pluralPoints(n: number): string {
  return n === 0 ? '0 point' : n === 1 ? '1 point' : `${n} points`;
}

export function formatMbps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—';
  return `${(Math.round((bps / 1_000_000) * 100) / 100).toLocaleString('fr-FR')} Mb/s`;
}

/* Rendu façon Node console.table (cf. backend/tests/parser.json) :
   string -> 'valeur', number/boolean/null bruts, objets -> JSON. */
export function formatConsoleCell(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') return `'${value}'`;
  return JSON.stringify(value);
}