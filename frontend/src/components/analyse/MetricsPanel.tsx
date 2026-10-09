import {
  METRICS,
  VERDICT_META,
  verdictLabel,
  type AnalyseMetricId,
  type VerdictsByMetric,
} from './analyseData';

interface MetricsPanelProps {
  active: AnalyseMetricId | null;
  verdicts: VerdictsByMetric;
  onSelect: (id: AnalyseMetricId) => void;
}

const ACTIVE_BTN =
  'bg-accent-soft border-accent-border text-accent hover:bg-accent-soft hover:text-accent';
const IDLE_BTN =
  'bg-transparent border-glass-border-soft text-text-dim hover:bg-glass-bg hover:text-text';

const VERDICT_DOT: Record<string, string> = {
  bon: 'bg-[#10b981]',
  moyen: 'bg-[#f59e0b]',
  mauvais: 'bg-[#f87171]',
};

/**
 * Colonne droite 280px : un seul bouton actif à la fois (aria-pressed).
 * Affiche le verdict global à côté de chaque métrique une fois choisi.
 */
export function MetricsPanel({ active, verdicts, onSelect }: MetricsPanelProps) {
  return (
    <aside
      aria-label="Métriques d'analyse"
      className="glass-fallback w-full lg:w-[280px] lg:shrink-0 bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 border border-glass-border-soft shadow-glass-light rounded-card p-3"
    >
      <h2 className="text-[13px] font-medium text-text-dim px-1 mb-2">Métriques</h2>
      <ul className="flex flex-col gap-2 list-none m-0 p-0">
        {METRICS.map(({ id, label }) => {
          const isActive = active === id;
          const verdict = verdicts[id];
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelect(id)}
                className={[
                  'w-full min-h-[44px] h-12 inline-flex items-center justify-between gap-2 px-4 rounded-item border text-sm font-medium',
                  'transition-colors duration-ui ease-ui',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  isActive ? ACTIVE_BTN : IDLE_BTN,
                ].join(' ')}
              >
                <span>{label}</span>
                {verdict ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <span aria-hidden className={`w-2 h-2 rounded-full ${VERDICT_DOT[verdict]}`} />
                    <span>{verdictLabel(verdict)}</span>
                  </span>
                ) : (
                  <span aria-hidden className="font-mono text-xs opacity-60">
                    {isActive ? '●' : '○'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export { VERDICT_META };
