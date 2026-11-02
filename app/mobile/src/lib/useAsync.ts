import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { readCache, saveCache } from './offlineCache';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /**
   * Set when `data` is the last copy saved on this phone rather than a fresh
   * answer, because the server could not be reached: when it was saved.
   */
  savedAt: string | null;
}

interface AsyncOptions {
  /**
   * Keep the last good answer under this key and show it when there is no
   * signal (src/lib/offlineCache.ts). Leave it out for anything that must be
   * fresh or is not worth keeping.
   */
  cacheKey?: string | null;
}

/**
 * Run an async loader on mount (and on `deps` change), with loading/error
 * state and a manual reload. Aborts in-flight requests on unmount/refetch via
 * the AbortSignal passed to the loader.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList = [],
  options: AsyncOptions = {}
): AsyncState<T> {
  const cacheKey = options.cacheKey ?? null;
  const [data, setData] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current(ctrl.signal)
      .then((res) => {
        if (active) {
          setData(res);
          setSavedAt(null);
          setLoading(false);
        }
        if (cacheKey) void saveCache(cacheKey, res);
      })
      .catch(async (e: unknown) => {
        if (!active) return;
        // Ignore intentional aborts. Checked by name, NOT with
        // `e instanceof DOMException`: Hermes has no DOMException, so that
        // reference throws inside this catch block and turns every rejection,
        // including ordinary aborts, into an unhandled one. The effect on
        // device was that `loading` never cleared and every screen sat on its
        // spinner forever. React Native's fetch rejects aborts with a plain
        // Error whose name is 'AbortError', so the name check is the portable one.
        if ((e as { name?: string } | null)?.name === 'AbortError') return;
        // No signal (status 0 is "could not reach the server"): the last copy,
        // labelled with its age, beats an error on a screen somebody is
        // working from.
        if (cacheKey && e instanceof ApiError && e.status === 0) {
          const kept = await readCache<T>(cacheKey);
          if (!active) return;
          if (kept) {
            setData(kept.data);
            setSavedAt(kept.savedAt);
            setLoading(false);
            return;
          }
        }
        const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Unexpected error';
        setError(msg);
        setLoading(false);
      });
    return () => {
      active = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, cacheKey, ...deps]);

  return { data, loading, error, reload, savedAt };
}
