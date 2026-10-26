import { U7_PRO_XGS_PATTERNS } from '../data/u7ProXgsPatterns';
import type { AntennaId, AntennaPattern, FrequencyMHz } from '../types/wifi';
import { flatPattern } from './antennaPattern';

export interface AntennaOption {
  id: AntennaId;
  label: string;
}

export const ANTENNA_OPTIONS: readonly AntennaOption[] = [
  { id: 'isotropic', label: 'Isotropique (0 dBi)' },
  { id: 'u7-pro-xgs', label: 'U7 Pro XGS (directionnel)' },
];

const ISOTROPIC = flatPattern(0);

export function resolveAntenna(antennaId: AntennaId, frequencyMHz: FrequencyMHz): AntennaPattern {
  return antennaId === 'u7-pro-xgs' ? U7_PRO_XGS_PATTERNS[frequencyMHz] : ISOTROPIC;
}
