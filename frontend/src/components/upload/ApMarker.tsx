import { useCallback, useRef } from 'react';
import type { AccessPoint } from '../../types/plan';

interface ApMarkerProps {
  ap: AccessPoint;
  index: number;
  selected: boolean;
  frameRef: React.RefObject<HTMLElement | null>;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}

export function ApMarker({
  ap,
  index,
  selected,
  frameRef,
  onSelect,
  onMove,
}: ApMarkerProps) {
  const dragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      dragging.current = true;
      onSelect(ap.id);

      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();

      const move = (ev: PointerEvent) => {
        const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        onMove(ap.id, x, y);
      };

      const up = (ev: PointerEvent) => {
        dragging.current = false;
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };

      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    },
    [ap.id, frameRef, onMove, onSelect]
  );

  return (
    <button
      type="button"
      aria-label={`${ap.name}, position ${Math.round(ap.x * 100)} % ${Math.round(
        ap.y * 100
      )} %`}
      onPointerDown={handlePointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(ap.id);
      }}
      style={{ left: `${ap.x * 100}%`, top: `${ap.y * 100}%` }}
      className={[
        'absolute -ml-5.5 -mt-5.5 w-11 h-11',
        'flex items-center justify-center',
        'bg-transparent border-0 p-0 touch-none z-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-full',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none w-7 h-7 rounded-full',
          'flex items-center justify-center',
          'bg-accent border-2 border-bg text-[#0b0f14]',
          'font-mono text-[12px] font-semibold',
          'transition-shadow duration-ui ease-ui',
          selected && 'shadow-[0_0_0_6px_var(--color-accent-soft)]',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {String(index).padStart(2, '0')}
      </span>
    </button>
  );
}