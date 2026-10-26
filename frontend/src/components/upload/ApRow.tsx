import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AccessPoint } from '../../types/plan';
import { formatApCoords } from '../../lib/format';

interface ApRowProps {
  ap: AccessPoint;
  index: number;
  selected: boolean;
  hasDuplicateName: boolean;
  onSelect: (id: string) => void;
  onChangeName: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

export function ApRow({
  ap,
  index,
  selected,
  hasDuplicateName,
  onSelect,
  onChangeName,
  onRemove,
}: ApRowProps) {
  // Saisie locale : le backend n'est appelé qu'à la sortie du champ.
  // Resynchronise pendant le rendu quand le serveur confirme un nouveau nom.
  const [draft, setDraft] = useState(ap.name);
  const [prevName, setPrevName] = useState(ap.name);
  if (ap.name !== prevName) {
    setPrevName(ap.name);
    setDraft(ap.name);
  }

  const commit = () => {
    if (draft !== ap.name) onChangeName(ap.id, draft);
  };

  return (
    <div
      onClick={() => onSelect(ap.id)}
      className={[
        'flex items-center gap-2.5 p-2 rounded-xl border transition-colors duration-ui ease-ui cursor-pointer',
        selected
          ? 'border-accent-border bg-accent-soft'
          : 'border-transparent hover:bg-glass-bg',
      ].join(' ')}
    >
      <span className="shrink-0 w-7 h-7 rounded-full bg-accent text-[#0b0f14] font-mono text-[12px] font-semibold flex items-center justify-center">
        {String(index).padStart(2, '0')}
      </span>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <input
          type="text"
          value={draft}
          aria-label={`Nom de l'AP ${index}`}
          data-ap-input={ap.id}
          onClick={(e) => e.stopPropagation()}
          onFocus={() => onSelect(ap.id)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className={[
            'h-8 w-full px-2 rounded-lg text-[13px] text-text outline-none bg-[rgba(255,255,255,0.03)] border transition-colors duration-ui ease-ui',
            hasDuplicateName
              ? 'border-danger focus:shadow-[0_0_0_2px_var(--danger-soft)]'
              : 'border-transparent focus:border-accent focus:bg-[rgba(255,255,255,0.05)]',
          ].join(' ')}
        />
        <div className="pl-2 font-mono text-[12px] text-text-dim">
          {formatApCoords(ap.x, ap.y)}
        </div>
      </div>

      <button
        type="button"
        aria-label={`Supprimer ${ap.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(ap.id);
        }}
        className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-[10px] text-text-dim hover:text-danger hover:bg-danger-soft transition-colors duration-ui ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}