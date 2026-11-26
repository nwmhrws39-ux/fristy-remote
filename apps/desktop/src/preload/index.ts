import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/*
 * Minimal, explicit bridge. The renderer is sandboxed with no Node.js access;
 * it can only call `invoke` with a channel name (validated again in main) and
 * subscribe to a fixed set of events.
 */
const EVENTS = new Set(['state', 'pairing-request', 'input-activity', 'security', 'update']);

contextBridge.exposeInMainWorld('fristy', {
  invoke: (channel: string, payload?: unknown) => {
    if (typeof channel !== 'string' || channel.length > 64) return Promise.reject(new Error('invalid channel'));
    return ipcRenderer.invoke('fristy:invoke', channel, payload);
  },
  on: (event: string, cb: (data: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error('unknown event');
    const listener = (_e: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(`fristy:${event}`, listener);
    return () => ipcRenderer.removeListener(`fristy:${event}`, listener);
  }
});
