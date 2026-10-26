import { useEffect, useState } from 'react';

export type Route =
  | 'scan'
  | 'upload'
  | 'surveys'
  | 'releves'
  | 'analyse'
  | 'heatmap'
  | 'settings';

const DEFAULT_ROUTE: Route = 'scan';
const VALID_ROUTES: Route[] = [
  'scan',
  'upload',
  'surveys',
  'releves',
  'analyse',
  'heatmap',
  'settings',
];

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '').split('?')[0];
  return (VALID_ROUTES as string[]).includes(clean)
    ? (clean as Route)
    : DEFAULT_ROUTE;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? DEFAULT_ROUTE : parseHash(window.location.hash)
  );

  useEffect(() => {
    if (!window.location.hash || !VALID_ROUTES.includes(parseHash(window.location.hash))) {
      history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
    }
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}