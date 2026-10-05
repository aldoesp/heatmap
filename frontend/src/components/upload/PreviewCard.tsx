import { useRef } from 'react';
import type { AccessPoint } from '../../types/plan';
import { formatBytes } from '../../lib/format';
import { ApMarker } from './ApMarker';

interface PreviewCardProps {
  imageUrl: string;
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  accessPoints: AccessPoint[];
  selectedApId: string | null;
  placing: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPlace: (x: number, y: number) => void;
  onReplace: () => void;
  onRemove: () => void;
}

export function PreviewCard({
  imageUrl,
  fileName,
  width,
  height,
  sizeBytes,
  accessPoints,
  selectedApId,
  placing,
  onSelect,
  onMove,
  onPlace,
  onReplace,
  onRemove,
}: PreviewCardProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!placing || !imgRef.current || !frameRef.current) return;
    const imgRect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - imgRect.left) / imgRect.width;
    const y = (e.clientY - imgRect.top) / imgRect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onPlace(x, y);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={frameRef}
        onClick={handleClick}
        className={[
          'relative bg-bg rounded-2xl overflow-hidden',
          'flex items-center justify-center',
          placing && 'cursor-crosshair',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Aperçu du plan"
          draggable={false}
          className="block max-w-full max-h-[60vh] object-contain select-none pointer-events-none"
        />
        {accessPoints.map((ap, i) => (
          <ApMarker
            key={ap.id}
            ap={ap}
            index={i + 1}
            selected={selectedApId === ap.id}
            frameRef={imgRef}
            onSelect={onSelect}
            onMove={onMove}
          />
        ))}
      </div>

      <div className="glass-fallback flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 bg-glass-bg-soft border border-glass-border-soft rounded-xl shadow-glass-light">
        <div className="font-mono text-[12px] text-text-dim truncate">
          {fileName} · {width}×{height} · {formatBytes(sizeBytes)}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onReplace}
            className="inline-flex items-center h-9 px-3 rounded-[10px] text-[13px] font-medium text-text-dim border border-glass-border bg-transparent hover:text-text hover:bg-glass-bg transition-colors duration-ui ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Remplacer
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center h-9 px-3 rounded-[10px] text-[13px] font-medium text-text-dim border border-glass-border bg-transparent hover:text-text hover:bg-glass-bg transition-colors duration-ui ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}