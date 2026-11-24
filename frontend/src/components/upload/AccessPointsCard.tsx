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
  onChangeBssids: (id: string, bssids: string[]) => void;
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
  onChangeBssids,
  onRemove,
}: AccessPointsCardProps) {
  return (
    <div className="surface p-4 lg:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Points d’accès</span>
        <span className="font-mono text-xs text-text-dim">
          Optionnel
        </span>
      </div>

      <button
        type="button"
        onClick={onTogglePlacing}
        aria-pressed={placing}
        className={[
          'inline-flex h-11 w-full items-center justify-center gap-2 rounded-item border text-sm font-medium transition-colors duration-ui ease-ui',
          placing
            ? 'border-accent-border bg-accent-soft text-accent'
            : 'border-glass-border-soft bg-glass-bg-soft text-text backdrop-blur-ui backdrop-saturate-150 hover:border-glass-border hover:bg-glass-bg',
        ].join(' ')}
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        <span>{placing ? "Touche le plan pour placer l'AP" : 'Ajouter un AP'}</span>
      </button>

      {accessPoints.length === 0 ? (
        <div className="mt-3 text-[13px] leading-relaxed text-text-dim">
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
              onChangeBssids={onChangeBssids}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}