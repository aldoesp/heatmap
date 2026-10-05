interface MessagesProps {
  error: string | null;
  info: string | null;
}

export function Messages({ error, info }: MessagesProps) {
  return (
    <div
      aria-live="polite"
      className={[
        'flex flex-col gap-1 text-[13px]',
        (error || info) && 'mt-2.5',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {error && <div className="text-danger">{error}</div>}
      {info && !error && <div className="text-text-dim">{info}</div>}
    </div>
  );
}