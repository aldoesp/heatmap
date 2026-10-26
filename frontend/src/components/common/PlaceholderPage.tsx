interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="max-w-150 mx-auto px-4 pt-16 pb-28 md:pb-16 text-center">
      <h1 className="text-[22px] font-medium tracking-tight mb-2">{title}</h1>
      <p className="text-text-dim text-sm mb-4">
        Cette page n’est pas encore disponible dans cette version.
      </p>
      <button
        type="button"
        onClick={() => {
          location.hash = '#/scan';
        }}
        className="inline-flex items-center h-12 px-5 rounded-[14px] bg-accent text-bg font-medium text-[15px]"
      >
        Retour au scan
      </button>
    </div>
  );
}
