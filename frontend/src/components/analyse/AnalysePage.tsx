import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  VERDICT_META,
  averageCanal,
  initialCells,
  initialVerdicts,
  type AnalyseMetricId,
  type AnalyseCell,
  type MetricVerdict,
  type Verdict,
  type VerdictsByMetric,
} from './analyseData';
import { MetricsPanel } from './MetricsPanel';
import { formatPercent } from '../../lib/format';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-300 mx-auto px-4 pt-6 pb-48 md:pb-8 lg:px-6 lg:py-8">
      {children}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="self-start inline-flex items-center gap-2 min-h-[44px] h-11 px-4 rounded-item border border-glass-border-soft text-text text-sm font-medium bg-transparent hover:bg-glass-bg transition-colors duration-ui ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
      <span>Centre</span>
    </button>
  );
}

/** Cellule consultable : sélection = consultation des infos, pas de verdict. */
function CellButton({
  cell,
  index,
  selected,
  onSelect,
}: {
  cell: AnalyseCell;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Cellule ${index + 1}, ${cell.rssi} dBm, X ${formatPercent(cell.x)}, Y ${formatPercent(cell.y)}, ${cell.bssid}`}
      onClick={onSelect}
      className={[
        'min-h-[88px] min-w-[44px] flex flex-col items-start justify-center gap-1 p-3 rounded-item border text-left',
        'transition-colors duration-ui ease-ui',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        selected
          ? 'bg-accent-soft border-accent-border'
          : 'bg-[rgba(255,255,255,0.03)] border-glass-border-soft hover:bg-[rgba(255,255,255,0.06)]',
      ].join(' ')}
    >
      <span className="font-mono text-[15px] font-semibold text-text">
        {cell.rssi} dBm
      </span>
      <span className="font-mono text-xs text-text-dim">
        X {formatPercent(cell.x)} · Y {formatPercent(cell.y)}
      </span>
      <span className="font-mono text-[11px] text-text-dim truncate max-w-full">
        {cell.bssid}
      </span>
    </button>
  );
}

/**
 * Sélecteur de verdict global : interprétation de TOUTES les mesures
 * de la grille, un seul choix à la fois (couleur + libellé).
 */
function VerdictSelector({
  value,
  legend,
  onChange,
}: {
  value: Verdict;
  legend: string;
  onChange: (v: Exclude<Verdict, null>) => void;
}) {
  return (
    <div
      role="group"
      aria-label={legend}
      className="flex flex-wrap gap-2"
    >
      {VERDICT_META.map(({ id, label, dot }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={[
              'inline-flex items-center gap-2 min-h-[44px] h-12 px-4 rounded-item border text-sm font-medium',
              'transition-colors duration-ui ease-ui',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              active
                ? 'bg-accent-soft border-accent-border text-accent'
                : 'bg-transparent border-glass-border-soft text-text hover:bg-glass-bg',
            ].join(' ')}
          >
            <span aria-hidden className={`w-2.5 h-2.5 rounded-full ${dot}`} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const METRIC_LABEL: Record<AnalyseMetricId, string> = {
  rssi: 'RSSI',
  bssid: 'BSSID',
  canal: 'Canal',
  position: 'Position X/Y',
};

export function AnalysePage() {
  // Écran 1 : metric === null (centre). Écran 2 : metric !== null.
  const [metric, setMetric] = useState<AnalyseMetricId | null>(null);
  // Grille : consultation seule, pas de résultat par cellule.
  const [cells] = useState<AnalyseCell[]>(initialCells);
  const [selectedCell, setSelectedCell] = useState(0);
  // Verdict global stocké par métrique (un seul choix à la fois).
  const [verdicts, setVerdicts] = useState<VerdictsByMetric>(initialVerdicts);

  const selected = cells[selectedCell];
  const canalMoyen = useMemo(() => averageCanal(cells), [cells]);

  // État courant au format demandé : { metrique, verdict }.
  const current: MetricVerdict | null =
    metric === null ? null : { metrique: metric, verdict: verdicts[metric] };

  const handleVerdict = (v: Exclude<Verdict, null>) => {
    if (metric === null) return;
    const id = metric;
    setVerdicts((prev) => ({ ...prev, [id]: v }));
  };

  /* ---------- Écran 1 : Centre d'analyse ---------- */
  if (metric === null) {
    return (
      <Shell>
        <div className="mb-6">
          <h1 className="text-[22px] font-medium tracking-tight mb-1">
            Centre d&apos;analyse
          </h1>
          <p className="text-text-dim text-sm">
            Choisis une métrique pour ouvrir sa grille d&apos;analyse.
          </p>
        </div>
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
          <section
            aria-label="Panneau principal"
            className="glass-fallback flex-1 min-h-[320px] flex flex-col items-center justify-center gap-2 bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 border border-glass-border-soft shadow-glass-light rounded-card p-6 text-center"
          >
            <p className="text-text text-[15px]">Aucune analyse sélectionnée</p>
            <p className="text-text-dim text-sm">
              Sélectionne une métrique dans la colonne de droite.
            </p>
          </section>
          <MetricsPanel active={null} verdicts={verdicts} onSelect={setMetric} />
        </div>
      </Shell>
    );
  }

  /* ---------- Écran 2 générique (BSSID / Canal / Position) ---------- */
  if (metric !== 'rssi') {
    const label = METRIC_LABEL[metric];
    return (
      <Shell>
        <div className="mb-6 flex flex-col gap-3">
          <BackButton onBack={() => setMetric(null)} />
          <h1 className="text-[22px] font-medium tracking-tight">
            Analyse {label}
          </h1>
          <p className="text-text-dim text-sm">
            Donne un verdict global pour l&apos;ensemble des mesures {label}.
          </p>
        </div>
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
          <section
            aria-label={`Panneau ${label}`}
            className="glass-fallback flex-1 min-h-[320px] flex flex-col items-start justify-center gap-4 bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 border border-glass-border-soft shadow-glass-light rounded-card p-4 sm:p-5"
          >
            <p className="text-text-dim text-sm">
              Aucune donnée {label} pour l&apos;instant.
            </p>
            {current && (
              <VerdictSelector
                value={current.verdict}
                legend={`Verdict global ${label}`}
                onChange={handleVerdict}
              />
            )}
          </section>
          <MetricsPanel active={metric} verdicts={verdicts} onSelect={setMetric} />
        </div>
      </Shell>
    );
  }

  /* ---------- Écran 2 : Grille d'analyse RSSI ---------- */
  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-3">
        <BackButton onBack={() => setMetric(null)} />
        <h1 className="text-[22px] font-medium tracking-tight mb-1">
          Analyse RSSI
        </h1>
        <p className="text-text-dim text-sm">
          Sélectionne une cellule pour consulter ses infos, puis donne un verdict
          global pour l&apos;ensemble de la grille.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
        <section
          aria-label="Grille d'analyse RSSI"
          className="glass-fallback flex-1 bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 border border-glass-border-soft shadow-glass-light rounded-card p-3 sm:p-4"
        >
          <div
            role="group"
            aria-label="Grille 3 par 3 des cellules RSSI"
            className="grid grid-cols-3 gap-2"
          >
            {cells.map((cell, i) => (
              <CellButton
                key={cell.bssid}
                cell={cell}
                index={i}
                selected={i === selectedCell}
                onSelect={() => setSelectedCell(i)}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            {current && (
              <VerdictSelector
                value={current.verdict}
                legend="Verdict global de la grille RSSI"
                onChange={handleVerdict}
              />
            )}
            {selected && (
              <p aria-live="polite" className="text-[13px] text-text-dim sm:ml-auto font-mono">
                Canal {selected.canal} ({selected.bssid}) · canal moyen {canalMoyen}
              </p>
            )}
          </div>
        </section>

        <MetricsPanel active="rssi" verdicts={verdicts} onSelect={setMetric} />
      </div>
    </Shell>
  );
}
