interface EmptyPlanStateProps {
  onImport: () => void;
}

export function EmptyPlanState({ onImport }: EmptyPlanStateProps) {
  return (
    <div className="flex min-h-[calc(100svh-56px)] items-center justify-center bg-bg px-4 pt-8 pb-28 md:pb-8">
      <div className="glass-fallback flex w-full max-w-[440px] flex-col gap-4 rounded-panel border border-glass-border-soft bg-glass-bg-soft p-6 text-center backdrop-blur-ui backdrop-saturate-150 shadow-glass">
        <h1 className="text-2xl font-medium">Découvre ta couverture Wi-Fi</h1>
        <div className="text-sm leading-relaxed text-text-dim">
          Commence avec une photo ou une capture de ton plan.
        </div>
        <ol className="my-2 space-y-4 text-left text-sm">
          {[
            ['Prépare ton plan', 'Importe l’image du lieu à explorer.'],
            ['Prends des mesures', 'Indique ta position sur le plan à chaque arrêt.'],
            ['Comprends ta couverture', 'Repère les zones où le signal est faible.'],
          ].map(([title, description], index) => (
            <li key={title} className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">{index + 1}</span>
              <div><span className="font-medium text-text">{title}</span><p className="mt-1 leading-relaxed text-text-dim">{description}</p></div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onImport}
          className="btn-primary mt-1 h-11 w-full"
        >
          Importer mon plan
        </button>
        <a href="#/upload?example=1" className="btn-secondary h-11 w-full no-underline">Essayer un exemple</a>
      </div>
    </div>
  );
}
