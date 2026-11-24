import {
  InboundToClientSchema,
  PairPendingSchema,
  PlainErrorFrameSchema,
  RelayToClientControlSchema,
  SessionAcceptedSchema,
  SessionRejectedSchema,
  type AuthRequest,
  type EventName,
  type MethodName,
  type MethodParams,
  type MethodResults,
  type PairRequest,
  type RpcError,
  type ServerEvents,
  type SessionAccepted,
  type SessionRejected
} from '@fristy/protocol';
import { clientHandshake, decodeBase64, encodeBase64, type KeyPair, type SecureSession } from './crypto';

/** Minimal browser-style WebSocket surface (RN WebSocket, browser WebSocket and `ws` all satisfy it). */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export class RemoteError extends Error {
  constructor(
    readonly code: RpcError['code'] | SessionRejected['code'] | 'timeout' | 'disconnected' | 'handshake',
    message: string
  ) {
    super(message);
  }
}

export interface ClientOptions {
  url: string;
  socketFactory: SocketFactory;
  identity: KeyPair;
  /** pinned desktop public key */
  serverPublicKey: Uint8Array;
  /** when connecting through the relay */
  viaRelay?: boolean;
  open: Omit<PairRequest, 'kind'> | Omit<AuthRequest, 'kind'>;
  onPairPending?: (sas: string) => void;
  onEvent?: <E extends EventName>(event: E, data: ServerEvents[E]) => void;
  onClose?: (reason: string) => void;
  connectTimeoutMs?: number;
  /** how long to wait for the PC owner to approve a pairing */
  approvalTimeoutMs?: number;
  requestTimeoutMs?: number;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Encrypted RPC client for the FRISTY desktop server.
 * One instance = one connection; reconnection is handled by the caller.
 */
export class RemoteClient {
  private socket: SocketLike | null = null;
  private session: SecureSession | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;
  accepted: SessionAccepted | null = null;

  constructor(private readonly opts: ClientOptions) {}

  get isOpen(): boolean {
    return !this.closed && this.accepted !== null;
  }

  connect(): Promise<SessionAccepted> {
    const o = this.opts;
    return new Promise<SessionAccepted>((resolve, reject) => {
      let stage: 'relay' | 'hello' | 'open' | 'ready' = o.viaRelay ? 'relay' : 'hello';
      const hs = clientHandshake(o.identity, o.serverPublicKey);
      let settled = false;
      const fail = (err: RemoteError) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
        this.shutdown(err.message);
      };
      let timer = setTimeout(() => fail(new RemoteError('timeout', 'connection timed out')), o.connectTimeoutMs ?? 10_000);

      let socket: SocketLike;
      try {
        socket = o.socketFactory(o.url);
      } catch (e) {
        fail(new RemoteError('disconnected', (e as Error).message));
        return;
      }
      this.socket = socket;

      socket.onopen = () => {
        if (stage === 'relay') socket.send(JSON.stringify({ t: 'client', host: encodeBase64(o.serverPublicKey) }));
        else socket.send(hs.hello);
      };
      socket.onerror = () => fail(new RemoteError('disconnected', 'network error'));
      socket.onclose = (ev) => {
        const reason = ev?.reason || 'connection closed';
        if (!settled) fail(new RemoteError('disconnected', reason));
        else this.shutdown(reason);
      };
      socket.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
        try {
          if (stage === 'relay') {
            const ctl = RelayToClientControlSchema.safeParse(JSON.parse(raw));
            if (!ctl.success) return fail(new RemoteError('protocol', 'unexpected relay message'));
            if (ctl.data.t !== 'ready') {
              return fail(new RemoteError('disconnected', ctl.data.t === 'offline' ? 'computer is offline' : ctl.data.message));
            }
            stage = 'hello';
            socket.send(hs.hello);
            return;
          }
          if (stage === 'hello') {
            const plain = PlainErrorFrameSchema.safeParse(safeJson(raw));
            if (plain.success) {
              const code = plain.data.code === 'rate_limited' || plain.data.code === 'remote_disabled' ? plain.data.code : 'protocol';
              return fail(new RemoteError(code, plain.data.message));
            }
            this.session = hs.finish(raw);
            stage = 'open';
            const kind = 'pairingId' in o.open ? 'pair' : 'auth';
            socket.send(this.session.seal({ kind, ...o.open }));
            return;
          }
          const msg = this.session!.open(raw);
          if (stage === 'open') {
            const pend = PairPendingSchema.safeParse(msg);
            if (pend.success) {
              clearTimeout(timer);
              timer = setTimeout(
                () => fail(new RemoteError('timeout', 'pairing was not approved in time')),
                o.approvalTimeoutMs ?? 120_000
              );
              o.onPairPending?.(pend.data.sas);
              return;
            }
            const acc = SessionAcceptedSchema.safeParse(msg);
            if (acc.success) {
              stage = 'ready';
              settled = true;
              clearTimeout(timer);
              this.accepted = acc.data;
              resolve(acc.data);
              return;
            }
            const rej = SessionRejectedSchema.safeParse(msg);
            if (rej.success) return fail(new RemoteError(rej.data.code, rej.data.message));
            return fail(new RemoteError('protocol', 'unexpected session message'));
          }
          this.dispatch(msg);
        } catch (e) {
          fail(new RemoteError('handshake', (e as Error).message));
        }
      };
    });
  }

  private dispatch(msg: unknown) {
    const parsed = InboundToClientSchema.safeParse(msg);
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.kind === 'res') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new RemoteError(m.error.code, m.error.message));
    } else {
      if (m.event === 'permissions' && this.accepted) {
        this.accepted = { ...this.accepted, permissions: (m.data as ServerEvents['permissions']).permissions };
      }
      this.opts.onEvent?.(m.event as EventName, m.data as never);
    }
  }

  call<M extends MethodName>(method: M, params: MethodParams<M>, timeoutMs?: number): Promise<MethodResults[M]> {
    if (!this.socket || !this.session || !this.isOpen) {
      return Promise.reject(new RemoteError('disconnected', 'not connected'));
    }
    const id = this.nextId++;
    const frame = this.session.seal({ kind: 'req', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RemoteError('timeout', `${method} timed out`));
      }, timeoutMs ?? this.opts.requestTimeoutMs ?? 15_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.socket!.send(frame);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new RemoteError('disconnected', (e as Error).message));
      }
    });
  }

  /** Fire-and-forget variant for high-frequency input (mouse moves). Errors are ignored. */
  notify<M extends MethodName>(method: M, params: MethodParams<M>): void {
    this.call(method, params, 5000).catch(() => undefined);
  }

  async latency(): Promise<number> {
    const t = Date.now();
    await this.call('session.ping', { t });
    return Date.now() - t;
  }

  close(): void {
    this.shutdown('closed by client');
  }

  private shutdown(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RemoteError('disconnected', reason));
    }
    this.pending.clear();
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.opts.onClose?.(reason);
  }
}

export function decodeServerKey(b64: string): Uint8Array {
  return decodeBase64(b64);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
