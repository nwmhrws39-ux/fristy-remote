import { AppState, Platform } from 'react-native';
import {
  DEFAULT_CONTROL_PORT,
  type MethodName,
  type MethodParams,
  type MethodResults,
  type PairingQr,
  type ServerEvents,
  type SessionAccepted,
  type SystemStats
} from '@fristy/protocol';
import { RemoteClient, RemoteError, decodeBase64, type SocketLike } from '@fristy/shared';
import { getIdentity } from '../store/secure';
import { saveHost, setActiveHostKey, updateHost, type PairedHost } from '../store/hosts';

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'unauthorized';

export interface ConnState {
  status: ConnStatus;
  host: PairedHost | null;
  accepted: SessionAccepted | null;
  route: 'lan' | 'relay' | null;
  error: string | null;
  latency: number | null;
  stats: SystemStats[];
  powerSchedule: { action: 'shutdown' | 'restart'; at: number } | null;
}

type AlertHandler = (alert: ServerEvents['alert'] | { type: 'startup' | 'deviceDisconnected'; message: string }) => void;

const socketFactory = (url: string) => new WebSocket(url) as unknown as SocketLike;
const deviceName = () => `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} (FRISTY)`;
const STATS_HISTORY = 60;

/**
 * Owns the single live connection to the active PC: tries every known LAN
 * address, falls back to the relay, keeps it alive with pings (latency) and
 * reconnects with exponential backoff.
 */
export class ConnectionManager {
  private client: RemoteClient | null = null;
  private listeners = new Set<() => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private wanted = false;
  private wasOnline = false;
  onAlert: AlertHandler = () => undefined;

  state: ConnState = { status: 'idle', host: null, accepted: null, route: null, error: null, latency: null, stats: [], powerSchedule: null };

  constructor() {
    AppState.addEventListener('change', (s) => {
      if (s === 'active' && this.wanted && this.state.status !== 'online' && this.state.status !== 'connecting') this.reconnectNow();
    });
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<ConnState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async connect(host: PairedHost) {
    this.disconnect();
    this.wanted = true;
    this.attempt = 0;
    this.wasOnline = false;
    await setActiveHostKey(host.pk);
    this.set({ host, status: 'connecting', error: null, stats: [], accepted: null, route: null });
    void this.tryConnect();
  }

  disconnect() {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
    const c = this.client;
    this.client = null;
    c?.close();
    this.set({ status: 'idle', accepted: null, route: null, latency: null });
  }

  reconnectNow() {
    if (!this.state.host) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.wanted = true;
    this.attempt = 0;
    void this.tryConnect();
  }

  private candidates(h: PairedHost): { url: string; relay: boolean; address: string | null }[] {
    const addrs = [...new Set([h.lastAddress, ...h.hosts].filter(Boolean) as string[])];
    const list: { url: string; relay: boolean; address: string | null }[] = addrs.map((a) => ({ url: `ws://${a}:${h.port}/fristy`, relay: false, address: a }));
    if (h.relayUrl) list.push({ url: h.relayUrl, relay: true, address: null });
    return list;
  }

  private async tryConnect() {
    const host = this.state.host;
    if (!host || !this.wanted) return;
    this.set({ status: this.wasOnline ? 'reconnecting' : 'connecting' });
    const identity = await getIdentity();
    let lastError = 'computer not reachable';
    for (const c of this.candidates(host)) {
      if (!this.wanted) return;
      const client: RemoteClient = new RemoteClient({
        url: c.url,
        viaRelay: c.relay,
        socketFactory,
        identity,
        serverPublicKey: decodeBase64(host.pk),
        open: { deviceName: deviceName() },
        connectTimeoutMs: c.relay ? 8000 : 3500,
        onEvent: (e, d) => this.onEvent(e, d),
        onClose: (reason) => {
          if (this.client !== client) return;
          this.client = null;
          if (this.pingTimer) clearInterval(this.pingTimer);
          if (this.wanted && this.state.status !== 'unauthorized') {
            this.onAlert({ type: 'deviceDisconnected', message: reason });
            this.scheduleRetry(reason);
          }
        }
      });
      try {
        const accepted = await client.connect();
        if (!this.wanted) return client.close();
        this.client = client;
        this.attempt = 0;
        if (!this.wasOnline) this.onAlert({ type: 'startup', message: accepted.host.computerName });
        this.wasOnline = true;
        const patch: Partial<PairedHost> = { name: accepted.host.computerName, relayUrl: accepted.host.relayUrl, ...(c.address ? { lastAddress: c.address } : {}) };
        await updateHost(host.pk, patch);
        this.set({ status: 'online', accepted, route: c.relay ? 'relay' : 'lan', error: null, host: { ...host, ...patch } });
        this.afterConnect(accepted);
        return;
      } catch (e) {
        const err = e as RemoteError;
        lastError = err.message;
        if (err.code === 'unknown_device' || err.code === 'revoked') {
          this.wanted = false;
          this.set({ status: 'unauthorized', error: err.message });
          return;
        }
      }
    }
    this.scheduleRetry(lastError);
  }

  private scheduleRetry(reason: string) {
    if (!this.wanted) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt++);
    this.set({ status: 'reconnecting', error: reason, accepted: this.state.accepted, latency: null });
    this.retryTimer = setTimeout(() => void this.tryConnect(), delay);
  }

