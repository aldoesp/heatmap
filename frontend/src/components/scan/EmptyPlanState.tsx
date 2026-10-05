interface EmptyPlanStateProps {
  onImport: () => void;
}

export function EmptyPlanState({ onImport }: EmptyPlanStateProps) {
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-5 bg-bg">
      <div className="glass-fallback max-w-[380px] w-full p-6 rounded-card bg-glass-bg-soft border border-glass-border-soft backdrop-blur-ui backdrop-saturate-150 flex flex-col gap-3 text-center">
        <div className="text-lg font-medium">Aucun plan importé</div>
        <div className="text-sm text-text-dim">
          Importe une photo de ton plan pour commencer le scan.
        </div>
        <button
          type="button"
          onClick={onImport}
          className="mt-1 w-full h-12 rounded-[14px] bg-accent text-[#0b0f14] font-medium text-[15px] hover:bg-[#0ea472] transition-colors duration-ui ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Importer un plan
        </button>
      </div>
    </div>
  );
}