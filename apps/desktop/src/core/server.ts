import { EventEmitter } from 'node:events';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import {
  HANDSHAKE_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  METHODS,
  PROTOCOL_VERSION,
  RequestSchema,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MAX_AGE_MS,
  SessionOpenSchema,
  hasPermission,
  isMethodName,
  validateParams,
  type ErrorCode,
  type EventName,
  type HostInfo,
  type MethodName,
  type Permission,
  type PERMISSIONS,
  type RpcResponse,
  type ServerEvents,
  type SessionRejected
} from '@fristy/protocol';
import {
  DecryptError,
  FailureLockout,
  HandshakeError,
  RateLimiter,
  encodeBase64,
  fingerprint,
  randomId,
  serverHandshake,
  type KeyPair,
  type SecureSession
} from '@fristy/shared';
import type { DeviceRow, Store } from './db';
import type { Handlers } from './handlers';
import type { PairingManager } from './pairing';
import type { SettingsManager } from './settings';
import { wsTransport, type Transport } from './transport';

export interface PendingPairing {
  id: string;
  deviceName: string;
  platform: string;
  fingerprint: string;
  sas: string;
  remote: string;
  createdAt: number;
}

export interface SessionInfo {
  id: string;
  deviceId: string;
  deviceName: string;
  remote: string;
  kind: 'lan' | 'relay';
  connectedAt: number;
  lastInputAt: number | null;
}

export interface ServerDeps {
  store: Store;
  settings: SettingsManager;
  identity: KeyPair;
  pairing: PairingManager;
  handlers: Handlers;
  host: () => Omit<HostInfo, 'inputEnabled' | 'protocolVersion'>;
  now?: () => number;
}

interface Session {
  id: string;
  transport: Transport;
  secure: SecureSession;
  device: DeviceRow;
  createdAt: number;
  lastActivity: number;
  lastInputAt: number | null;
  inputLogged: boolean;
  statsSubscribed: boolean;
  limiter: RateLimiter;
}

type ServerEventsMap = {
  'pairing-request': [PendingPairing];
  'pairing-resolved': [{ id: string; approved: boolean }];
  'sessions-changed': [SessionInfo[]];
  'devices-changed': [];
  'input-activity': [{ deviceName: string }];
  security: [{ message: string; remote: string }];
};

const AUDITED_PREFIXES = ['power.', 'apps.launch', 'apps.close', 'apps.openUrl', 'games.launch', 'games.close', 'files.downloadStart', 'files.uploadStart', 'files.finish', 'macros.run'];

/**
 * The FRISTY control server. Owns the connection state machine:
 *   handshake → session open (auth | pair → owner approval) → authorized RPC.
 * Every request is validated, permission-checked and rate-limited.
 */
export class ControlServer extends EventEmitter<ServerEventsMap> {
  private http: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private sessions = new Map<string, Session>();
  private pending = new Map<string, { info: PendingPairing; resolve: (perms: Permission[] | null) => void }>();
  private connLimiter: RateLimiter;
  private lockout: FailureLockout;
  private housekeeping: NodeJS.Timeout;
  private readonly now: () => number;

  constructor(private readonly deps: ServerDeps) {
    super();
    this.now = deps.now ?? Date.now;
    this.connLimiter = new RateLimiter(20, 0.5, this.now);
    this.lockout = new FailureLockout(10, 10 * 60_000, this.now);
    this.housekeeping = setInterval(() => this.expireSessions(), 5000);
    this.housekeeping.unref();
  }

  /* ------------------------------------------------------------------ */
  /* Listening                                                           */
  /* ------------------------------------------------------------------ */

