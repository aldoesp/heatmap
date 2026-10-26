import { useEffect, useRef } from 'react';
import {
  Activity,
  Download,
  Map,
  Pencil,
  Table,
  Trash,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SurveySummary } from '../../hooks/useSurveysLibrary';

type Props = {
  survey: SurveySummary;
  onClose: () => void;
  onAnalyse: (s: SurveySummary) => void;
  onHeatmap: (s: SurveySummary) => void;
  onViewPoints: (s: SurveySummary) => void;
  onRename: (s: SurveySummary) => void;
  onExport: (s: SurveySummary) => void;
  onDelete: (s: SurveySummary) => void;
};

export function SurveySheet({
  survey,
  onClose,
  onAnalyse,
  onHeatmap,
  onViewPoints,
  onRename,
  onExport,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  /* Échap ferme ; Tab reste piégé dans le sheet. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = ref.current;
      if (!el) return;
      const focusables = el.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('button, [href], input')
      ?.focus();
  }, []);

  const actions: Array<{ Icon: LucideIcon; label: string; danger?: boolean; run: () => void }> = [
    { Icon: Activity, label: 'Ouvrir dans Analyse', run: () => onAnalyse(survey) },
    { Icon: Map, label: 'Ouvrir dans Heatmap', run: () => onHeatmap(survey) },
    { Icon: Table, label: 'Voir les points', run: () => onViewPoints(survey) },
    { Icon: Pencil, label: 'Renommer', run: () => onRename(survey) },
    { Icon: Download, label: 'Exporter en CSV', run: () => onExport(survey) },
    { Icon: Trash, label: 'Supprimer', danger: true, run: () => onDelete(survey) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center md:justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Actions pour ${survey.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-md rounded-t-[18px] md:rounded-[18px] bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] p-3 pb-5"
      >
        <div
          className="w-9 h-1 rounded-full bg-[rgba(255,255,255,0.15)] mx-auto mb-3 md:hidden"
          aria-hidden="true"
        />
        <div className="px-2 pb-2">
          <div className="text-[15px] font-medium text-text truncate">{survey.name}</div>
          <div className="text-[12px] text-text-dim">
            {survey.pointCount} point{survey.pointCount > 1 ? 's' : ''} · importé le{' '}
            {new Date(survey.createdAt).toLocaleDateString('fr-FR')}
          </div>
        </div>

        <ul className="flex flex-col">
          {actions.map(({ Icon, label, danger, run }) => (
            <li key={label}>
              <button
                type="button"
                onClick={run}
                className={[
                  'w-full min-h-11 px-2 flex items-center gap-3 text-[14px] rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  danger ? 'text-danger' : 'text-text',
                ].join(' ')}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
