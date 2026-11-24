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
  onChangeBssids: (id: string, bssids: string[]) => void;
  onRemove: (id: string) => void;
}

export function ApRow({
  ap,
  index,
  selected,
  hasDuplicateName,
  onSelect,
  onChangeName,
  onChangeBssids,
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

  const [bssidDraft, setBssidDraft] = useState(ap.bssids.join(', '));
  const [prevBssids, setPrevBssids] = useState(ap.bssids.join(', '));
  if (ap.bssids.join(', ') !== prevBssids) {
    setPrevBssids(ap.bssids.join(', '));
    setBssidDraft(ap.bssids.join(', '));
  }

  const commit = () => {
    if (draft !== ap.name) onChangeName(ap.id, draft);
  };

  const commitBssids = () => {
    const parsed = bssidDraft
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unique = [...new Set(parsed)];
    const current = ap.bssids.join(', ');
    if (unique.join(', ') !== current) onChangeBssids(ap.id, unique);
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
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[11px] font-semibold text-bg">
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
            'h-8 w-full rounded-md border bg-glass-bg-soft px-2 text-[13px] text-text outline-none transition-colors duration-ui ease-ui focus:border-accent',
            hasDuplicateName ? 'border-danger' : 'border-glass-border',
          ].join(' ')}
        />
        <div className="pl-2 font-mono text-[11px] text-text-dim">
          {formatApCoords(ap.x, ap.y)}
        </div>
        <input
          type="text"
          value={bssidDraft}
          aria-label={`BSSID de l'AP ${index}`}
          onClick={(e) => e.stopPropagation()}
          onFocus={() => onSelect(ap.id)}
          onChange={(e) => setBssidDraft(e.target.value)}
          onBlur={commitBssids}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="h-8 w-full rounded-md border border-glass-border bg-glass-bg-soft px-2 font-mono text-[11px] text-text outline-none transition-colors duration-ui ease-ui focus:border-accent"
        />
      </div>

      <button
        type="button"
        aria-label={`Supprimer ${ap.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(ap.id);
        }}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-item text-text-dim transition-colors duration-ui ease-ui hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}