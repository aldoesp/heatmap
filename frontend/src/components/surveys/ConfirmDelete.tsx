import { useEffect } from 'react';

type Props = {
  surveyName: string;
  pointCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
};

export function ConfirmDelete({ surveyName, pointCount, onCancel, onConfirm, busy }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Supprimer ${surveyName} ?`}
        className="w-full max-w-sm rounded-[16px] bg-[#121821] border-[0.5px] border-[rgba(255,255,255,0.08)] p-4"
      >
        <h2 className="text-[15px] font-medium text-text mb-2">Supprimer ce survey ?</h2>
        <p className="text-[13px] text-text-dim mb-4">
          Ses {pointCount} point{pointCount > 1 ? 's' : ''} seront supprimés. Cette action est
          définitive.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 h-11 rounded-[12px] border border-glass-border-soft text-text text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 h-11 rounded-[12px] bg-danger text-white text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {busy ? '…' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}
