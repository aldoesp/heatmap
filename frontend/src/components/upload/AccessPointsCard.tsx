import { Plus } from 'lucide-react';
import type { AccessPoint } from '../../types/plan';
import { ApRow } from './ApRow';

interface AccessPointsCardProps {
  accessPoints: AccessPoint[];
  selectedApId: string | null;
  placing: boolean;
  duplicateNames: Set<string>;
  onTogglePlacing: () => void;
  onSelect: (id: string | null) => void;
  onChangeName: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

export function AccessPointsCard({
  accessPoints,
  selectedApId,
  placing,
  duplicateNames,
  onTogglePlacing,
  onSelect,
  onChangeName,
  onRemove,
}: AccessPointsCardProps) {
  return (
    <div className="glass-fallback bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 border border-glass-border-soft shadow-glass-light rounded-card p-4 lg:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-medium">Points d'accès</span>
        <span className="text-[11px] text-text-dim">Optionnel</span>
      </div>

      <button
        type="button"
        onClick={onTogglePlacing}
        aria-pressed={placing}
        className={[
          'w-full h-11 inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium border transition-colors duration-ui ease-ui',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          placing
            ? 'bg-accent-soft border-accent-border text-accent'
            : 'bg-glass-bg border-glass-border text-text hover:bg-[rgba(255,255,255,0.08)]',
        ].join(' ')}
      >
        <Plus className="w-4 h-4" strokeWidth={2} aria-hidden />
        <span>{placing ? "Touche le plan pour placer l'AP" : 'Ajouter un AP'}</span>
      </button>

      {accessPoints.length === 0 ? (
        <div className="mt-2 text-[13px] text-text-dim">
          Aucun AP placé. Tu peux continuer sans.
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {accessPoints.map((ap, i) => (
            <ApRow
              key={ap.id}
              ap={ap}
              index={i + 1}
              selected={selectedApId === ap.id}
              hasDuplicateName={duplicateNames.has(ap.name.trim())}
              onSelect={(id) => onSelect(id)}
              onChangeName={onChangeName}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}