import { useCallback, useEffect, useState } from 'react';
import { getSettings, patchSetting } from '../lib/api.js';
import {
  DEFAULT_HEATMAP_COLOURS,
  sanitizeHeatmapColours,
  type HeatmapColours,
} from '../lib/heatmapColours.js';

export function useHeatmapColours() {
  const [colours, setColours] = useState<HeatmapColours>(() =>
    sanitizeHeatmapColours(DEFAULT_HEATMAP_COLOURS)
  );

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        const raw = settings.heatmap_colours;
        if (raw && typeof raw === 'string' && raw.trim() !== '') {
          try {
            const parsed = JSON.parse(raw);
            setColours(sanitizeHeatmapColours(parsed));
          } catch {
            setColours(sanitizeHeatmapColours(DEFAULT_HEATMAP_COLOURS));
          }
        } else {
          setColours(sanitizeHeatmapColours(DEFAULT_HEATMAP_COLOURS));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setColours(sanitizeHeatmapColours(DEFAULT_HEATMAP_COLOURS));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: HeatmapColours) => {
    const sanitized = sanitizeHeatmapColours(next);
    setColours(sanitized);
    await patchSetting('heatmap_colours', JSON.stringify(sanitized));
    return sanitized;
  }, []);

  const reset = useCallback(async () => {
    const sanitized = sanitizeHeatmapColours(DEFAULT_HEATMAP_COLOURS);
    setColours(sanitized);
    await patchSetting('heatmap_colours', '');
    return sanitized;
  }, []);

  return { colours, save, reset };
}
