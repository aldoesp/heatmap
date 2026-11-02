import { EllipsisVertical } from 'lucide-react';
import { QualityBadge } from './QualityBadge';
import { SurveyThumbnail } from './SurveyThumbnail';
import { formatDateShort, qualityFromRssi } from '../../lib/signal';
import type { SurveySummary } from '../../hooks/useSurveysLibrary';

type Props = {
  survey: SurveySummary;
  busy: boolean;
  onOpenMenu: (survey: SurveySummary) => void;
  onAnalyse: (survey: SurveySummary) => void;
  onHeatmap: (survey: SurveySummary) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (survey: SurveySummary) => void;
};

export function SurveyCard({
  survey,
  busy,
  onOpenMenu,
  onAnalyse,
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
        'relative rounded-[14px] bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] overflow-hidden',
        selected && 'ring-1 ring-accent-border',
        busy && 'opacity-55 pointer-events-none',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {selectable && (
        <label className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#0b1017]/85">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect?.(survey)}
            aria-label={`Sélectionner ${survey.name}`}
            className="h-5 w-5 accent-[#34d399]"
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
        className="w-full text-left p-3 flex gap-3 items-start min-h-[88px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <SurveyThumbnail survey={survey} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-text truncate">{survey.name}</div>
          <div className="text-[12px] text-text-dim mt-0.5">
            {formatDateShort(survey.createdAt)} · {survey.pointCount} point
            {survey.pointCount > 1 ? 's' : ''} · {survey.apCount} AP
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[13px] text-text">
              {survey.avgRssi === null ? '—' : `${Math.round(survey.avgRssi)} dBm`}
            </span>
            <QualityBadge quality={quality} />
          </div>
        </div>
        <span
          className={['text-text-dim pt-1', selectable && 'invisible'].filter(Boolean).join(' ')}
          aria-hidden="true"
        >
          <EllipsisVertical className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </span>
      </button>

      <div className="h-px bg-[rgba(255,255,255,0.08)]" aria-hidden="true" />

      <div className="p-2 flex gap-2">
        <button
          type="button"
          onClick={() => onAnalyse(survey)}
          className="flex-1 inline-flex items-center justify-center min-h-[34px] rounded-[10px] border border-accent-border text-[#34d399] text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Analyser
        </button>
        <button
          type="button"
          onClick={() => onHeatmap(survey)}
          className="flex-1 inline-flex items-center justify-center min-h-[34px] rounded-[10px] border border-glass-border-soft text-text-dim text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Heatmap
        </button>
      </div>
    </article>
  );
}
