import { useEffect, useRef } from 'react';

interface DoneDialogProps {
  open: boolean;
  planName: string;
  pointCount: number;
  onContinue: () => void;
  onSurveys: () => void;
}

export function DoneDialog({
  open,
  planName,
  pointCount,
  onContinue,
  onSurveys,
}: DoneDialogProps) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const lastRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;
    firstRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onContinue();
        return;
      }
      if (e.key !== 'Tab') return;
      const first = firstRef.current;
      const last = lastRef.current;
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      lastFocused.current?.focus();
    };
  }, [open, onContinue]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="doneTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onContinue();
      }}
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/60 p-5"
    >
      <div className="glass-fallback flex w-full max-w-[400px] flex-col gap-3 rounded-panel border border-glass-border-soft bg-glass-bg-soft p-6 backdrop-blur-ui backdrop-saturate-150 shadow-glass">
        <div id="doneTitle" className="text-base font-medium">
          Mesures enregistrées
        </div>
        <div className="text-sm leading-relaxed text-text-dim">
          {pointCount} point{pointCount > 1 ? 's' : ''} enregistré
          {pointCount > 1 ? 's' : ''} sur le plan{' '}
          <em className="font-medium not-italic text-text">{planName}</em>.
        </div>
        <div className="mt-2 flex gap-2">
          <button
            ref={firstRef}
            type="button"
            onClick={onContinue}
            className="btn-secondary h-11 flex-1"
          >
            Continuer
          </button>
          <button
            ref={lastRef}
            type="button"
            onClick={onSurveys}
            className="btn-primary h-11 flex-1"
          >
            Voir la couverture
          </button>
        </div>
      </div>
    </div>
  );
}