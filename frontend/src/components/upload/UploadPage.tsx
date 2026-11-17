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
  const exampleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading || plan) return;
    const showExamples = () => {
      const query = new URLSearchParams(window.location.hash.split('?')[1]);
      if (query.get('example') !== '1') return;
      exampleRef.current?.scrollIntoView({ block: 'center' });
      exampleRef.current?.focus({ preventScroll: true });
    };
    showExamples();
    window.addEventListener('hashchange', showExamples);
    return () => window.removeEventListener('hashchange', showExamples);
  }, [loading, plan]);

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
    return <div role="status" className="mx-auto max-w-[1320px] px-4 py-12 text-sm text-text-dim">Chargement de ton plan…</div>;
  }

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-48 pt-8 md:px-6 md:pb-12">
      <nav aria-label="Étapes du relevé" className="mb-6">
        <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <li><a href="#/upload" aria-current="step" className="font-medium text-accent no-underline">1. Plan</a></li>
          <li>{plan ? <a href="#/scan" className="text-text-dim hover:text-text">2. Mesures</a> : <span className="text-muted">2. Mesures</span>}</li>
          <li>{plan ? <a href="#/heatmap" className="text-text-dim hover:text-text">3. Couverture</a> : <span className="text-muted">3. Couverture</span>}</li>
        </ol>
      </nav>
      <div className="mb-8">
        <p className="label mb-2">Plan</p>
        <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em]">
          Plan du site
        </h1>
        <p className="mt-1.5 max-w-prose text-sm text-text-dim">
          {plan ? `Plan actif : ${plan.name}. Tu peux poursuivre les mesures ou préparer le plan ci-dessous.` : 'Une photo ou une capture d’écran du plan suffit.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          {!plan ? (
            <>
              <Dropzone
                onFile={loadFile}
                hasError={!!error}
                loading={uploading}
              />
              <div id="plan-examples" ref={exampleRef} tabIndex={-1} aria-labelledby="plan-examples-title" className="surface scroll-mt-20 p-4 lg:p-5">
                <h2 id="plan-examples-title" className="mb-1 text-sm font-medium">Choisis un plan d’exemple</h2>
                <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-text-dim">
                  Importe un exemple pour découvrir le parcours. Le mode de mesure se choisit dans les paramètres.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {DEMO_PLANS.map((demo) => (
                    <button
                      key={demo.fileName}
                      type="button"
                      disabled={uploading}
                      onClick={() => loadDemoPlan(demo)}
                      className="flex flex-col gap-2 rounded-item border border-glass-border-soft bg-glass-bg-soft p-2 text-left backdrop-blur-ui backdrop-saturate-150 transition-colors duration-ui ease-ui hover:border-glass-border hover:bg-glass-bg disabled:cursor-wait disabled:opacity-40"
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
          {plan && <PlanInfoCard value={nameDraft} onChange={setNameDraft} />}

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
              onChangeBssids={(id, bssids) => {
                updateAp(id, { bssids });
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
            className="btn-primary hidden h-12 w-full text-[15px] md:inline-flex"
          >
            Commencer les mesures
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
            className="btn-primary h-12 w-full text-[15px]"
          >
            Commencer les mesures
          </button>
        </div>
      )}
    </div>
  );
}
