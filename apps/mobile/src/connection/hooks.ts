import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { MethodName, MethodParams, MethodResults, Permission } from '@fristy/protocol';
import { connection, type ConnState } from './manager';

export function useConnection(): ConnState {
  return useSyncExternalStore(connection.subscribe, connection.getState);
}

export function useCan(p: Permission): boolean {
  const s = useConnection();
  return s.status === 'online' && !!s.accepted?.permissions.includes(p);
}

/** Calls a remote method and keeps loading/error state; refetches when the connection comes online. */
export function useRemote<M extends MethodName>(method: M, params: MethodParams<M>, enabled = true) {
  const { status } = useConnection();
  const [data, setData] = useState<MethodResults[M] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(params);
  const reload = useCallback(async () => {
    if (!enabled || connection.state.status !== 'online') return;
    setLoading(true);
    try {
      setData(await connection.call(method, params));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, enabled]);
  useEffect(() => {
    if (status === 'online') void reload();
  }, [status, reload]);
  return { data, error, loading, reload, setData };
}

/** Wraps a one-off remote action with busy/error state. */
export function useRemoteAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
