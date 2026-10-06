import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlanStore } from '../../hooks/usePlanStore';
import type { LoadError } from '../../hooks/usePlanStore';
import { Dropzone } from './Dropzone';
import { PreviewCard } from './PreviewCard';
import { PlanInfoCard } from './PlanInfoCard';
import { AccessPointsCard } from './AccessPointsCard';
import { Messages } from './Messages';

const ERROR_MESSAGES: Record<LoadError, string> = {
  format: "Ce format n'est pas supporté. Utilise un JPG, PNG ou WebP.",
  size: 'Cette image dépasse 10 Mo. Choisis-en une plus légère.',
  unreadable: 'Impossible de lire cette image. Réessaie avec un autre fichier.',
};

export function UploadPage() {
  const {
    plan,
    accessPoints,
    selectedApId,
    placing,
    error,
    info,
    loadFile,
    clear,
    renamePlan,
    addAp,
    updateAp,
    removeAp,
    selectAp,
    togglePlacing,
    stopPlacing,
  } = usePlanStore();

  const [nameError, setNameError] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!window.location.hash.includes('?test=1')) return;

    const loadTestData = async () => {
      setTestLoading(true);
      try {
        const response = await fetch('/api/v1/scan/test-data');
        if (!response.ok) {
          throw new Error(`La requête a échoué (${response.status}).`);
        }
        setTestResult(JSON.stringify(await response.json(), null, 2));
      } catch (error) {
        setTestError(
          error instanceof Error ? error.message : 'Impossible de charger les données de test.'
        );
      } finally {
        setTestLoading(false);
      }
    };

    void loadTestData();
  }, []);

  const duplicateNames = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    accessPoints.forEach((ap) => {
      const key = ap.name.trim();
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    });
    return dupes;
  }, [accessPoints]);

  const handlePlace = (x: number, y: number) => {
    const ap = addAp(x, y);
    stopPlacing();
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-ap-input="${ap.id}"]`
      );
      input?.focus();
      input?.select();
    });
  };

  const handleValidate = () => {
    if (!plan) {
      setNameError("Importe d'abord un plan.");
      return;
    }
    if (duplicateNames.size > 0) {
      setNameError('Ce nom est déjà utilisé.');
      return;
    }
    setNameError(null);
    // Persistance déjà automatique via useEffect dans le store.
    location.hash = '#/scan';
  };

  const handleReplace = () => fileInputRef.current?.click();

  const errorMessage = error ? ERROR_MESSAGES[error] : null;

  return (
    <div className="max-w-300 mx-auto px-4 py-6 lg:px-6 lg:py-8">
      <div className="mb-6">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">
          Plan du site
        </h1>
        <p className="text-text-dim text-sm">
          Importe une photo ou une capture de ton plan.
        </p>
      </div>

      {(testLoading || testResult !== null || testError !== null) && (
        <section className="mb-6" aria-labelledby="test-result-title">
          <h2 id="test-result-title" className="text-sm font-medium mb-2">
            Résultat du test (JSON)
          </h2>
          {testLoading ? (
            <p role="status" className="text-sm text-text-dim">
              Chargement des données de test…
            </p>
          ) : testError ? (
            <p role="alert" className="text-sm text-danger">
              Impossible de charger le résultat du test : {testError}
            </p>
          ) : (
            <textarea
              aria-label="Résultat du test au format JSON"
              readOnly
              value={testResult ?? ''}
              rows={12}
              className="w-full rounded-[14px] border border-glass-border-soft bg-glass-bg-soft p-3 font-mono text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 lg:gap-6 lg:items-start">
        {/* Colonne principale */}
        <div className="flex flex-col gap-4">
          {!plan ? (
            <Dropzone onFile={loadFile} hasError={!!error} />
          ) : (
            <PreviewCard
              imageUrl={plan.imageUrl}
              fileName={plan.fileName}
              width={plan.width}
              height={plan.height}
              sizeBytes={plan.sizeBytes}
              accessPoints={accessPoints}
              selectedApId={selectedApId}
              placing={placing}
              onSelect={selectAp}
              onMove={(id, x, y) => updateAp(id, { x, y })}
              onPlace={handlePlace}
              onReplace={handleReplace}
              onRemove={clear}
            />
          )}

          <Messages error={errorMessage ?? nameError} info={info} />
        </div>

        {/* Colonne latérale */}
        <div className="flex flex-col gap-4 lg:max-w-90">
          <PlanInfoCard
            value={plan?.name ?? ''}
            onChange={renamePlan}
          />

          {plan && (
            <AccessPointsCard
              accessPoints={accessPoints}
              selectedApId={selectedApId}
              placing={placing}
              duplicateNames={duplicateNames}
              onTogglePlacing={togglePlacing}
              onSelect={selectAp}
              onChangeName={(id, name) => updateAp(id, { name })}
              onRemove={removeAp}
            />
          )}

          <button
            type="button"
            aria-disabled={!plan}
            onClick={handleValidate}
            className={[
              'w-full h-12 rounded-[14px] bg-accent text-[#0b0f14] font-medium text-[15px] transition-opacity',
              !plan && 'opacity-40 cursor-not-allowed',
              'hover:opacity-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            Valider le plan
          </button>

          {/* Input caché pour "Remplacer" */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}