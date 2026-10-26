import type { Quality } from '../../lib/signal';

/* Couleurs de UI-surveys.md §3 (le badge porte toujours son texte). */
const STYLES: Record<Quality, string> = {
  Bon: 'bg-[rgba(16,185,129,0.15)] text-[#34d399]',
  Moyen: 'bg-[rgba(245,158,11,0.15)] text-[#fbbf24]',
  Faible: 'bg-[rgba(239,68,68,0.15)] text-[#f87171]',
};

export function QualityBadge({ quality }: { quality: Quality }) {
  return (
    <span
      className={`inline-flex items-center h-5 px-2 rounded-md text-[11px] font-medium ${STYLES[quality]}`}
    >
      {quality}
    </span>
  );
}
