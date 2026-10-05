import {
  Radar,
  Upload,
  ClipboardList,
  ChartNoAxesCombined,
  Flame,
  Settings,
  Wifi,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useHashRoute, type Route } from '../../hooks/useHashRoutes';

type NavItem = {
  route: Route;
  label: string;
  Icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { route: 'scan', label: 'Scan', Icon: Radar },
  { route: 'upload', label: 'Upload', Icon: Upload },
  { route: 'surveys', label: 'Surveys', Icon: ClipboardList },
  { route: 'analyse', label: 'Analyse', Icon: ChartNoAxesCombined },
  { route: 'heatmap', label: 'Heatmap', Icon: Flame },
  { route: 'settings', label: 'Settings', Icon: Settings },
];

export function Navbar() {
  const current = useHashRoute();

  return (
    <nav
      aria-label="Navigation principale"
      className={[
        // Base commune
        'glass-fallback fixed z-50 flex items-center',
        'bg-glass-bg backdrop-blur-ui backdrop-saturate-150',
        'border border-glass-border shadow-glass',
        // Mobile : bas, pleine largeur
        'left-3 right-3 bottom-[calc(12px+env(safe-area-inset-bottom))] h-16 px-2 rounded-bar',
        // Desktop : haut, centré
        'md:sticky md:top-3 md:left-auto md:right-auto md:bottom-auto',
        'md:mx-auto md:max-w-[1200px] md:h-14 md:px-3 md:rounded-[20px]',
      ].join(' ')}
    >
      {/* Brand (visible desktop seulement) */}
      <a
        href="#/scan"
        className="hidden md:inline-flex items-center gap-2 text-text text-[15px] font-medium no-underline px-3 py-1 mr-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-lg"
      >
        <Wifi className="w-5 h-5 text-accent" strokeWidth={1.75} aria-hidden />
        <span>WiFi Diagnostic</span>
      </a>

      {/* Items */}
      <ul className="flex flex-1 items-center justify-around md:justify-end md:gap-1 list-none m-0 p-0">
        {NAV_ITEMS.map(({ route, label, Icon }) => {
          const active = current === route;
          return (
            <li key={route}>
              <a
                href={`#/${route}`}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                title={label}
                className={[
                  'relative inline-flex items-center justify-center',
                  'min-w-[44px] min-h-[44px] px-3 rounded-item',
                  'border border-transparent no-underline',
                  'transition-all duration-ui ease-ui',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  // État inactif
                  'text-text-dim',
                  // Hover desktop
                  'md:hover:bg-glass-bg md:hover:text-text',
                  // État actif — Variante 3 : pas de pilule sur mobile
                  active && 'text-accent',
                  // Sur desktop, on remet la pilule
                  active &&
                    'md:bg-accent-soft md:border-accent-border md:hover:bg-accent-soft md:hover:text-accent',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <Icon
                  className={[
                    'w-[22px] h-[22px] md:w-[18px] md:h-[18px] shrink-0',
                    active && 'md:drop-shadow-[0_0_6px_rgba(16,185,129,0.55)]',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  strokeWidth={1.75}
                  aria-hidden
                />

                {/* Barre indicatrice — uniquement sur mobile quand actif */}
                {active && (
                  <span
                    aria-hidden
                    className="md:hidden absolute left-1/2 bottom-1 -translate-x-1/2 w-5 h-0.5 rounded-full bg-accent shadow-accent-soft"
                  />
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}