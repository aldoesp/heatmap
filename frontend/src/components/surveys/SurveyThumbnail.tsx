import { MapPinOff } from 'lucide-react';
import { rssiColor } from '../../lib/signal';
import type { SurveySummary } from '../../hooks/useSurveysLibrary';

type Props = {
  survey: SurveySummary;
  size?: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function SurveyThumbnail({ survey, size = 64 }: Props) {
  const label = `Plan avec ${survey.pointCount} point${survey.pointCount > 1 ? 's' : ''}`;

  return (
    <div
      aria-label={label}
      role="img"
      className="shrink-0 rounded-lg border border-glass-border-soft bg-bg overflow-hidden relative flex items-center justify-center text-text-dim"
      style={{ width: size, height: size }}
    >
      {survey.pointCount === 0 ? (
        <MapPinOff className="w-5 h-5" strokeWidth={1.75} aria-hidden />
      ) : (
        <>
          <img
            src={survey.imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-70"
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            aria-hidden="true"
          >
            {survey.dots.map((p, i) => (
              <circle
                key={i}
                cx={clamp01(p.x) * 100}
                cy={clamp01(p.y) * 100}
                r={3}
                fill={p.rssi === null ? '#8b98a5' : rssiColor(p.rssi)}
              />
            ))}
          </svg>
        </>
      )}
    </div>
  );
}
