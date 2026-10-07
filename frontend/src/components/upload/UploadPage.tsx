import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlanStore } from '../../hooks/usePlanStore';
import { DEMO_PLANS } from '../../lib/demoPlans';
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
    loadDemoPlan,
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
    <div className="max-w-300 mx-auto px-4 pt-6 pb-28 md:pb-8 lg:px-6 lg:py-8">
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
            <>
              <Dropzone
                onFile={loadFile}
                hasError={!!error}
                loading={uploading}
              />
              <div className="glass-fallback bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 border border-glass-border-soft shadow-glass-light rounded-card p-4 lg:p-5">
                <div className="text-sm font-medium mb-1">Plans de démo</div>
                <p className="text-[13px] text-text-dim mb-3">
                  Pas d’image sous la main ? Touche un plan pour l’importer
                  directement (même validation, même nommage).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO_PLANS.map((demo) => (
                    <button
                      key={demo.fileName}
                      type="button"
                      disabled={uploading}
                      onClick={() => loadDemoPlan(demo)}
                      className="flex flex-col gap-1.5 p-2 rounded-xl border border-glass-border-soft bg-[rgba(255,255,255,0.03)] text-left transition-opacity hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-40 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      <img
                        src={demo.url}
                        alt={demo.label}
                        className="block w-full h-24 object-cover rounded-lg pointer-events-none"
                      />
                      <span className="text-[12px] font-medium text-text truncate">
                        {demo.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
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
              // Sur mobile, la validation passe par la barre fixe ci-dessous
              'hidden md:block',
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

      {/* Barre de validation fixe (mobile uniquement) : le bouton reste
          atteignable sans scroller, au-dessus de la navigation basse. */}
      {plan && (
        <div className="md:hidden fixed z-40 left-3 right-3 bottom-[calc(88px+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={busyUI}
            onClick={handleValidate}
            className={[
              'w-full h-12 rounded-[14px] bg-accent text-bg font-medium text-[15px] shadow-glass transition-opacity',
              busyUI && 'opacity-40 cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            Valider le plan
          </button>
        </div>
      )}
    </div>
  );
}
