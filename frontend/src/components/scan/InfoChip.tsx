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
      className="glass-fallback fixed left-3 z-[500] flex select-none flex-wrap items-center gap-x-2 gap-y-1 rounded-item border border-glass-border-soft bg-glass-bg-soft px-3 py-2 text-[12px] backdrop-blur-ui backdrop-saturate-150 shadow-glass-light"
      style={{
        top: 'var(--nav-top-offset)',
        maxWidth: 'calc(100% - 72px)',
      }}
    >
      <span className="max-w-[180px] truncate font-medium text-text">
        {planName ?? '—'}
      </span>
      <span className="text-muted">·</span>
      <span className="whitespace-nowrap font-mono text-[11px] text-text-dim">
        {pluralPoints(pointCount)}
      </span>
      {mode && (
        <>
          <span className="text-muted">·</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-text-dim">
            <span
              className={[
                'h-1.5 w-1.5 rounded-full',
                mode === 'live' ? 'bg-live' : 'bg-warn',
              ].join(' ')}
              aria-hidden
            />
            {mode === 'live' ? 'Mesures réelles' : 'Données simulées'}
          </span>
        </>
      )}
    </div>
  );
}
