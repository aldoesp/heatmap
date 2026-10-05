import { useRef, useState } from 'react';
import { Upload as UploadIcon } from 'lucide-react';

interface DropzoneProps {
  onFile: (file: File) => void;
  hasError: boolean;
}

export function Dropzone({ onFile, hasError }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragover, setDragover] = useState(false);

  const open = () => inputRef.current?.click();

  return (
    <label
      tabIndex={0}
      aria-label="Importer un plan"
      onClick={(e) => {
        e.preventDefault();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragover(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragover(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragover(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragover(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={[
        // Base
        'glass-fallback relative flex flex-col items-center justify-center gap-2.5',
        'min-h-[240px] px-5 py-8 text-center cursor-pointer',
        'rounded-card border-[1.5px] border-dashed',
        'backdrop-blur-ui backdrop-saturate-150',
        'transition-colors duration-ui ease-ui',
        // Variante 3 — Soft : fond plus dense, bordure atténuée
        'bg-glass-bg-soft border-glass-border-soft shadow-glass-light',
        // États
        dragover && 'border-accent bg-accent-soft',
        hasError && 'border-danger',
        // Focus
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />

      <UploadIcon
        className={[
          'w-8 h-8 transition-transform duration-ui ease-ui',
          hasError ? 'text-danger' : 'text-accent',
          dragover && 'scale-[1.08]',
        ]
          .filter(Boolean)
          .join(' ')}
        strokeWidth={1.75}
        aria-hidden
      />

      <div>
        <div
          className={[
            'text-[15px] font-medium',
            hasError ? 'text-danger' : 'text-text',
          ].join(' ')}
        >
          Glisse ton plan ici
        </div>
        <div
          className={[
            'text-sm underline underline-offset-[3px]',
            hasError ? 'text-danger' : 'text-accent',
          ].join(' ')}
        >
          ou parcours tes fichiers
        </div>
      </div>

      <div className="text-[13px] text-text-dim">JPG, PNG ou WebP · 10 Mo max</div>
    </label>
  );
}