interface PlanInfoCardProps {
  value: string;
  onChange: (v: string) => void;
}

export function PlanInfoCard({ value, onChange }: PlanInfoCardProps) {
  return (
    <div className="glass-fallback bg-glass-bg-soft backdrop-blur-ui backdrop-saturate-150 border border-glass-border-soft shadow-glass-light rounded-card p-4 lg:p-5">
      <div className="text-sm font-medium mb-3">Informations du plan</div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="planName"
          className="text-xs text-text-dim font-medium"
        >
          Nom du plan
        </label>
        <input
          id="planName"
          type="text"
          autoComplete="off"
          placeholder="Rez-de-chaussée"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 px-3 bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-xl text-sm text-text outline-none transition-colors duration-ui ease-ui focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-soft)]"
        />
      </div>
    </div>
  );
}