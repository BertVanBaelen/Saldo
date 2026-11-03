import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, isAbort } from './api';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Load again; keeps the current data on screen while it runs. */
  reload: () => void;
  /** Replace the data locally (after a save). */
  setData: (d: T) => void;
}

/**
 * Runs `load` on mount and whenever `deps` change. Aborts the previous request, keeps the last data while
 * reloading, and turns errors into the server's Dutch message.
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    loadRef.current(ctl.signal).then(
      (d) => {
        if (ctl.signal.aborted) return;
        setData(d);
        setLoading(false);
      },
      (e) => {
        if (ctl.signal.aborted || isAbort(e)) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
