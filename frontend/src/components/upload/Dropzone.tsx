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
        'relative flex flex-col items-center justify-center gap-3',
        'min-h-60 px-6 py-10 text-center',
        'rounded-panel border border-dashed',
        'backdrop-blur-ui backdrop-saturate-150 shadow-glass-light',
        'transition-colors duration-ui ease-ui',
        dragover && !loading
          ? 'border-accent bg-accent-soft text-accent'
          : hasError && !loading
            ? 'border-danger bg-glass-bg-soft'
            : 'border-glass-border-soft bg-glass-bg-soft',
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
            className="h-7 w-7 animate-spin text-accent"
            strokeWidth={1.75}
            aria-hidden
          />
          <div className="text-sm font-medium text-text">Envoi en cours…</div>
          <div className="text-[13px] text-text-dim">Ne ferme pas la page.</div>
        </>
      ) : (
        <>
          <span
            className={[
              'mb-1 grid h-11 w-11 place-items-center rounded-full border',
              hasError
                ? 'border-danger/40 bg-danger-soft text-danger'
                : 'border-glass-border bg-glass-bg-soft text-accent',
            ].join(' ')}
          >
            <UploadIcon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>

          <div>
            <div
              className={[
                'text-sm font-medium',
                hasError ? 'text-danger' : 'text-text',
              ].join(' ')}
            >
              Glisse ton plan ici
            </div>
            <div className="mt-1 text-[13px] text-text-dim">
              <button
                type="button"
                disabled={loading}
                onClick={open}
                className="cursor-pointer text-accent underline decoration-accent/40 underline-offset-4 transition-colors duration-ui ease-ui hover:decoration-accent disabled:cursor-wait"
              >
                ou parcours tes fichiers
              </button>
            </div>
          </div>

          <div className="mt-1 font-mono text-[11px] text-text-dim">
            JPG, PNG ou WebP · 10 Mo max
          </div>
        </>
      )}
    </div>
  );
}