import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { MAX_FRAME_BYTES, RelayToHostSchema } from '@fristy/protocol';
import { answerRelayChallenge, encodeBase64, type KeyPair } from '@fristy/shared';
import type { Transport } from './transport';

export type RelayStatus = 'disabled' | 'connecting' | 'connected' | 'error';

/**
 * Outbound connection from the PC to a FRISTY relay server, used for internet
 * access without opening ports. The relay multiplexes phone connections as
 * channels; each channel becomes a virtual Transport that goes through exactly
 * the same handshake/authorization as LAN connections. The relay only ever
 * sees ciphertext.
 */
export class RelayClient extends EventEmitter<{ status: [RelayStatus, string?] }> {
  private ws: WebSocket | null = null;
  private channels = new Map<number, { msg?: (d: string) => void; close?: () => void }>();
  private retry = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  status: RelayStatus = 'disabled';
  lastError: string | null = null;

  constructor(
    private readonly identity: KeyPair,
    private readonly onTransport: (t: Transport) => void
  ) {
    super();
  }

  start(url: string) {
    this.stop();
    this.stopped = false;
    this.connect(url);
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.terminate();
    this.ws = null;
    this.closeAllChannels();
    this.setStatus('disabled');
  }

  private setStatus(s: RelayStatus, detail?: string) {
    this.status = s;
    if (s === 'error') this.lastError = detail ?? 'error';
    this.emit('status', s, detail);
  }

  private closeAllChannels() {
    for (const ch of this.channels.values()) ch.close?.();
    this.channels.clear();
  }

  private connect(url: string) {
    this.setStatus('connecting');
    const ws = new WebSocket(url, { maxPayload: MAX_FRAME_BYTES * 2, perMessageDeflate: false, handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'host', pk: encodeBase64(this.identity.publicKey) })));
    ws.on('message', (raw) => {
      let parsed;
      try {
        parsed = RelayToHostSchema.safeParse(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const m = parsed.data;
      switch (m.t) {
        case 'challenge': {
          const r = answerRelayChallenge(this.identity, m);
          if (r) ws.send(JSON.stringify({ t: 'prove', r }));
          else ws.close();
          break;
        }
        case 'registered':
          this.retry = 0;
          this.setStatus('connected');
          break;
        case 'open':
          this.openChannel(m.ch);
          break;
        case 'data':
          this.channels.get(m.ch)?.msg?.(m.d);
          break;
        case 'close': {
          const ch = this.channels.get(m.ch);
          this.channels.delete(m.ch);
          ch?.close?.();
          break;
        }
        case 'error':
          this.setStatus('error', m.message);
          break;
      }
    });
    ws.on('error', (e) => this.setStatus('error', e.message));
    ws.on('close', () => {
      this.closeAllChannels();
      if (this.stopped) return;
      this.setStatus('error', this.lastError ?? 'relay connection lost');
      const delay = Math.min(60_000, 1000 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(url), delay);
    });
  }

  private openChannel(ch: number) {
    const ws = this.ws;
    if (!ws) return;
    const handlers: { msg?: (d: string) => void; close?: () => void } = {};
    this.channels.set(ch, handlers);
    const t: Transport = {
      kind: 'relay',
      remote: 'relay',
      send: (d) => {
        if (ws.readyState === ws.OPEN && this.channels.has(ch)) ws.send(JSON.stringify({ t: 'data', ch, d }));
      },
      close: () => {
        if (this.channels.delete(ch)) {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'close', ch }));
          handlers.close?.();
        }
      },
      onMessage: (cb) => {
        handlers.msg = cb;
      },
      onClose: (cb) => {
        handlers.close = cb;
      }
    };
    this.onTransport(t);
  }
}
