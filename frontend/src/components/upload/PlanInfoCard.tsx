interface PlanInfoCardProps {
  value: string;
  onChange: (v: string) => void;
}

export function PlanInfoCard({ value, onChange }: PlanInfoCardProps) {
  return (
    <div className="surface p-4 lg:p-5">
      <div className="mb-4 text-sm font-medium">Informations du plan</div>
      <div className="flex flex-col gap-2">
        <label htmlFor="planName" className="label">
          Nom du plan
        </label>
        <input
          id="planName"
          type="text"
          autoComplete="off"
          placeholder="Rez-de-chaussée"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field"
        />
      </div>
    </div>
  );
}