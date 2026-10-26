import { pluralPoints } from '../../lib/format';

interface InfoChipProps {
  planName: string | null;
  pointCount: number;
  mode: 'live' | 'test' | null;
}

export function InfoChip({ planName, pointCount, mode }: InfoChipProps) {
  return (
    <div
      aria-live="polite"
      className="glass-fallback fixed z-[500] pointer-events-none select-none flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-[14px] bg-glass-bg-soft border border-glass-border-soft backdrop-blur-ui backdrop-saturate-150"
      style={{
        top: 'var(--nav-top-offset)',
        left: 12,
        maxWidth: 'calc(100% - 72px)',
      }}
    >
      <span className="font-medium text-text truncate max-w-[160px]">
        {planName ?? '—'}
      </span>
      <span className="text-text-dim">·</span>
      <span className="text-text-dim">{pluralPoints(pointCount)}</span>
      {mode && (
        <>
          <span className="text-text-dim">·</span>
          <span
            className={[
              'px-1.5 py-0.5 rounded-md text-[10px] font-semibold border',
              mode === 'live'
                ? 'bg-accent-soft border-accent-border text-accent'
                : 'bg-white/[0.04] border-white/10 text-text-dim',
            ].join(' ')}
          >
            {mode === 'live' ? 'Réel' : 'Test'}
          </span>
        </>
      )}
    </div>
  );
}