  private afterConnect(accepted: SessionAccepted) {
    if (accepted.permissions.includes('monitor')) {
      void this.call('session.subscribeStats', { enabled: true }).catch(() => undefined);
      void this.call('system.info', {})
        .then((info) => {
          if (this.state.host && info.wol.mac) {
            void updateHost(this.state.host.pk, { mac: info.wol.mac, broadcast: info.wol.broadcast });
            this.set({ host: { ...this.state.host, mac: info.wol.mac, broadcast: info.wol.broadcast } });
          }
        })
        .catch(() => undefined);
    }
    if (accepted.permissions.includes('power')) {
      void this.call('power.scheduleState', {}).then((s) => this.set({ powerSchedule: s })).catch(() => undefined);
    }
    const ping = async () => {
      try {
        const ms = await this.client?.latency();
        if (ms !== undefined) this.set({ latency: ms });
      } catch {
        /* onClose handles reconnection */
      }
    };
    void ping();
    this.pingTimer = setInterval(ping, 5000);
  }

  private onEvent(event: keyof ServerEvents, data: unknown) {
    switch (event) {
      case 'stats':
        this.set({ stats: [...this.state.stats.slice(-(STATS_HISTORY - 1)), data as SystemStats] });
        break;
      case 'permissions':
        if (this.state.accepted) this.set({ accepted: { ...this.state.accepted, permissions: (data as ServerEvents['permissions']).permissions } });
        break;
      case 'inputState':
        if (this.state.accepted) {
          const a = this.state.accepted;
          this.set({ accepted: { ...a, host: { ...a.host, inputEnabled: (data as ServerEvents['inputState']).enabled } } });
        }
        break;
      case 'powerSchedule':
        this.set({ powerSchedule: data as ServerEvents['powerSchedule'] });
        break;
      case 'alert':
        this.onAlert(data as ServerEvents['alert']);
        break;
      case 'revoked':
        this.wanted = false;
        this.set({ status: 'unauthorized', error: (data as ServerEvents['revoked']).reason });
        break;
    }
  }

  call<M extends MethodName>(method: M, params: MethodParams<M>, timeoutMs?: number): Promise<MethodResults[M]> {
    if (!this.client) return Promise.reject(new RemoteError('disconnected', 'Not connected'));
    return this.client.call(method, params, timeoutMs);
  }

  notify<M extends MethodName>(method: M, params: MethodParams<M>) {
    this.client?.notify(method, params);
  }
}

export const connection = new ConnectionManager();

/* ------------------------------------------------------------------ */
/* Pairing                                                              */
/* ------------------------------------------------------------------ */

export interface PairTarget {
  pk: string;
  pid: string;
  name: string;
  hosts: string[];
  port: number;
  proof: { secret: string } | { code: string };
}

export function targetFromQr(qr: PairingQr): PairTarget {
  return { pk: qr.pk, pid: qr.pid, name: qr.name, hosts: qr.hosts, port: qr.port, proof: { secret: qr.secret } };
}

/**
 * Runs the pairing handshake against each address until one answers.
 * `onPending` receives the 6-digit verification code while the PC owner decides.
 */
export async function pair(target: PairTarget, onPending: (sas: string) => void): Promise<PairedHost> {
  const identity = await getIdentity();
  let lastErr: Error = new Error('computer not reachable');
  for (const address of target.hosts) {
    let reachedPc = false;
    const client = new RemoteClient({
      url: `ws://${address}:${target.port || DEFAULT_CONTROL_PORT}/fristy`,
      socketFactory,
      identity,
      serverPublicKey: decodeBase64(target.pk),
      open: { pairingId: target.pid, deviceName: deviceName(), platform: Platform.OS === 'ios' ? 'ios' : 'android', ...target.proof },
      connectTimeoutMs: 4000,
      approvalTimeoutMs: 120_000,
      onPairPending: (sas) => {
        reachedPc = true;
        onPending(sas);
      }
    });
    try {
      const accepted = await client.connect();
      client.close();
      const host: PairedHost = {
        pk: target.pk,
        name: accepted.host.computerName,
        hosts: target.hosts,
        port: target.port,
        deviceId: accepted.deviceId,
        relayUrl: accepted.host.relayUrl,
        lastAddress: address,
        mac: null,
        broadcast: null,
        pairedAt: Date.now()
      };
      await saveHost(host);
      return host;
    } catch (e) {
      lastErr = e as Error;
      // A definitive answer from the PC (or a timeout while the owner was deciding): stop here.
      const definitive = ['pairing_denied', 'pairing_invalid', 'pairing_expired', 'rate_limited', 'remote_disabled'];
      if (reachedPc || (e instanceof RemoteError && definitive.includes(e.code))) throw e;
    }
  }
  throw lastErr;
}
