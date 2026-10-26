import { useRef, useState } from 'react';
import { Loader2, Upload as UploadIcon } from 'lucide-react';

interface DropzoneProps {
  onFile: (file: File) => void;
  hasError: boolean;
  loading: boolean;
}

export function Dropzone({ onFile, hasError, loading }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragover, setDragover] = useState(false);

  const open = () => {
    if (loading) return;
    inputRef.current?.click();
  };

  return (
    <div
      aria-busy={loading}
      onDragEnter={(e) => {
        e.preventDefault();
        if (loading) return;
        setDragover(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (loading) return;
        setDragover(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragover(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragover(false);
        if (loading) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={[
        'glass-fallback relative flex flex-col items-center justify-center gap-2.5',
        'min-h-60 px-5 py-8 text-center',
        'rounded-card border-[1.5px] border-dashed',
        'backdrop-blur-ui backdrop-saturate-150',
        'transition-colors duration-ui ease-ui',
        'bg-glass-bg-soft border-glass-border-soft shadow-glass-light',
        dragover && !loading && 'border-accent bg-accent-soft',
        hasError && !loading && 'border-danger',
        loading && 'cursor-wait opacity-90',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Sélectionner une image"
        disabled={loading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />

      {loading ? (
        <>
          <Loader2
            className="w-8 h-8 text-accent animate-spin"
            strokeWidth={1.75}
            aria-hidden
          />
          <div className="text-[15px] font-medium text-text">
            Envoi en cours…
          </div>
          <div className="text-[13px] text-text-dim">
            Ne ferme pas la page.
          </div>
        </>
      ) : (
        <>
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
              <button
                type="button"
                disabled={loading}
                onClick={open}
                className="cursor-pointer underline underline-offset-[3px] disabled:cursor-wait"
              >
                ou parcours tes fichiers
              </button>
            </div>
          </div>

          <div className="text-[13px] text-text-dim">
            JPG, PNG ou WebP · 10 Mo max
          </div>
        </>
      )}
    </div>
  );
}