import { useCallback, useMemo, useState } from 'react';
import { getSettings, patchSetting } from '../lib/api.js';
import { useApiQuery } from './useApiQuery.js';
import {
  DEFAULT_HEATMAP_COLOURS,
  sanitizeHeatmapColours,
  type HeatmapColours,
} from '../lib/heatmapColours.js';

export function useHeatmapColours() {
  const [raw, setRaw] = useState('');
  const colours = useMemo(() => {
    try {
      return sanitizeHeatmapColours(JSON.parse(raw));
    } catch {
      return sanitizeHeatmapColours(DEFAULT_HEATMAP_COLOURS);
    }
  }, [raw]);

  useApiQuery(getSettings, {
    success: settings => setRaw(settings.heatmap_colours),
    error: () => setRaw(''),
  });

  const save = useCallback(async (next: HeatmapColours) => {
    const sanitized = sanitizeHeatmapColours(next);
    const value = JSON.stringify(sanitized);
    setRaw(value);
    await patchSetting('heatmap_colours', value);
    return sanitized;
  }, []);

  const reset = useCallback(async () => {
    setRaw('');
    await patchSetting('heatmap_colours', '');
    return sanitizeHeatmapColours(DEFAULT_HEATMAP_COLOURS);
  }, []);

  return { colours, save, reset };
}
