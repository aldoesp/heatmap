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
    const yFromTop = (e.clientY - imgRect.top) / imgRect.height;
    if (x < 0 || x > 1 || yFromTop < 0 || yFromTop > 1) return;
    const y = 1 - yFromTop;
    onPlace(x, y);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={frameRef}
        onClick={handleClick}
        className={[
          'relative flex items-center justify-center overflow-hidden surface p-2',
          placing && 'cursor-crosshair',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* L'image est servie par le backend via imageUrl (URL serveur) */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Aperçu du plan"
          draggable={false}
          className="block max-w-full max-h-[40vh] lg:max-h-[60vh] object-contain select-none pointer-events-none"
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

      <div className="surface flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0 truncate font-mono text-[11px] text-text-dim">
          {fileName} · {width}×{height} · {formatBytes(sizeBytes)}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onReplace}
            className="btn-ghost h-9 px-3 text-[13px]"
          >
            Remplacer
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="btn-ghost h-9 px-3 text-[13px] hover:text-danger"
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}