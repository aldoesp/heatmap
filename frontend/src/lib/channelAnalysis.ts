import type { NetworkObservation } from '../types/api.js';

/** Bandes affichées par l'analyseur de canaux (le 6 GHz reste hors MVP). */
export type ChannelBand = '2.4' | '5';

/** Espacement entre deux canaux, en MHz. */
export const CHANNEL_STEP_MHZ = 5;

/**
 * Largeur utilisée uniquement pour dessiner une courbe quand la mesure ne
 * contient pas `bandwidth_mhz`. Elle est signalée comme estimée dans l'UI.
 */
export const DEFAULT_CHANNEL_WIDTH_MHZ = 20;

/** Palette existante du projet (accent, heatmap et niveaux RSSI). */
export const CHANNEL_PALETTE = [
  '#10b981',
  '#4cc38a',
  '#a3e635',
  '#d9a441',
  '#f59e0b',
  '#f97316',
  '#f87171',
  '#8b98a5',
] as const;

/** Observation persistée + contexte du scan qui l'a produite. */
export type ChannelSample = NetworkObservation & {
  scanned_at?: string;
  scan_point_id?: string;
};

export interface ChannelNetwork {
  bssid: string;
  bssidName: string;
  ssid: string | null;
  hidden: boolean;
  band: ChannelBand;
  /** Canal primaire. */
  channel: number;
  /** Canal central du bloc (peut différer en 40/80/160 MHz). */
  centerChannel: number;
  frequencyMhz: number;
  centerFrequencyMhz: number;
  /** Largeur réellement mesurée ; null si le scan ne l'a pas fournie. */
  bandwidthMhz: number | null;
  /** Largeur utilisée pour le tracé (mesure ou valeur de repli). */
  widthMhz: number;
  widthEstimated: boolean;
  rssi: number;
  quality: number;
  security: string;
  standard: string;
  sampleCount: number;
  pointCount: number;
  lastSeen: string | null;
}

export interface ChannelSpan {
  startChannel: number;
  endChannel: number;
  startMhz: number;
  endMhz: number;
  estimated: boolean;
}

export interface ChannelOverlap {
  a: ChannelNetwork;
  b: ChannelNetwork;
  overlapMhz: number;
  startChannel: number;
  endChannel: number;
  estimated: boolean;
}

export interface ChannelDomain {
  min: number;
  max: number;
  ticks: number[];
}

const FIVE_GHZ_CHANNELS: readonly number[] = [
  32, 36, 40, 44, 48, 52, 56, 60, 64,
  100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144,
  149, 153, 157, 161, 165,
];

const TWO_POINT_FOUR_CHANNELS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

/** Fréquence (MHz) -> numéro de canal ; même formule que le backend. */
export function channelFromFrequency(mhz: number): number | null {
  if (!Number.isFinite(mhz)) return null;
  if (mhz === 2484) return 14;
  if (mhz >= 2400 && mhz <= 2500) return Math.round((mhz - 2407) / CHANNEL_STEP_MHZ);
  if (mhz >= 5150 && mhz <= 5895) return Math.round((mhz - 5000) / CHANNEL_STEP_MHZ);
  return null;
}

/** Bande exploitable, déduite du champ `band` puis de la fréquence. */
export function channelBandForSample(
  sample: Pick<ChannelSample, 'band' | 'frequency_mhz'>,
): ChannelBand | null {
  const band = typeof sample.band === 'string' ? sample.band.trim() : '';
  if (band === '2.4GHz') return '2.4';
  if (band === '5GHz') return '5';
  if (sample.frequency_mhz >= 2400 && sample.frequency_mhz <= 2500) return '2.4';
  if (sample.frequency_mhz >= 5150 && sample.frequency_mhz <= 5895) return '5';
  return null;
}

