import {
  Radar,
  Upload,
  ClipboardList,
  Flame,
  Radio,
  Settings,
  Wifi,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useHashRoute, type Route } from '../../hooks/useHashRoutes';

type NavItem = {
  route: Route;
  label: string;
  Icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { route: 'upload', label: 'Plan', Icon: Upload },
  { route: 'scan', label: 'Mesures', Icon: Radar },
  { route: 'channels', label: 'Canaux', Icon: Radio },
  { route: 'surveys', label: 'Relevés', Icon: ClipboardList },
  { route: 'heatmap', label: 'Couverture', Icon: Flame },
  { route: 'settings', label: 'Paramètres', Icon: Settings },
  { route: 'account', label: 'Compte', Icon: UserRound },
];

export function Navbar() {
  const current = useHashRoute();

  return (
    <nav
      aria-label="Navigation principale"
      className={[
        'glass-fallback fixed inset-x-0 bottom-0 z-50 border-t border-glass-border bg-glass-bg pb-[env(safe-area-inset-bottom)] backdrop-blur-ui backdrop-saturate-150 shadow-glass',
        'md:sticky md:top-0 md:bottom-auto md:border-b md:border-t-0',
      ].join(' ')}
    >
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-3 md:h-14 md:px-6">
        <a
          href="#/scan"
          className="hidden shrink-0 items-center gap-2.5 rounded-item px-1 py-1 text-sm font-medium text-text no-underline md:inline-flex"
        >
          <Wifi className="h-5 w-5 text-accent" strokeWidth={1.75} aria-hidden />
          <span className="">WiFi Heatmapper</span>
        </a>

        <ul className="flex min-w-0 flex-1 list-none items-center justify-around gap-1 p-0 md:justify-start">
          {NAV_ITEMS.map(({ route, label, Icon }) => {
            const active = current === route || (route === 'surveys' && current === 'releves');
            return (
              <li key={route} className="min-w-0 md:flex-none">
                <a
                  href={`#/${route}`}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'relative flex min-h-12 min-w-12 flex-col items-center justify-center gap-1 rounded-item border border-transparent px-2 no-underline',
                    'transition-colors duration-ui ease-ui md:min-h-0 md:min-w-0 md:flex-row md:gap-2 md:px-3 md:py-2',
                    active
                      ? 'text-accent md:border md:border-accent-border md:bg-accent-soft'
                      : 'text-muted hover:text-text md:hover:bg-glass-bg',
                  ].join(' ')}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute -top-px h-0.5 w-5 rounded-full bg-accent shadow-accent-soft md:hidden"
                    />
                  )}
                  <Icon
                    className={[
                      'h-5 w-5 shrink-0 md:h-4 md:w-4',
                      active ? 'text-accent' : 'text-current',
                    ].join(' ')}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="max-w-full truncate text-[11px] font-medium leading-none md:text-[13px]">
                    {label}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