  async listen(port: number, host = '0.0.0.0'): Promise<number> {
    await this.stopListening();
    const server = http.createServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('FRISTY Remote: WebSocket required');
    });
    const wss = new WebSocketServer({ server, path: '/fristy', maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
    wss.on('connection', (ws, req) => {
      const remote = (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
      this.attach(wsTransport(ws, remote));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.http = server;
    this.wss = wss;
    const addr = server.address();
    return typeof addr === 'object' && addr ? addr.port : port;
  }

  get listening(): boolean {
    return this.http?.listening ?? false;
  }

  async stopListening(): Promise<void> {
    this.disconnectAll('remote access disabled', ['lan']);
    const wss = this.wss;
    const srv = this.http;
    this.wss = null;
    this.http = null;
    if (wss) await new Promise<void>((r) => wss.close(() => r()));
    if (srv) await new Promise<void>((r) => srv.close(() => r()));
  }

  async dispose(): Promise<void> {
    clearInterval(this.housekeeping);
    await this.stopListening();
    this.disconnectAll('server stopped');
  }

  /* ------------------------------------------------------------------ */
  /* Connection state machine                                            */
  /* ------------------------------------------------------------------ */

  attach(t: Transport): void {
    const settings = this.deps.settings.get();
    const plainReject = (code: string, message: string) => {
      t.send(JSON.stringify({ t: 'err', code, message }));
      t.close(4003, message);
    };
    if (!settings.remoteEnabled) return plainReject('remote_disabled', 'Remote access is disabled on this computer');
    if (t.kind === 'relay' && !settings.relayEnabled) return plainReject('remote_disabled', 'Internet access is disabled');
    if (this.lockout.isLocked(t.remote) || !this.connLimiter.take(t.remote)) {
      return plainReject('rate_limited', 'Too many attempts, try again later');
    }

    let stage: 'hello' | 'open' | 'pending' | 'ready' | 'closed' = 'hello';
    let secure: SecureSession | null = null;
    let clientKey = '';
    let session: Session | null = null;
    let pendingId: string | null = null;

    const handshakeTimer = setTimeout(() => {
      if (stage === 'hello' || stage === 'open') {
        this.lockout.fail(t.remote);
        t.close(4008, 'handshake timeout');
      }
    }, HANDSHAKE_TIMEOUT_MS);

    const reject = (code: SessionRejected['code'], message: string) => {
      if (secure) t.send(secure.seal({ kind: 'rejected', code, message }));
      stage = 'closed';
      setTimeout(() => t.close(4001, message), 50);
    };

    const accept = (device: DeviceRow, paired: boolean) => {
      clearTimeout(handshakeTimer);
      const s: Session = {
        id: randomId(8),
        transport: t,
        secure: secure!,
        device,
        createdAt: this.now(),
        lastActivity: this.now(),
        lastInputAt: null,
        inputLogged: false,
        statsSubscribed: false,
        limiter: new RateLimiter(400, 200, this.now)
      };
      session = s;
      stage = 'ready';
      this.sessions.set(s.id, s);
      this.deps.store.touchDevice(device.id);
      this.deps.store.log('info', 'connection', `${device.name} connected (${t.kind})`, device.id, t.remote);
      t.send(
        secure!.seal({
          kind: 'accepted',
          deviceId: device.id,
          permissions: device.permissions,
          paired,
          host: this.hostInfo()
        })
      );
      this.emitSessions();
    };

    t.onClose(() => {
      clearTimeout(handshakeTimer);
      if (pendingId) this.resolvePending(pendingId, null);
      if (session) {
        this.sessions.delete(session.id);
        this.deps.store.log('info', 'connection', `${session.device.name} disconnected`, session.device.id, t.remote);
        void this.deps.handlers.onDisconnect(session.device.id);
        this.emitSessions();
      }
      stage = 'closed';
    });

    t.onMessage((raw) => {
      if (stage === 'closed') return;
      if (raw.length > MAX_FRAME_BYTES * 2) return t.close(1009, 'frame too large');
      try {
        if (stage === 'hello') {
          const hs = serverHandshake(this.deps.identity, raw);
          secure = hs.session;
          clientKey = encodeBase64(hs.clientStatic);
          stage = 'open';
          t.send(hs.reply);
          return;
        }

        const msg = secure!.open(raw);

        if (stage === 'open') {
          const open = SessionOpenSchema.safeParse(msg);
          if (!open.success) return reject('protocol', 'invalid session request');
          const req = open.data;
          if (req.kind === 'auth') {
            const device = this.deps.store.getDeviceByKey(clientKey);
            if (!device || device.revokedAt) {
              this.lockout.fail(t.remote);
              this.securityEvent(
                device ? `Revoked device "${device.name}" tried to connect` : `Unknown device tried to connect (key ${fingerprint(Buffer.from(clientKey, 'base64'))})`,
                t.remote
              );
              return reject(device ? 'revoked' : 'unknown_device', 'This device is not authorized. Pair it again.');
            }
            return accept(device, false);
          }
          // Pairing request
          const check = this.deps.pairing.verify(req.pairingId, { secret: req.secret, code: req.code });
          if (!check.ok) {
            this.lockout.fail(t.remote);
            this.securityEvent(`Failed pairing attempt from "${req.deviceName}" (${check.reason})`, t.remote);
            return reject(check.reason, check.reason === 'pairing_expired' ? 'Pairing code expired' : 'Invalid pairing code');
          }
          clearTimeout(handshakeTimer);
          stage = 'pending';
          const info: PendingPairing = {
            id: randomId(8),
            deviceName: req.deviceName,
            platform: req.platform,
            fingerprint: fingerprint(Buffer.from(clientKey, 'base64')),
            sas: secure!.sas,
            remote: t.remote,
            createdAt: this.now()
          };
          pendingId = info.id;
          t.send(secure!.seal({ kind: 'pair_pending', sas: secure!.sas }));
          const timeout = setTimeout(() => this.resolvePending(info.id, null), 120_000);
          timeout.unref();
          this.pending.set(info.id, {
            info,
            resolve: (perms) => {
              clearTimeout(timeout);
              pendingId = null;
              if (stage !== 'pending') return;
              if (!perms) {
                this.deps.store.log('security', 'pairing', `Pairing denied for "${info.deviceName}"`, null, t.remote);
                return reject('pairing_denied', 'Pairing was denied on the computer');
              }
              const device: DeviceRow = {
                id: randomId(8),
                name: info.deviceName,
                platform: info.platform,
                publicKey: clientKey,
                permissions: perms,
                createdAt: this.now(),
                lastSeen: null,
                revokedAt: null
              };
              this.deps.store.addDevice(device);
              this.deps.store.log('security', 'pairing', `Paired "${device.name}" with permissions: ${perms.join(', ') || 'none'}`, device.id, t.remote);
              this.emit('devices-changed');
              accept(device, true);
            }
          });
          this.emit('pairing-request', info);
          return;
        }

        if (stage === 'pending') return; // ignore traffic until the owner decides

        if (stage === 'ready' && session) void this.onRequest(session, msg);
      } catch (e) {
        if (e instanceof HandshakeError || e instanceof DecryptError) {
          this.lockout.fail(t.remote);
          if (stage === 'ready') this.deps.store.log('security', 'connection', `Dropped connection: ${e.message}`, session?.device.id, t.remote);
        }
        stage = 'closed';
        t.close(4002, 'protocol error');
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* RPC dispatch                                                        */
  /* ------------------------------------------------------------------ */

  private async onRequest(s: Session, msg: unknown): Promise<void> {
    s.lastActivity = this.now();
    const parsed = RequestSchema.safeParse(msg);
    if (!parsed.success) return;
    const { id, method } = parsed.data;
    const reply = (r: RpcResponse) => s.transport.send(s.secure.seal(r));
    const fail = (code: ErrorCode, message: string) => reply({ kind: 'res', id, ok: false, error: { code, message } });

    if (!isMethodName(method)) return fail('unknown_method', 'unknown method');
    const def = METHODS[method];
    if (!s.limiter.take(s.device.id, method.startsWith('input.') ? 1 : 5)) return fail('rate_limited', 'slow down');

    if (!hasPermission(s.device.permissions, def.permission)) {
      this.deps.store.log('security', 'permission', `Denied ${method} (missing "${def.permission}")`, s.device.id, s.transport.remote);
      return fail('forbidden', `This device does not have the "${def.permission}" permission`);
    }
    if (def.permission === 'input') {
      if (!this.deps.settings.get().inputEnabled) return fail('input_disabled', 'Remote input is disabled on the computer');
      s.lastInputAt = this.now();
      if (!s.inputLogged) {
        s.inputLogged = true;
        this.deps.store.log('info', 'input', `${s.device.name} started remote input`, s.device.id, s.transport.remote);
      }
      this.emit('input-activity', { deviceName: s.device.name });
    }
    const params = validateParams(method, parsed.data.params);
    if (!params.ok) return fail('bad_request', params.message);

    if (AUDITED_PREFIXES.some((p) => method.startsWith(p))) {
      this.deps.store.log('info', 'action', `${s.device.name}: ${method}`, s.device.id, s.transport.remote);
    }

    try {
      const handler = this.deps.handlers.methods[method] as (ctx: HandlerContext, p: unknown) => Promise<unknown>;
      const result = await handler(this.contextFor(s), params.value);
      reply({ kind: 'res', id, ok: true, result: result ?? null });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const known: ErrorCode[] = ['bad_request', 'forbidden', 'not_found', 'confirmation_required', 'unsupported', 'limit_exceeded'];
      const code = known.includes(err.code as ErrorCode) ? (err.code as ErrorCode) : 'internal';
      fail(code, (err.message ?? 'failed').slice(0, 300));
    }
  }

  private contextFor(s: Session): HandlerContext {
    return {
      deviceId: s.device.id,
      deviceName: s.device.name,
      permissions: s.device.permissions,
      setStatsSubscription: (on) => {
        s.statsSubscribed = on;
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Owner actions (called from the desktop UI via IPC)                  */
  /* ------------------------------------------------------------------ */

  pendingPairings(): PendingPairing[] {
    return [...this.pending.values()].map((p) => p.info);
  }

  approvePairing(id: string, permissions: Permission[]): boolean {
    return this.resolvePending(id, [...new Set(permissions)] as (typeof PERMISSIONS)[number][]);
  }

  denyPairing(id: string): boolean {
    return this.resolvePending(id, null);
  }

  private resolvePending(id: string, perms: Permission[] | null): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    p.resolve(perms);
    this.emit('pairing-resolved', { id, approved: perms !== null });
    return true;
  }

  revokeDevice(deviceId: string): void {
    const device = this.deps.store.getDevice(deviceId);
    if (!device) return;
    this.deps.store.revokeDevice(deviceId);
    this.deps.store.log('security', 'devices', `Access revoked for "${device.name}"`, deviceId);
    for (const s of this.sessions.values()) {
      if (s.device.id !== deviceId) continue;
      s.transport.send(s.secure.seal({ kind: 'evt', event: 'revoked', data: { reason: 'Access revoked on the computer' } }));
      s.transport.close(4004, 'revoked');
    }
    this.emit('devices-changed');
  }

  updatePermissions(deviceId: string, permissions: Permission[]): void {
    const perms = [...new Set(permissions)];
    this.deps.store.updateDevicePermissions(deviceId, perms);
    this.deps.store.log('security', 'devices', `Permissions changed: ${perms.join(', ') || 'none'}`, deviceId);
    for (const s of this.sessions.values()) {
      if (s.device.id !== deviceId) continue;
      s.device = { ...s.device, permissions: perms };
      if (!perms.includes('monitor')) s.statsSubscribed = false;
      this.sendEvent(s, 'permissions', { permissions: perms });
    }
    this.emit('devices-changed');
  }

  disconnectAll(reason = 'disconnected by owner', kinds: ('lan' | 'relay')[] = ['lan', 'relay']): void {
    for (const s of [...this.sessions.values()]) if (kinds.includes(s.transport.kind)) s.transport.close(4005, reason);
    for (const id of [...this.pending.keys()]) this.resolvePending(id, null);
  }

  /** Broadcasts an event to every session that holds `permission` (or all when null). */
  broadcast<E extends EventName>(event: E, data: ServerEvents[E], permission: Permission | null = null): void {
    for (const s of this.sessions.values()) if (hasPermission(s.device.permissions, permission)) this.sendEvent(s, event, data);
  }

  /** Pushes stats to subscribed sessions. Returns false when nobody listens (caller can skip sampling). */
  hasStatsSubscribers(): boolean {
    return [...this.sessions.values()].some((s) => s.statsSubscribed && s.device.permissions.includes('monitor'));
  }

  pushStats(stats: ServerEvents['stats']): void {
    for (const s of this.sessions.values()) {
      if (s.statsSubscribed && s.device.permissions.includes('monitor')) this.sendEvent(s, 'stats', stats);
    }
  }

  sessionsInfo(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      deviceId: s.device.id,
      deviceName: s.device.name,
      remote: s.transport.remote,
      kind: s.transport.kind,
      connectedAt: s.createdAt,
      lastInputAt: s.lastInputAt
    }));
  }

  hostInfo(): HostInfo {
    return { ...this.deps.host(), protocolVersion: PROTOCOL_VERSION, inputEnabled: this.deps.settings.get().inputEnabled };
  }

  /* ------------------------------------------------------------------ */

  private sendEvent<E extends EventName>(s: Session, event: E, data: ServerEvents[E]) {
    s.transport.send(s.secure.seal({ kind: 'evt', event, data }));
  }

  private securityEvent(message: string, remote: string) {
    this.deps.store.log('security', 'auth', message, null, remote);
    this.emit('security', { message, remote });
    this.broadcast('alert', { type: 'unauthorizedAttempt', message }, 'monitor');
  }

  private emitSessions() {
    this.emit('sessions-changed', this.sessionsInfo());
  }

  private expireSessions() {
    const t = this.now();
    for (const s of this.sessions.values()) {
      if (t - s.lastActivity > SESSION_IDLE_TIMEOUT_MS) s.transport.close(4006, 'idle timeout');
      else if (t - s.createdAt > SESSION_MAX_AGE_MS) s.transport.close(4007, 'session expired, reconnect to re-key');
    }
  }
}

export interface HandlerContext {
  deviceId: string;
  deviceName: string;
  permissions: readonly Permission[];
  setStatsSubscription(on: boolean): void;
}

export type { MethodName };
