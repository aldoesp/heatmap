import { useEffect, useRef } from 'react';
import {
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
  onHeatmap: (s: SurveySummary) => void;
  onViewPoints: (s: SurveySummary) => void;
  onRename: (s: SurveySummary) => void;
  onExport: (s: SurveySummary) => void;
  onDelete: (s: SurveySummary) => void;
};

export function SurveySheet({
  survey,
  onClose,
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
    { Icon: Map, label: 'Ouvrir la heatmap', run: () => onHeatmap(survey) },
    { Icon: Table, label: 'Voir les points', run: () => onViewPoints(survey) },
    { Icon: Pencil, label: 'Renommer', run: () => onRename(survey) },
    { Icon: Download, label: 'Exporter en CSV', run: () => onExport(survey) },
    { Icon: Trash, label: 'Supprimer', danger: true, run: () => onDelete(survey) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60 md:items-center md:justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Actions pour ${survey.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-panel border border-glass-border-soft bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 shadow-glass p-3 pb-5 md:max-w-md md:rounded-panel"
      >
        <div
          className="mx-auto mb-3 h-1 w-9 rounded-full bg-glass-border md:hidden"
          aria-hidden="true"
        />
        <div className="px-2 pb-2">
          <div className="truncate text-sm font-medium text-text">{survey.name}</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">
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
                   'flex min-h-11 w-full items-center gap-3 rounded-item px-2 text-sm transition-colors duration-ui ease-ui hover:bg-glass-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                   danger ? 'text-danger' : 'text-text',
                 ].join(' ')}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
