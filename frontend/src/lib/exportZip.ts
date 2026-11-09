// ZIP « stored » : les PNG sont déjà compressés. Limite volontaire de mémoire.
const LIMIT = 256 * 1024 * 1024;

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC32 calculé en stream, sans charger le blob entier en mémoire. */
export async function crc32Stream(blob: Blob): Promise<number> {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) {
      crc ^= value[i];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Nettoie un nom de fichier pour le ZIP. */
export function sanitizeZipName(name: string, maxLen: number): string {
  const sanitized = name
    .replace(/[^\p{L}\p{N}._-]/gu, '-')
    .replace(/^-+|-+$/g, '')
    || 'fichier';
  return sanitized.slice(0, maxLen);
}

export interface HeatmapZipManifestImage {
  file: string;
  bssid: string;
  ssid: string;
  band: string;
  calculation: string;
}

export interface HeatmapZipManifest {
  format: string;
  version: number;
  exportedAt: string;
  plan: { id: string; name: string; width: number; height: number };
  images: HeatmapZipManifestImage[];
}

export class PngZip {
  private parts: (Blob | Uint8Array<ArrayBuffer>)[] = [];
  private directory: Uint8Array<ArrayBuffer>[] = [];
  private names = new Set<string>();
  private size = 0;
  private directorySize = 0;
  private manifest: HeatmapZipManifest | null = null;

  /** Définit le manifeste JSON ajouté à l'archive à la fin. */
  addManifest(manifest: HeatmapZipManifest): void {
    if (this.manifest) throw new Error('Le manifeste est déjà défini.');
    this.manifest = manifest;
  }

  async add(name: string, blob: Blob): Promise<void> {
    const filename = new TextEncoder().encode(name);
    const overhead = 30 + 46 + filename.length * 2;
    if (!name || /[\\/]/.test(name) || this.names.has(name)) throw new Error('Nom de fichier ZIP invalide ou dupliqué.');
    if (filename.length > 65535 || this.names.size >= 65535 || this.size + this.directorySize + blob.size + overhead + 22 > LIMIT) {
      throw new Error('ZIP trop volumineux (limite 256 Mo). Sélectionne moins de BSSID.');
    }
    const crc = await crc32Stream(blob);
    const local = new Uint8Array(30 + filename.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true);
    l.setUint16(6, 0x800, true); l.setUint16(12, 33, true);
    l.setUint32(14, crc, true); l.setUint32(18, blob.size, true); l.setUint32(22, blob.size, true);
    l.setUint16(26, filename.length, true); local.set(filename, 30);
    const central = new Uint8Array(46 + filename.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true); c.setUint16(14, 33, true); c.setUint32(16, crc, true);
    c.setUint32(20, blob.size, true); c.setUint32(24, blob.size, true);
    c.setUint16(28, filename.length, true); c.setUint32(42, this.size, true); central.set(filename, 46);
    this.parts.push(local, blob); this.directory.push(central); this.names.add(name);
    this.size += local.length + blob.size; this.directorySize += central.length;
  }

  /** Ajoute une entrée dont les données sont déjà en mémoire (manifest JSON). */
  private addMemoryEntry(name: string, bytes: Uint8Array<ArrayBuffer>): void {
    const filename = new TextEncoder().encode(name);
    const overhead = 30 + 46 + filename.length * 2;
    if (!name || /[\\/]/.test(name) || this.names.has(name)) throw new Error('Nom de fichier ZIP invalide ou dupliqué.');
    if (filename.length > 65535 || this.names.size >= 65535 || this.size + this.directorySize + bytes.byteLength + overhead + 22 > LIMIT) {
      throw new Error('ZIP trop volumineux (limite 256 Mo). Sélectionne moins de BSSID.');
    }
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + filename.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true);
    l.setUint16(6, 0x800, true); l.setUint16(12, 33, true);
    l.setUint32(14, crc, true); l.setUint32(18, bytes.byteLength, true); l.setUint32(22, bytes.byteLength, true);
    l.setUint16(26, filename.length, true); local.set(filename, 30);
    const central = new Uint8Array(46 + filename.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true); c.setUint16(14, 33, true); c.setUint32(16, crc, true);
    c.setUint32(20, bytes.byteLength, true); c.setUint32(24, bytes.byteLength, true);
    c.setUint16(28, filename.length, true); c.setUint32(42, this.size, true); central.set(filename, 46);
    this.parts.push(local, bytes); this.directory.push(central); this.names.add(name);
    this.size += local.length + bytes.byteLength; this.directorySize += central.length;
  }

  finish(): Blob {
    if (!this.names.size) throw new Error('Aucune image à exporter.');
    if (this.manifest) {
      const bytes = new TextEncoder().encode(JSON.stringify(this.manifest));
      this.addMemoryEntry('manifest.json', bytes);
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.names.size, true); view.setUint16(10, this.names.size, true);
    view.setUint32(12, this.directorySize, true); view.setUint32(16, this.size, true);
    return new Blob([...this.parts, ...this.directory, end], { type: 'application/zip' });
  }
}
