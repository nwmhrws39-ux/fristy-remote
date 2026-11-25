import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';
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
import { RemoteClient, RemoteError, decodeBase64, isTailscaleIPv4, type SocketLike } from '@fristy/shared';
import { getIdentity } from '../store/secure';
import { saveHost, setActiveHostKey, updateHost, type PairedHost } from '../store/hosts';

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'unauthorized';

export interface ConnState {
  status: ConnStatus;
  host: PairedHost | null;
  accepted: SessionAccepted | null;
  route: 'lan' | 'tailscale' | 'relay' | null;
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
  /** bumped on every connection attempt; stale attempts abort themselves */
  private gen = 0;
  private pingFailures = 0;
  private lastNetwork: string | null = null;
  onAlert: AlertHandler = () => undefined;

  state: ConnState = { status: 'idle', host: null, accepted: null, route: null, error: null, latency: null, stats: [], powerSchedule: null };

  constructor() {
    // Coming back to the app: verify a connection that looks alive, or reconnect right away.
    AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !this.wanted) return;
      if (this.state.status === 'online') void this.verify();
      else this.reconnectNow();
    });
    // Wi-Fi ↔ mobile data switches leave the old socket hanging: reconnect on the new network.
    try {
      Network.addNetworkStateListener((n) => {
        const key = `${n.type}:${n.isConnected}`;
        if (key === this.lastNetwork) return;
        const first = this.lastNetwork === null;
        this.lastNetwork = key;
        if (first || !this.wanted || !n.isConnected) return;
        if (this.state.status === 'online') this.dropAndReconnect('network changed');
        else this.reconnectNow();
      });
    } catch {
      /* listener unavailable (e.g. tests) */
    }
  }

  /** Pings with a short timeout; a dead connection is dropped and re-established. */
  private async verify(timeoutMs = 3000) {
    const c = this.client;
    if (!c) return;
    try {
      const t = Date.now();
      await c.call('session.ping', { t }, timeoutMs);
      this.pingFailures = 0;
      this.set({ latency: Date.now() - t });
    } catch {
      if (this.client === c) this.dropAndReconnect('connection lost');
    }
  }

  private dropAndReconnect(reason: string) {
    const c = this.client;
    this.client = null; // detach first so its onClose does not schedule a second retry
    if (this.pingTimer) clearInterval(this.pingTimer);
    c?.close();
    this.attempt = 0;
    this.set({ status: 'reconnecting', error: reason, latency: null });
    void this.tryConnect();
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
    if (this.state.status === 'online' && this.client) return void this.verify();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.wanted = true;
    this.attempt = 0;
    void this.tryConnect();
  }

  /**
   * Order of addresses to try. On Wi-Fi: last working address, home LAN, then
   * Tailscale. On mobile data the home LAN is unreachable, so Tailscale/relay go first.
   */
  private async candidates(h: PairedHost): Promise<{ url: string; relay: boolean; address: string | null; timeout: number }[]> {
    let onWifi = true;
    try {
      const n = await Network.getNetworkStateAsync();
      onWifi = n.type === Network.NetworkStateType.WIFI || n.type === Network.NetworkStateType.ETHERNET;
    } catch {
      /* unknown → assume Wi-Fi */
    }
    const all = [...new Set([h.lastAddress, ...h.hosts].filter(Boolean) as string[])];
    const ts = all.filter(isTailscaleIPv4);
    const other = all.filter((a) => !isTailscaleIPv4(a));
    const ordered = onWifi ? [...other.slice(0, 1), ...other.slice(1), ...ts] : [...ts, ...other];
    // On Wi-Fi, prefer the last address that worked even if it is the Tailscale one.
    if (onWifi && h.lastAddress && ordered[0] !== h.lastAddress) {
      ordered.splice(ordered.indexOf(h.lastAddress), 1);
      ordered.unshift(h.lastAddress);
    }
    const list = ordered.map((a) => ({
      url: `ws://${a}:${h.port}/fristy`,
      relay: false,
      address: a as string | null,
      timeout: isTailscaleIPv4(a) ? 7000 : onWifi ? 3500 : 1500
    }));
    const relay = h.relayUrl ? [{ url: h.relayUrl, relay: true, address: null, timeout: 8000 }] : [];
    return onWifi ? [...list, ...relay] : [...list.filter((x) => x.address && isTailscaleIPv4(x.address)), ...relay, ...list.filter((x) => !(x.address && isTailscaleIPv4(x.address)))];
  }

  private async tryConnect() {
    const host = this.state.host;
    if (!host || !this.wanted) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const myGen = ++this.gen;
    this.set({ status: this.wasOnline ? 'reconnecting' : 'connecting' });
    const identity = await getIdentity();
    let lastError = 'computer not reachable';
    for (const c of await this.candidates(host)) {
      if (!this.wanted || myGen !== this.gen) return;
      const client: RemoteClient = new RemoteClient({
        url: c.url,
        viaRelay: c.relay,
        socketFactory,
        identity,
        serverPublicKey: decodeBase64(host.pk),
        open: { deviceName: deviceName() },
        connectTimeoutMs: c.timeout,
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
        if (!this.wanted || myGen !== this.gen) return client.close();
        this.client = client;
        this.attempt = 0;
        this.pingFailures = 0;
        if (!this.wasOnline) this.onAlert({ type: 'startup', message: accepted.host.computerName });
        this.wasOnline = true;
        // Remember every address the PC reports (e.g. a Tailscale IP added after pairing) for use away from home.
        const hosts = [...new Set([...(accepted.host.addresses ?? []), ...host.hosts])].slice(0, 8);
        const patch: Partial<PairedHost> = {
          name: accepted.host.computerName,
          relayUrl: accepted.host.relayUrl,
          hosts,
          ...(c.address ? { lastAddress: c.address } : {})
        };
        await updateHost(host.pk, patch);
        const route = c.relay ? 'relay' : c.address && isTailscaleIPv4(c.address) ? 'tailscale' : 'lan';
        this.set({ status: 'online', accepted, route, error: null, host: { ...host, ...patch } });
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
    if (myGen === this.gen) this.scheduleRetry(lastError);
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
    // Heartbeat: two missed pings in a row = dead connection → reconnect (possibly via another route).
    const ping = async () => {
      const c = this.client;
      if (!c) return;
      try {
        const t = Date.now();
        await c.call('session.ping', { t }, 4000);
        this.pingFailures = 0;
        this.set({ latency: Date.now() - t });
      } catch {
        if (this.client !== c) return;
        if (++this.pingFailures >= 2) this.dropAndReconnect('connection lost');
      }
    };
    void ping();
    if (this.pingTimer) clearInterval(this.pingTimer);
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
