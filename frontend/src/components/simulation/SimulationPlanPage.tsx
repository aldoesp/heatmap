import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { SignalLegend } from './SignalLegend';
import { SimulatedOverlay } from './SimulatedOverlay';
import { SimulatorControls } from './SimulatorControls';
import { calibratePlan, createSimulationScenario, deleteSimulationScenario, listAccessPoints, listPlans, listSimulationScenarios, resetSimulationScenario, updateSimulationScenario } from '../../lib/api';
import { resolveAntenna } from '../../lib/antennas';
import { DEFAULT_COLOR_STOPS, createDefaultConfig } from '../../lib/defaults';
import { effectiveResolutionM } from '../../lib/heatmap';
import { computeMetersPerPixel, normalizedToMetersPoint, simulationSurfaceOf } from '../../lib/planScale';
import { peakEirpDbm } from '../../lib/radioPropagation';
import type { PlanResponse, SimulationScenario } from '../../types/api';
import type { AccessPoint } from '../../types/plan';
import type { ColorStop, Point, RadioParams, SimulatorConfig, Surface } from '../../types/wifi';

/**
 * Valeurs radio PAR DÉFAUT de la simulation sur plan.
 * Les AP réels ne portent aucune config radio en base : au lieu d'inventer
 * des valeurs, la copie démarre avec ces réglages explicites et modifiables
 * dans le panneau radio — documentés dans le rapport d'audit.
 */
const SIM_DEFAULT_RADIO: RadioParams = createDefaultConfig().radio;

const SIM_DEFAULT_RESOLUTION_M = 0.2;
/** Résolution réduite (donc rapide) pendant le drag, recalcul fin au relâchement. */
const DRAG_RESOLUTION_M = 0.5;

const btn =
  'rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-40 disabled:cursor-not-allowed';
const btnDanger =
  'rounded-md border border-red-800 bg-red-900/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-900/70 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-40 disabled:cursor-not-allowed';
const inputCls =
  'w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400';

/** Reconstruit des RadioParams validés depuis le JSON du scénario. */
function coerceRadio(raw: unknown): RadioParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const frequencyMHz = num(r.frequencyMHz);
  const txPowerDbm = num(r.txPowerDbm);
  if (
    frequencyMHz !== 2400 &&
    frequencyMHz !== 5000 &&
    frequencyMHz !== 6000
  ) {
    return null;
  }
  if (txPowerDbm === null) return null;
  if (r.model !== 'fspl' && r.model !== 'log-distance') return null;
  if (r.antennaId !== 'isotropic' && r.antennaId !== 'u7-pro-xgs') return null;
  return {
    frequencyMHz,
    txPowerDbm,
    antennaId: r.antennaId,
    apRotationDeg: num(r.apRotationDeg) ?? 0,
    apHeightM: num(r.apHeightM) ?? SIM_DEFAULT_RADIO.apHeightM,
    rxHeightM: num(r.rxHeightM) ?? 1,
    rxGainDbi: num(r.rxGainDbi) ?? 0,
    model: r.model,
    pathLossExponent: num(r.pathLossExponent) ?? 2,
    referenceDistanceM: num(r.referenceDistanceM) ?? 1,
    minDistanceM: num(r.minDistanceM) ?? 0.1,
  };
}

interface SimMarkerProps {
  /** Position normalisée (y = 0 en bas). */
  x: number;
  y: number;
  label: string;
  dragging: boolean;
  onGrab: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}

/** Marqueur de l'AP simulé : veine violette, distinct de l'AP réel (vert). */
function SimMarker({ x, y, label, dragging, onGrab }: SimMarkerProps) {
  return (
    <button
      type="button"
      aria-label={`${label}, position ${Math.round(x * 100)} % ${Math.round(y * 100)} % — glissez pour déplacer`}
      onPointerDown={onGrab}
      style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }}
      className={[
        'absolute z-20 -ml-4 -mt-4 h-8 w-8 touch-none select-none',
        'flex items-center justify-center rounded-full border-2',
        dragging
          ? 'border-white bg-violet-400 shadow-[0_0_0_6px_rgba(167,139,250,0.4)]'
          : 'border-white bg-violet-600/90 shadow-[0_0_0_3px_rgba(139,92,246,0.35)]',
        'cursor-grab active:cursor-grabbing',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
      ].join(' ')}
    >
      <span className="font-mono text-[10px] font-bold text-white">SIM</span>
    </button>
  );
}

