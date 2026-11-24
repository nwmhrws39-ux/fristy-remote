import type { WebSocket } from 'ws';

/** Anything that can carry FRISTY frames: a LAN WebSocket or a relay channel. */
export interface Transport {
  readonly kind: 'lan' | 'relay';
  /** remote address used for rate limiting / logs ("relay" for relayed peers) */
  readonly remote: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
}

export function wsTransport(ws: WebSocket, remote: string): Transport {
  return {
    kind: 'lan',
    remote,
    send: (d) => {
      if (ws.readyState === ws.OPEN) ws.send(d);
    },
    close: (code = 1000, reason = '') => {
      try {
        ws.close(code, reason.slice(0, 120));
      } catch {
        ws.terminate();
      }
      setTimeout(() => ws.terminate(), 2000).unref();
    },
    onMessage: (cb) =>
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          ws.terminate();
          return;
        }
        cb(data.toString());
      }),
    onClose: (cb) => ws.on('close', cb)
  };
}
