import { EllipsisVertical } from 'lucide-react';
import { QualityBadge } from './QualityBadge';
import { SurveyThumbnail } from './SurveyThumbnail';
import { formatDateShort, qualityFromRssi } from '../../lib/signal';
import type { SurveySummary } from '../../hooks/useSurveysLibrary';

type Props = {
  survey: SurveySummary;
  busy: boolean;
  onOpenMenu: (survey: SurveySummary) => void;
  onHeatmap: (survey: SurveySummary) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (survey: SurveySummary) => void;
};

export function SurveyCard({
  survey,
  busy,
  onOpenMenu,
  onHeatmap,
  selectable = false,
  selected = false,
  onSelect,
}: Props) {
  const quality = qualityFromRssi(survey.avgRssi);
  const activate = () => {
    if (selectable) onSelect?.(survey);
    else onOpenMenu(survey);
  };

  return (
    <article
      className={[
        'glass-fallback relative overflow-hidden rounded-card border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 shadow-glass-light transition-colors duration-ui ease-ui hover:border-glass-border',
        selected && 'border-accent-border ring-1 ring-accent-border bg-accent-soft',
        busy && 'pointer-events-none opacity-55',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {selectable && (
        <label className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-glass-border-soft bg-glass-bg backdrop-blur-ui">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect?.(survey)}
            aria-label={`Sélectionner ${survey.name}`}
            className="h-4 w-4 accent-accent"
          />
        </label>
      )}
      <button
        type="button"
        onClick={activate}
        aria-label={
          selectable
            ? `${selected ? 'Désélectionner' : 'Sélectionner'} ${survey.name}`
            : `Plus d'actions pour ${survey.name}`
        }
        className="flex min-h-[88px] w-full items-start gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <SurveyThumbnail survey={survey} size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text">{survey.name}</div>
          <div className="mt-0.5 text-[11px] text-muted">
            {formatDateShort(survey.createdAt)} · {survey.pointCount} point
            {survey.pointCount > 1 ? 's' : ''} · {survey.apCount} AP
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[12px] text-text">
              {survey.avgRssi === null ? '—' : `${Math.round(survey.avgRssi)} dBm`}
            </span>
            <QualityBadge quality={quality} />
          </div>
        </div>
        <span
          className={['pt-0.5 text-muted', selectable && 'invisible'].filter(Boolean).join(' ')}
          aria-hidden="true"
        >
          <EllipsisVertical className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </button>

      <div className="border-t border-glass-border-soft p-2">
        <button
          type="button"
          onClick={() => onHeatmap(survey)}
          className="btn-ghost h-8 w-full text-[12px]"
        >
          Ouvrir la heatmap
        </button>
      </div>
    </article>
  );
}
