import { useState, useCallback } from 'react';
import type { ApiError } from '../types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

/** Wraps an async function with loading/error state management. */
export function useAsync<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>
): AsyncState<T> & { run: (...args: Args) => Promise<T | null> } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const run = useCallback(
    async (...args: Args): Promise<T | null> => {
      setState({ data: null, loading: true, error: null });
      try {
        const result = await fn(...args);
        setState({ data: result, loading: false, error: null });
        return result;
      } catch (err) {
        const apiError = err as ApiError;
        setState({ data: null, loading: false, error: apiError });
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn]
  );

  return { ...state, run };
}
