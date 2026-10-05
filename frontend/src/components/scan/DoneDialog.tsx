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
      className="fixed inset-0 z-[600] flex items-center justify-center p-5 bg-black/50"
    >
      <div className="glass-fallback max-w-[380px] w-full p-6 rounded-card bg-glass-bg-soft border border-glass-border-soft backdrop-blur-ui backdrop-saturate-150 flex flex-col gap-3">
        <div id="doneTitle" className="text-lg font-medium">
          Scan terminé
        </div>
        <div className="text-sm text-text-dim">
          {pointCount} point{pointCount > 1 ? 's' : ''} enregistré
          {pointCount > 1 ? 's' : ''} sur le plan{' '}
          <em className="not-italic text-text font-medium">{planName}</em>.
        </div>
        <div className="flex gap-2 mt-2">
          <button
            ref={firstRef}
            type="button"
            onClick={onContinue}
            className="flex-1 inline-flex items-center justify-center h-12 rounded-item text-sm font-medium border border-glass-border-soft text-text bg-transparent hover:bg-glass-bg transition-colors duration-ui ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Continuer le scan
          </button>
          <button
            ref={lastRef}
            type="button"
            onClick={onSurveys}
            className="flex-1 inline-flex items-center justify-center h-12 rounded-item text-sm font-semibold bg-accent text-[#0b0f14] hover:bg-[#0ea472] transition-colors duration-ui ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Voir les surveys
          </button>
        </div>
      </div>
    </div>
  );
}