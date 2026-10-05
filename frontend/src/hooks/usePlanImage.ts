import { useEffect, useState } from 'react';
import type { PlanMeta } from '../types/project';
import { getPlanBlob, loadProject } from '../lib/storage';

interface PlanImageResult {
  plan: PlanMeta | null;
  imageUrl: string | null;
  loading: boolean;
}

export function usePlanImage(): PlanImageResult {
  const [plan, setPlan] = useState<PlanMeta | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    (async () => {
      const project = loadProject();
      const blob = await getPlanBlob();
      if (cancelled) return;

      if (!blob) {
        setLoading(false);
        return;
      }

      const url = URL.createObjectURL(blob);
      revokedUrl = url;

      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        setPlan({
          name:
            project?.plan?.name ||
            project?.plan?.fileName?.replace(/\.[^.]+$/, '') ||
            'Plan',
          fileName: project?.plan?.fileName || 'plan.png',
          width: img.naturalWidth,
          height: img.naturalHeight,
          sizeBytes: blob.size,
        });
        setImageUrl(url);
        setLoading(false);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        revokedUrl = null;
        if (!cancelled) setLoading(false);
      };
      img.src = url;
    })();

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, []);

  return { plan, imageUrl, loading };
}