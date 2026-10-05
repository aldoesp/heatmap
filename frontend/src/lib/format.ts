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