/** Petit point de calibrage posé par l'utilisateur (repère l'échelle). */
function CalibrationDot({ xPct, yPct, n }: { xPct: number; yPct: number; n: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
      className="absolute z-20 -ml-2 -mt-2 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-sky-500 font-mono text-[9px] font-bold text-white"
    >
      {n}
    </span>
  );
}

export function SimulationPlanPage() {
  /* ---------------------------------------------------------------- plans */
  const [plans, setPlans] = useState<PlanResponse[] | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planId, setPlanId] = useState('');

  const plan = useMemo(
    () => plans?.find((p) => p.id === planId) ?? null,
    [plans, planId],
  );
  const surface: Surface | null = useMemo(
    () => simulationSurfaceOf(plan),
    [plan],
  );

  useEffect(() => {
    let cancelled = false;
    listPlans()
      .then((result) => {
        if (!cancelled) setPlans(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setPlansError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPlan = useCallback((updated: PlanResponse) => {
    setPlans((prev) =>
      prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev,
    );
  }, []);

  /* ----------------------------------------------------------------- APs  */
  const [aps, setAps] = useState<AccessPoint[]>([]);
  const [sourceApId, setSourceApId] = useState('');
  const sourceAp = aps.find((a) => a.id === sourceApId) ?? null;

  /* ----------------------------------------------------------- scénarios  */
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [scenario, setScenario] = useState<SimulationScenario | null>(null);
  const [name, setName] = useState('');
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [radio, setRadio] = useState<RadioParams>(SIM_DEFAULT_RADIO);
  const [resolutionM, setResolutionM] = useState(SIM_DEFAULT_RESOLUTION_M);
  const [colorStops, setColorStops] = useState<ColorStop[]>(
    DEFAULT_COLOR_STOPS.map((s) => ({ ...s })),
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [computeMs, setComputeMs] = useState<number | null>(null);

  /* --------------------------------------------------------- calibration  */
  const [calibPoints, setCalibPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [calibDistance, setCalibDistance] = useState('');
  const [calibError, setCalibError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const selectPlan = useCallback((nextId: string) => {
    setPlanId(nextId);
    setSourceApId('');
    setScenario(null);
    setScenarios([]);
    setAps([]);
    setCurrent(null);
    setCalibPoints([]);
    setCalibDistance('');
    setCalibError(null);
    setPageError(null);
    if (!nextId) return;
    let cancelled = false;
    Promise.all([listAccessPoints(nextId), listSimulationScenarios(nextId)])
      .then(([apList, scenarioList]) => {
        if (cancelled) return;
        setAps(apList);
        setScenarios(scenarioList);
        if (apList.length > 0) setSourceApId(apList[0].id);
      })
      .catch((e: Error) => {
        if (!cancelled) setPageError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePlanImageClick = (e: ReactMouseEvent<HTMLImageElement>) => {
    if (!plan || surface) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * plan.width;
    const py = ((e.clientY - rect.top) / rect.height) * plan.height;
    setCalibError(null);
    setCalibPoints((prev) => {
      const next = [...prev, { x: px, y: py }];
      return next.length > 2 ? [next[next.length - 1]] : next;
    });
  };

  const handleCalibrate = async () => {
    if (!plan || calibPoints.length < 2) return;
    const distance = Number.parseFloat(calibDistance.replace(',', '.'));
    const [a, b] = calibPoints;
    const mpp = computeMetersPerPixel(a.x, a.y, b.x, b.y, distance);
    if (mpp === null) {
      setCalibError(
        'Points confondus, distance invalide ou échelle aberrante. ' +
          'Choisissez deux points distincts (≥ 5 px) et une distance de 0,1 à 1000 m.',
      );
      return;
    }
    setBusy('calibration');
    setCalibError(null);
    setPageError(null);
    try {
      const updated = await calibratePlan(plan.id, mpp);
      refreshPlan(updated);
      setCalibPoints([]);
      setCalibDistance('');
    } catch (e) {
      setCalibError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /* --------------------------------------------------- gestion scénario   */
  const loadScenario = (s: SimulationScenario) => {
    const parsed = coerceRadio(s.radio);
    if (!parsed) {
      setPageError('Scénario illisible : paramètres radio invalides.');
      return;
    }
    setScenario(s);
    setName(s.name);
    setCurrent(s.current);
    setRadio(parsed);
    setPageError(null);
  };

  const handleCreateScenario = async () => {
    if (!plan || !sourceAp || !surface) return;
    setBusy('création');
    setPageError(null);
    try {
      const created = await createSimulationScenario({
        plan_id: plan.id,
        sourceAccessPointId: sourceAp.id,
        name: name.trim() || `Copie de ${sourceAp.name}`,
        radio: SIM_DEFAULT_RADIO,
      });
      setScenarios((prev) => [...prev, created]);
      loadScenario(created);
    } catch (e) {
      setPageError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    if (!scenario || !current) return;
    setBusy('sauvegarde');
    setPageError(null);
    try {
      const saved = await updateSimulationScenario(scenario.id, {
        name: name.trim() || scenario.name,
        currentX: current.x,
        currentY: current.y,
        radio,
      });
      setScenarios((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      setScenario(saved);
    } catch (e) {
      setPageError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleScenarioReset = async () => {
    if (!scenario) return;
    setBusy('réinitialisation');
    setPageError(null);
    try {
      const restored = await resetSimulationScenario(scenario.id);
      setScenarios((prev) => prev.map((s) => (s.id === restored.id ? restored : s)));
      loadScenario(restored);
    } catch (e) {
      setPageError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteScenario = async () => {
    if (!scenario) return;
    setBusy('suppression');
    setPageError(null);
    try {
      await deleteSimulationScenario(scenario.id);
      setScenarios((prev) => prev.filter((s) => s.id !== scenario.id));
      setScenario(null);
      setCurrent(null);
    } catch (e) {
      setPageError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /* --------------------------------------------------------------- drag   */
  const frameRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const rafCleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => rafCleanup, [rafCleanup]);

  const flushPending = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) setCurrent(p);
  }, []);

  const clampNormalized = (x: number, y: number) => ({
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  });

  const moveHandler = (ev: PointerEvent) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const pos = clampNormalized(
      (ev.clientX - rect.left) / rect.width,
      (ev.clientY - rect.top) / rect.height,
    );
    pendingRef.current = pos;
    if (rafRef.current === null) {
      // Max 1 recalcul par frame écran ; l'état précédent reste affiché.
      rafRef.current = requestAnimationFrame(flushPending);
    }
  };

  const handleMarkerGrab = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);

    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      if (rafRef.current !== null) {
        // Dernier point posé -> recalcul fin immédiat.
        flushPending();
      }
      setDragging(false);
      el.removeEventListener('pointermove', moveHandler);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };

    el.addEventListener('pointermove', moveHandler);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  /* ------------------------------------------------------ config simu     */
  const config: SimulatorConfig | null = useMemo(() => {
    if (!surface) return null;
    return {
      surface,
      resolutionM,
      radio,
      colorStops,
    };
  }, [surface, resolutionM, radio, colorStops]);

  const onConfigChange = useCallback((next: SimulatorConfig) => {
    // La surface vient de la calibration : on ignore toute modification ici.
    setResolutionM(next.resolutionM);
    setRadio(next.radio);
    setColorStops(next.colorStops);
  }, []);

  const onPatchDefaults = useCallback((defaults: SimulatorConfig) => {
    setResolutionM(defaults.resolutionM);
    setRadio(defaults.radio);
    setColorStops(defaults.colorStops);
  }, []);

  // Grille : résolution dégradée pendant le drag, fine au repos.
  const activeResolution = useMemo(
    () => (dragging ? Math.max(DRAG_RESOLUTION_M, resolutionM) : resolutionM),
    [dragging, resolutionM],
  );

  const apMeters: Point | null = useMemo(
    () => (current && surface ? normalizedToMetersPoint(current.x, current.y, surface) : null),
    [current, surface],
  );

  // Marqueurs de calibration, en % de l'image
  const calibPct = calibPoints.map((p) =>
    plan ? { x: (p.x / plan.width) * 100, y: (p.y / plan.height) * 100 } : null,
  );

  const dirtyNow =
    scenario !== null &&
    current !== null &&
    (Math.abs(current.x - scenario.current.x) > 1e-6 ||
      Math.abs(current.y - scenario.current.y) > 1e-6 ||
      JSON.stringify(radio) !== JSON.stringify(scenario.radio));

  /* --------------------------------------------------------------- vue    */
  return (
    <div className="min-h-screen bg-slate-950 p-4 pb-24 text-slate-100 md:pb-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Simulation sur plan</h2>
          <p className="text-sm text-slate-400">
            Copie déplaçable d'un AP réel, RSSI prédit en direct.
          </p>
        </div>
        {scenario && (
          <div className="flex items-center gap-2">
            {dirtyNow && (
              <span className="rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-200">
                Modifications non enregistrées
              </span>
            )}
            <button type="button" className={btn} onClick={handleSave} disabled={busy === 'sauvegarde'}>
              {busy === 'sauvegarde' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button type="button" className={btn} onClick={handleScenarioReset} disabled={busy === 'réinitialisation'}>
              {busy === 'réinitialisation' ? '…' : 'Réinitialiser'}
            </button>
            <button type="button" className={btnDanger} onClick={handleDeleteScenario} disabled={busy === 'suppression'}>
              {busy === 'suppression' ? '…' : 'Supprimer'}
            </button>
          </div>
        )}
      </header>

      <p
        role="note"
        className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
      >
        Résultats simulés : aucune mesure réelle n'est modifiée. Le modèle
        ignore les murs, obstacles, réflexions et interférences ; le heatmap
        mesuré (page Heatmap) n'est pas remplacé.
      </p>

      {pageError && (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {pageError}
        </p>
      )}

      {/* Sélection du plan */}
      <section className="mb-4 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
        <label htmlFor="plan-select" className="mb-1 block text-sm text-slate-300">
          Plan
        </label>
        <select
          id="plan-select"
          className={`${inputCls} max-w-sm`}
          value={planId}
          onChange={(e) => selectPlan(e.target.value)}
        >
          <option value="">— Choisir un plan —</option>
          {plans?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.metersPerPixel ? ' (calibré)' : ' (non calibré)'}
            </option>
          ))}
        </select>
        {plansError && <p className="mt-2 text-xs text-red-300">{plansError}</p>}
      </section>

      {!plan && (
        <p className="text-sm text-slate-400">
          Sélectionnez un plan au-dessus pour commencer.
        </p>
      )}

      {plan && !surface && (
        /* --- Calibration de l'échelle (mètres/pixel) ------------------- */
        <section
          aria-label="Calibration du plan"
          className="mb-4 rounded-lg border border-sky-700/60 bg-slate-800/60 p-4"
        >
          <h3 className="text-md font-medium">Calibration du plan</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Cliquez un premier point connu sur le plan (pastille 1).</li>
            <li>Cliquez le second point (pastille 2) : utilisez des points distants.</li>
            <li>Saisissez la distance réelle entre les deux, en mètres.</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Distance réelle (m)"
              aria-label="Distance réelle entre les deux points, en mètres"
              className={`${inputCls} max-w-[12rem]`}
              value={calibDistance}
              onChange={(e) => setCalibDistance(e.target.value)}
            />
            <button
              type="button"
              className={btn}
              onClick={handleCalibrate}
              disabled={busy === 'calibration' || calibPoints.length < 2}
            >
              {busy === 'calibration' ? 'Enregistrement…' : 'Calibrer le plan'}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => setCalibPoints([])}
              disabled={calibPoints.length === 0}
            >
              Recommencer
            </button>
            <span className="text-xs text-slate-400">
              {calibPoints.length === 0
                ? 'Cliquez le point 1 sur le plan.'
                : calibPoints.length === 1
                  ? 'Cliquez le point 2.'
                  : 'Distance en m puis « Calibrer ».'}
            </span>
          </div>
          {calibError && (
            <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
              {calibError}
            </p>
          )}
          <div className="relative mt-3 overflow-hidden rounded border border-slate-700">
            <img
              ref={imageRef}
              src={plan.imageUrl}
              alt={`Plan ${plan.name}`}
              className="block w-full cursor-crosshair touch-none select-none"
              onClick={handlePlanImageClick}
            />
            {calibPct[0] && <CalibrationDot xPct={calibPct[0].x} yPct={calibPct[0].y} n={1} />}
            {calibPct[1] && <CalibrationDot xPct={calibPct[1].x} yPct={calibPct[1].y} n={2} />}
          </div>
        </section>
      )}

      {plan && surface && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ------------------------- Colonne plan + overlay -------------- */}
          <div className="space-y-3">
            {aps.length === 0 ? (
              <p className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-300">
                Aucun AP réel sur ce plan. Ajoutez d'abord un point d'accès dans
                la page Relevés / Upload, puis revenez ici.
              </p>
            ) : (
              <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                <label htmlFor="ap-select" className="mb-1 block text-sm text-slate-300">
                  AP réel à copier
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="ap-select"
                    className={`${inputCls} max-w-xs`}
                    value={sourceApId}
                    onChange={(e) => setSourceApId(e.target.value)}
                    disabled={scenario !== null}
                  >
                    {aps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={btn}
                    onClick={handleCreateScenario}
                    disabled={scenario !== null || busy === 'création' || !sourceAp}
                  >
                    {busy === 'création' ? 'Création…' : 'Créer la copie de simulation'}
                  </button>
                  {scenarios.length > 0 && (
                    <select
                      aria-label="Charger un scénario enregistré"
                      className={`${inputCls} max-w-xs`}
                      value={scenario?.id ?? ''}
                      onChange={(e) => {
                        const next = scenarios.find((s) => s.id === e.target.value);
                        if (next) loadScenario(next);
                      }}
                    >
                      <option value="">— Charger un scénario —</option>
                      {scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  La copie démarre sur la position réelle de l'AP avec les
                  paramètres radio par défaut de la simulation (2,4 GHz…
                  modifiables ci-contre). L'AP réel n'est jamais modifié.
                </p>
              </section>
            )}

            {scenario && current && surface && config && (
              <div
                ref={frameRef}
                className="relative select-none overflow-hidden rounded-lg border border-slate-700"
                style={{ touchAction: 'none' }}
              >
                <img
                  src={plan.imageUrl}
                  alt={`Plan ${plan.name} avec heatmap simulé`}
                  draggable={false}
                  className="block w-full"
                />
                <SimulatedOverlay
                  surface={surface}
                  resolution={activeResolution}
                  ap={apMeters!}
                  radio={radio}
                  colorStops={colorStops}
                  onComputeTiming={setComputeMs}
                />
                {/* Position réelle de l'AP source (repère) */}
                {sourceAp && (
                  <span
                    aria-label={`AP réel ${sourceAp.name}`}
                    style={{ left: `${sourceAp.x * 100}%`, top: `${(1 - sourceAp.y) * 100}%` }}
                    className="pointer-events-none absolute z-10 -ml-3 -mt-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white/80 bg-slate-950/70 font-mono text-[10px] text-emerald-300"
                  >
                    R
                  </span>
                )}
                <SimMarker
                  x={current.x}
                  y={current.y}
                  label={scenario.name}
                  dragging={dragging}
                  onGrab={handleMarkerGrab}
                />
              </div>
            )}

            {scenario && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>
                  Résolution : {activeResolution.toLocaleString('fr-FR')} m/cellule
                  {effectiveResolutionM(surface!, activeResolution) >
                    activeResolution + 1e-9 &&
                    ` (effective ${effectiveResolutionM(surface!, activeResolution)
                      .toFixed(2)
                      .replace('.', ',')} m)`}
                  .
                </span>
                {computeMs !== null && (
                  <span>Dernier calcul de grille : {computeMs.toFixed(1).replace('.', ',')} ms.</span>
                )}
                <span>Glissez le marqueur violet « SIM » ; le recomptage suit chaque frame.</span>
              </div>
            )}

            {scenario && (
              <SignalLegend colorStops={colorStops} />
            )}
          </div>

          {/* ------------------------- Colonne paramètres ------------------ */}
          {config && (
            <aside className="space-y-3">
              <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                <label htmlFor="scenario-name" className="mb-1 block text-sm text-slate-300">
                  Nom du scénario
                </label>
                <input
                  id="scenario-name"
                  type="text"
                  className={inputCls}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                  placeholder="Copie de AP…"
                />
              </div>
              <SimulatorControls
                config={config}
                effectiveResolutionM={effectiveResolutionM(surface!, activeResolution)}
                peakEirpDbm={peakEirpDbm(radio, resolveAntenna(radio.antennaId, radio.frequencyMHz))}
                onConfigChange={onConfigChange}
                onReset={() => onPatchDefaults(createDefaultConfig())}
                disableSurfaceEditing
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

