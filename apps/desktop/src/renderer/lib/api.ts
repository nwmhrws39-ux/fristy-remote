import type { CoreState, PendingPairing } from '../../core';
import type { IpcChannel } from '../../main/ipc-contract';

declare global {
  interface Window {
    fristy: {
      invoke(channel: IpcChannel, payload?: unknown): Promise<unknown>;
      on(event: 'state' | 'pairing-request' | 'input-activity' | 'security', cb: (data: unknown) => void): () => void;
    };
  }
}

export function invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T> {
  return window.fristy.invoke(channel, payload) as Promise<T>;
}

export function onState(cb: (s: CoreState) => void) {
  return window.fristy.on('state', (d) => cb(d as CoreState));
}

export function onPairingRequest(cb: (p: PendingPairing) => void) {
  return window.fristy.on('pairing-request', (d) => cb(d as PendingPairing));
}

/** Strips Electron's "Error invoking remote method ..." prefix for display. */
export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export type { CoreState, PendingPairing };