function normaliseBssid(value: string): string {
  return value.trim().toLowerCase();
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function centerChannelFor(sample: ChannelSample, channel: number): number {
  if (sample.center_channel !== null && sample.center_channel !== undefined) {
    return sample.center_channel;
  }
  if (
    sample.center_frequency_mhz !== null &&
    sample.center_frequency_mhz !== undefined
  ) {
    const derived = channelFromFrequency(sample.center_frequency_mhz);
    if (derived !== null) return derived;
  }
  return channel;
}

interface Aggregate {
  best: ChannelSample;
  channel: number;
  centerChannel: number;
  sampleCount: number;
  pointCount: Set<string>;
  lastSeen: string | null;
}

function isBetterSample(
  sample: ChannelSample,
  current: Aggregate,
): boolean {
  if (sample.rssi !== current.best.rssi) return sample.rssi > current.best.rssi;
  return Boolean(
    sample.scanned_at &&
      (!current.best.scanned_at || sample.scanned_at > current.best.scanned_at),
  );
}

/**
 * Agrège les observations d'une bande en une entrée par BSSID.
 *
 * Un BSSID (radio physique) reste distinct d'un SSID (nom du réseau) : deux
 * BSSID qui partagent un SSID produisent bien deux courbes. Pour chaque
 * BSSID, on conserve l'observation au meilleur RSSI (puis la plus récente en
 * cas d'égalité) ; les métadonnées de canal viennent de cette observation.
 */
export function aggregateChannelNetworks(
  samples: readonly ChannelSample[],
  band: ChannelBand,
): ChannelNetwork[] {
  const byBssid = new Map<string, Aggregate>();

  for (const sample of samples) {
    if (channelBandForSample(sample) !== band) continue;
    if (!sample.bssid) continue;

    const bssid = normaliseBssid(sample.bssid);
    if (!bssid) continue;

    const channel = sample.channel ?? channelFromFrequency(sample.frequency_mhz);
    if (channel === null || !Number.isFinite(channel)) continue;

    const centerChannel = centerChannelFor(sample, channel);
    const scannedAt = sample.scanned_at ?? null;
    const pointId = sample.scan_point_id;

    const current = byBssid.get(bssid);
    if (!current) {
      byBssid.set(bssid, {
        best: sample,
        channel,
        centerChannel,
        sampleCount: 1,
        pointCount: new Set(pointId ? [pointId] : []),
        lastSeen: scannedAt,
      });
      continue;
    }

    current.sampleCount += 1;
    current.lastSeen = laterIso(current.lastSeen, scannedAt);
    if (pointId) current.pointCount.add(pointId);
    if (isBetterSample(sample, current)) {
      current.best = sample;
      current.channel = channel;
      current.centerChannel = centerChannel;
    }
  }

  return [...byBssid.values()]
    .map((entry): ChannelNetwork => {
      const { best } = entry;
      const measuredWidth =
        typeof best.bandwidth_mhz === 'number' &&
        Number.isFinite(best.bandwidth_mhz) &&
        best.bandwidth_mhz > 0
          ? best.bandwidth_mhz
          : null;
      const widthMhz = measuredWidth ?? DEFAULT_CHANNEL_WIDTH_MHZ;
      return {
        bssid: normaliseBssid(best.bssid),
        bssidName: best.bssid_name || normaliseBssid(best.bssid),
        ssid: best.ssid && best.ssid.trim() ? best.ssid : null,
        hidden: best.hidden || !best.ssid,
        band,
        channel: entry.channel,
        centerChannel: entry.centerChannel,
        frequencyMhz: best.frequency_mhz,
        centerFrequencyMhz: best.center_frequency_mhz ?? best.frequency_mhz,
        bandwidthMhz: measuredWidth,
        widthMhz,
        widthEstimated: measuredWidth === null,
        rssi: best.rssi,
        quality: best.quality,
        security: best.security,
        standard: best.standard,
        sampleCount: entry.sampleCount,
        pointCount: entry.pointCount.size,
        lastSeen: entry.lastSeen,
      };
    })
    .sort((a, b) => {
      if (b.rssi !== a.rssi) return b.rssi - a.rssi;
      const labelA = a.ssid ?? a.bssid;
      const labelB = b.ssid ?? b.bssid;
      return labelA.localeCompare(labelB, 'fr') || a.bssid.localeCompare(b.bssid);
    });
}

/**
 * Ne garde que le meilleur AP de chaque SSID (RSSI le plus élevé), pour
 * masquer les bornes secondaires d'un même réseau maillé. L'identité reste le
 * BSSID : deux BSSID ne sont regroupés que s'ils partagent le même SSID.
 * Les réseaux masqués restent individuels, faute de SSID pour les relier.
 */
export function filterBestNetworks(
  networks: readonly ChannelNetwork[],
): ChannelNetwork[] {
  const bestByKey = new Map<string, ChannelNetwork>();

  for (const network of networks) {
    const key = network.ssid ? `ssid:${network.ssid}` : `bssid:${network.bssid}`;
    const current = bestByKey.get(key);
    if (!current || network.rssi > current.rssi) bestByKey.set(key, network);
  }

  const kept = new Set(bestByKey.values());
  return networks.filter((network) => kept.has(network));
}

/** Occupation du spectre d'un réseau, en canaux et en MHz. */
export function channelSpan(network: ChannelNetwork): ChannelSpan {
  const halfWidthChannels = network.widthMhz / (2 * CHANNEL_STEP_MHZ);
  const halfWidthMhz = network.widthMhz / 2;
  return {
    startChannel: network.centerChannel - halfWidthChannels,
    endChannel: network.centerChannel + halfWidthChannels,
    startMhz: network.centerFrequencyMhz - halfWidthMhz,
    endMhz: network.centerFrequencyMhz + halfWidthMhz,
    estimated: network.widthEstimated,
  };
}

/**
 * Chevauchements deux à deux. Le calcul se fait sur les fréquences occupées
 * (centre ± largeur / 2), pas sur le seul numéro de canal primaire.
 */
export function findChannelOverlaps(
  networks: readonly ChannelNetwork[],
): ChannelOverlap[] {
  const overlaps: ChannelOverlap[] = [];
  for (let i = 0; i < networks.length; i += 1) {
    for (let j = i + 1; j < networks.length; j += 1) {
      const a = networks[i];
      const b = networks[j];
      if (a.bssid === b.bssid) continue;
      const spanA = channelSpan(a);
      const spanB = channelSpan(b);
      const overlapMhz =
        Math.min(spanA.endMhz, spanB.endMhz) -
        Math.max(spanA.startMhz, spanB.startMhz);
      if (overlapMhz <= 0.1) continue;
      overlaps.push({
        a,
        b,
        overlapMhz,
        startChannel: Math.max(spanA.startChannel, spanB.startChannel),
        endChannel: Math.min(spanA.endChannel, spanB.endChannel),
        estimated: spanA.estimated || spanB.estimated,
      });
    }
  }
  return overlaps.sort(
    (a, b) =>
      b.overlapMhz - a.overlapMhz ||
      (a.a.ssid ?? a.a.bssid).localeCompare(b.a.ssid ?? b.a.bssid, 'fr') ||
      (a.b.ssid ?? a.b.bssid).localeCompare(b.b.ssid ?? b.b.bssid, 'fr'),
  );
}

function fiveGhzTicks(min: number, max: number): number[] {
  const visible = FIVE_GHZ_CHANNELS.filter((channel) => channel >= min && channel <= max);
  if (visible.length <= 14) return visible;
  const stride = Math.ceil(visible.length / 14);
  return visible.filter((_, index) => index % stride === 0 || index === visible.length - 1);
}

/** Domaine X du graphique : canaux standard, élargis aux largeurs observées. */
export function channelDomain(
  band: ChannelBand,
  networks: readonly ChannelNetwork[],
): ChannelDomain {
  if (band === '2.4') {
    return { min: 1, max: 14, ticks: [...TWO_POINT_FOUR_CHANNELS] };
  }

  if (networks.length === 0) {
    return { min: 32, max: 165, ticks: fiveGhzTicks(32, 165) };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const network of networks) {
    const span = channelSpan(network);
    min = Math.min(min, span.startChannel);
    max = Math.max(max, span.endChannel);
  }

  const boundedMin = Math.max(32, Math.floor(min / 4) * 4);
  const boundedMax = Math.min(177, Math.ceil(max / 4) * 4);
  return {
    min: boundedMin,
    max: Math.max(boundedMin + 4, boundedMax),
    ticks: fiveGhzTicks(boundedMin, Math.max(boundedMin + 4, boundedMax)),
  };
}
