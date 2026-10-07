import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlanStore } from '../../hooks/usePlanStore';
import { Dropzone } from './Dropzone';
import { PreviewCard } from './PreviewCard';
import { PlanInfoCard } from './PlanInfoCard';
import { AccessPointsCard } from './AccessPointsCard';
import { Messages } from './Messages';

export function UploadPage() {
  const {
    plan,
    accessPoints,
    selectedApId,
    placing,
    loading,
    uploading,
    busy,
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

  const busyUI = loading || uploading;
  const [nameError, setNameError] = useState<string | null>(null);
  // Nom éditable localement, persisté côté backend avec anti-rebond.
  // Resynchronise pendant le rendu quand le plan actif change.
  const [nameDraft, setNameDraft] = useState('');
  const [prevPlanId, setPrevPlanId] = useState<string | null>(null);
  if ((plan?.id ?? null) !== prevPlanId) {
    setPrevPlanId(plan?.id ?? null);
    setNameDraft(plan?.name ?? '');
  }
  const planName = plan?.name;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!plan) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === planName) return;
    const timer = window.setTimeout(() => {
      renamePlan(trimmed);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [nameDraft, plan, planName, renamePlan]);

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

  const handlePlace = async (x: number, y: number) => {
    const ap = await addAp(x, y);
    stopPlacing();
    if (!ap) return;
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
    location.hash = '#/scan';
  };

  const handleReplace = () => {
    if (!busyUI) fileInputRef.current?.click();
  };

  const handleRemove = async () => {
    if (!plan || busy) return;
    const ok = window.confirm(
      `Supprimer le plan « ${plan.name} » ? Les relevés associés seront aussi supprimés.`
    );
    if (!ok) return;
    await clear();
  };

  if (loading) {
    return <div className="fixed inset-0 bg-bg" />;
  }

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

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 lg:gap-6 lg:items-start">
        <div className="flex flex-col gap-4">
          {!plan ? (
            <Dropzone
              onFile={loadFile}
              hasError={!!error}
              loading={uploading}
            />
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
              onMove={(id, x, y) => {
                updateAp(id, { x, y });
              }}
              onPlace={handlePlace}
              onReplace={handleReplace}
              onRemove={handleRemove}
            />
          )}

          <Messages
            error={error?.message ?? nameError}
            info={busy ? 'Enregistrement…' : info}
          />
        </div>

        <div className="flex flex-col gap-4 lg:max-w-90">
          <PlanInfoCard value={nameDraft} onChange={setNameDraft} />

          {plan && (
            <AccessPointsCard
              accessPoints={accessPoints}
              selectedApId={selectedApId}
              placing={placing}
              duplicateNames={duplicateNames}
              onTogglePlacing={togglePlacing}
              onSelect={selectAp}
              onChangeName={(id, name) => {
                updateAp(id, { name });
              }}
              onRemove={(id) => {
                removeAp(id);
              }}
            />
          )}

          <button
            type="button"
            disabled={!plan || busyUI}
            onClick={handleValidate}
            className={[
              'w-full h-12 rounded-[14px] bg-accent text-bg font-medium text-[15px] transition-opacity',
              (!plan || busyUI) && 'opacity-40 cursor-not-allowed',
              'hover:opacity-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            Valider le plan
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busyUI}
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
