import { useCallback, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { watchApiRead, type ApiRead, type ApiReadHandlers } from '../lib/apiRead.js';

/** Le changement de loader annule le consommateur précédent dès le commit React. */
export function useApiQuery<T>(load: ((read: ApiRead) => Promise<T>) | null, handlers: ApiReadHandlers<T>) {
  const start = useEffectEvent(() => handlers.start?.());
  const success = useEffectEvent((value: T) => handlers.success(value));
  const error = useEffectEvent((cause: unknown) => handlers.error?.(cause));
  const settled = useEffectEvent(() => handlers.settled?.());
  const query = useRef<ReturnType<typeof watchApiRead<T>> | null>(null);

  useLayoutEffect(() => {
    if (!load) return;
    const watcher = watchApiRead(load, {
      start: () => start(),
      success: value => success(value),
      error: cause => error(cause),
      settled: () => settled(),
    });
    query.current = watcher;
    return () => {
      watcher.dispose();
      query.current = null;
    };
  }, [load]);

  return useCallback(() => query.current?.refresh(), []);
}
