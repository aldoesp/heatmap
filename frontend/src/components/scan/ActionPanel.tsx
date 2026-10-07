import { Check, Undo2, Wifi, LocateFixed } from 'lucide-react';

interface ActionPanelProps {
  hint: string;
  hasPin: boolean;
  canScan: boolean;
  canUndo: boolean;
  canDone: boolean;
  scanConfirmed: boolean;
  onScan: () => void;
  onUndo: () => void;
  onDone: () => void;
  onRecenter: () => void;
}

export function ActionPanel({
  hint,
  hasPin,
  canScan,
  canUndo,
  canDone,
  scanConfirmed,
  onScan,
  onUndo,
  onDone,
  onRecenter,
}: ActionPanelProps) {
  return (
    <div
      className="glass-fallback fixed z-[500] flex flex-col gap-2.5 p-2.5 rounded-bar bg-glass-bg-soft border border-glass-border-soft backdrop-blur-ui backdrop-saturate-150"
      style={{
        bottom: 'var(--nav-bottom-offset)',
        left: 12,
        right: 12,
      }}
      data-desktop-panel
    >
      <div
        aria-live="polite"
        className={[
          'text-[13px] text-center min-h-[20px] transition-colors duration-ui ease-ui',
          hasPin ? 'text-text font-mono' : 'text-text-dim',
        ].join(' ')}
      >
        {hint}
      </div>

      <div className="flex items-center gap-1.5 h-12">
        <button
          type="button"
          aria-disabled={!canUndo}
          onClick={canUndo ? onUndo : undefined}
          className={[
            'inline-flex items-center justify-center gap-1.5 h-12 px-4 rounded-item text-sm font-medium border border-glass-border-soft text-text bg-transparent',
            'hover:bg-glass-bg active:bg-white/[0.08] transition-colors duration-ui ease-ui',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            !canUndo && 'opacity-40 cursor-not-allowed',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Undo2 size={18} strokeWidth={1.75} aria-hidden />
          <span>Annuler</span>
        </button>

        <button
          type="button"
          aria-label="Recentrer la carte sur le plan"
          title="Recentrer la carte sur le plan"
          onClick={onRecenter}
          className={[
            'inline-flex items-center justify-center h-12 w-12 shrink-0 rounded-item text-sm font-medium border border-glass-border-soft text-text bg-transparent',
            'hover:bg-glass-bg active:bg-white/[0.08] transition-colors duration-ui ease-ui',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          ].join(' ')}
        >
          <LocateFixed size={18} strokeWidth={1.75} aria-hidden />
        </button>

        <button
          type="button"
          aria-disabled={!canScan}
          onClick={canScan ? onScan : undefined}
          className={[
            'flex-1 inline-flex items-center justify-center gap-1.5 h-12 rounded-item text-sm font-semibold bg-accent text-[#0b0f14]',
            'hover:bg-[#0ea472] transition-colors duration-ui ease-ui',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            !canScan && 'opacity-40 cursor-not-allowed hover:bg-accent',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {scanConfirmed ? (
            <>
              <Check size={18} strokeWidth={2.2} aria-hidden />
              <span>Enregistré</span>
            </>
          ) : (
            <>
              <Wifi size={18} strokeWidth={2} aria-hidden />
              <span>Scan</span>
            </>
          )}
        </button>

        <button
          type="button"
          aria-disabled={!canDone}
          onClick={canDone ? onDone : undefined}
          className={[
            'inline-flex items-center justify-center h-12 px-4 rounded-item text-sm font-medium border border-glass-border-soft text-text bg-transparent',
            'hover:bg-glass-bg active:bg-white/[0.08] transition-colors duration-ui ease-ui',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            !canDone && 'opacity-40 cursor-not-allowed',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span>Terminer</span>
        </button>
      </div>
    </div>
  );
}