import { pluralPoints } from '../../lib/format';

interface InfoChipProps {
  planName: string | null;
  pointCount: number;
}

export function InfoChip({ planName, pointCount }: InfoChipProps) {
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
    </div>
  );
}