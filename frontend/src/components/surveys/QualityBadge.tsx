import type { Quality } from '../../lib/signal';

const DOTS: Record<Quality, string> = {
  Bon: 'bg-live',
  Moyen: 'bg-warn',
  Faible: 'bg-danger',
};

const LABELS: Record<Quality, string> = {
  Bon: 'Bon',
  Moyen: 'Moyen',
  Faible: 'Faible',
};

export function QualityBadge({ quality }: { quality: Quality }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-dim">
      <span className={`h-1.5 w-1.5 rounded-full ${DOTS[quality]}`} aria-hidden />
      {LABELS[quality]}
    </span>
  );
}
