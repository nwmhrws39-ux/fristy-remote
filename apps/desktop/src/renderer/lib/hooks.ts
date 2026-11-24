import { useCallback, useEffect, useState } from 'react';
import { errorText, invoke } from './api';
import type { IpcChannel } from '../../main/ipc-contract';

/** Loads data from an IPC channel with loading/error state and a reload function. */
export function useIpc<T>(channel: IpcChannel, payload?: unknown, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await invoke<T>(channel, payload));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, JSON.stringify(payload ?? null)]);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);
  return { data, error, loading, reload, setData };
}

/** Runs an action, exposing busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
