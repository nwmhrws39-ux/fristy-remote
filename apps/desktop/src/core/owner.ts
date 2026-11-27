import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { randomId } from '@fristy/shared';
import type { Store } from './db';

/*
 * Client for the optional FRISTY owner service (apps/admin-server).
 * Disabled unless the build was given an https:// URL. The PC checks in with
 * a random install id, its computer name, platform and version – no IP
 * addresses or personal data. When the owner locks the app, this PC refuses
 * phone connections until it is unlocked again (unless this install is an admin).
 */

export type LockReason = 'locked' | 'blocked' | 'invite' | 'maintenance';

export interface OwnerStatus {
  enabled: boolean;
  locked: boolean;
  reason: LockReason | null;
  message: string;
  announcement: string;
  updateAvailable: boolean;
  admin: boolean;
  lastCheck: number | null;
  /** upcoming or running maintenance window */
  maintenance: { start: number; end: number; message: string } | null;
  /** message from the owner to this install only */
  personal: { text: string; at: number } | null;
  /** beta tester: gets new versions before everyone else */
  beta: boolean;
  /** newest version this install may update to ('' = any) */
  stableVersion: string;
}

export interface OwnerOptions {
  apiUrl: string;
  store: Store;
  name: () => string;
  platform: string;
  appVersion: string;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  /** live updates over WebSocket (default on); tests turn it off */
  live?: boolean;
  /** where the admin token is kept (OS-encrypted in the app); in-memory when omitted */
  tokenStore?: { get(): string | null; set(token: string | null): void };
}

export interface AdminConfig {
  locked: boolean;
  lockMessage: string;
  announcement: string;
  minVersion: string;
  inviteRequired: boolean;
  maintenance: { start: number; end: number; message: string } | null;
  notifyTopic: string;
  betaChannel: boolean;
  stablePc: string;
  stableIos: string;
}

export interface AdminOverview {
  config: AdminConfig;
  you: string;
  betaVersions: { pc: string; ios: string };
  invites: { code: string; note: string; maxUses: number; uses: number; createdAt: number }[];
  installs: {
    id: string;
    name: string;
    kind: 'phone' | 'pc';
    platform: string;
    appVersion: string;
    country: string | null;
    firstSeen: number;
    lastSeen: number;
    online: boolean;
    blocked: boolean;
    admin: boolean;
    pending: boolean;
    beta: boolean;
    message: string;
  }[];
}

export interface AdminLogEntry {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface OwnerStats {
  days: { day: string; users: number; phones: number; pcs: number; newUsers: number }[];
  versions: { version: string; kind: string; users: number }[];
  countries: { country: string | null; users: number }[];
  totals: { users: number; phones: number; pcs: number; active7: number; active30: number };
}

const DISABLED: OwnerStatus = {
  enabled: false,
  locked: false,
  reason: null,
  message: '',
  announcement: '',
  updateAvailable: false,
  admin: false,
  lastCheck: null,
  maintenance: null,
  personal: null,
  beta: false,
  stableVersion: ''
};

const REASONS: LockReason[] = ['locked', 'blocked', 'invite', 'maintenance'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class OwnerClient extends EventEmitter<{ status: [OwnerStatus] }> {
  status: OwnerStatus;
  private timer: NodeJS.Timeout | null = null;
  private readonly fetchImpl: typeof fetch;
  private ws: WebSocket | null = null;
  private liveRetry: NodeJS.Timeout | null = null;
  private liveBackoff = 2000;
  private liveConnected = false;
  private maintTimers: NodeJS.Timeout[] = [];
  private refreshSoon: NodeJS.Timeout | null = null;
  private stopped = false;
  private memToken: string | null = null;

  constructor(private readonly opts: OwnerOptions) {
    super();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    // A lock survives restarts and offline periods until the service says otherwise.
    const saved = opts.store.getSetting<Partial<OwnerStatus>>('ownerStatus', {});
    this.status = this.enabled ? { ...DISABLED, ...saved, enabled: true } : DISABLED;
  }

  get enabled(): boolean {
    return /^https:\/\/[^\s/]+/.test(this.opts.apiUrl) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(this.opts.apiUrl);
  }

  get installId(): string {
    let id = this.opts.store.getSetting<string | null>('installId', null);
    if (!id) {
      id = `pc-${randomId(16)}`;
      this.opts.store.setSetting('installId', id);
    }
    return id;
  }

  private url(p: string) {
    return this.opts.apiUrl.replace(/\/+$/, '') + p;
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.stopped = false;
    void this.checkIn();
    // Periodic check-in is only a fallback: with the live channel up, changes arrive instantly.
    this.timer = setInterval(() => {
      if (!this.liveConnected || Date.now() - (this.status.lastCheck ?? 0) > 15 * 60_000) void this.checkIn();
    }, this.opts.intervalMs ?? 3 * 60_000);
    this.timer.unref();
    if (this.opts.live !== false) this.connectLive();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.liveRetry) clearTimeout(this.liveRetry);
    for (const t of this.maintTimers) clearTimeout(t);
    this.ws?.terminate();
    this.ws = null;
  }

  /**
   * Live channel: a WebSocket to the owner service. The service only ever
   * sends "refresh" (no data); this PC then checks in as usual, so a lock,
   * message or announcement shows up within a second.
   */
  private connectLive() {
    if (this.stopped || this.ws) return;
    const url = this.url(`/v1/live?installId=${encodeURIComponent(this.installId)}`).replace(/^http/, 'ws');
    const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    this.ws = ws;
    let alive = true;
    let ping: NodeJS.Timeout | null = null;
    ws.on('open', () => {
      this.liveConnected = true;
      this.liveBackoff = 2000;
      void this.checkIn(); // catch up on anything missed while disconnected
      ping = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        try {
          ws.send('ping');
        } catch {
          /* closing */
        }
      }, 25_000);
      ping.unref();
    });
    ws.on('message', (m) => {
      alive = true;
      if (m.toString() === 'refresh') {
        if (this.refreshSoon) clearTimeout(this.refreshSoon);
        this.refreshSoon = setTimeout(() => void this.checkIn(), 150);
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      // an older owner service without live updates: try again much later
      if (res.statusCode === 404 || res.statusCode === 501) this.liveBackoff = 30 * 60_000;
    });
    ws.on('error', () => undefined);
    ws.on('close', () => {
      if (ping) clearInterval(ping);
      this.liveConnected = false;
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.liveRetry = setTimeout(() => this.connectLive(), this.liveBackoff);
      this.liveRetry.unref();
      this.liveBackoff = Math.min(this.liveBackoff * 2, Math.max(this.liveBackoff, 5 * 60_000));
    });
  }

  /** Check in exactly when a scheduled maintenance window starts and ends. */
  private scheduleMaintenance(m: OwnerStatus['maintenance']) {
    for (const t of this.maintTimers) clearTimeout(t);
    this.maintTimers = [];
    if (!m) return;
    for (const at of [m.start, m.end + 1000]) {
      const delay = at - Date.now();
      if (delay > 0 && delay < 7 * 24 * 60 * 60_000) {
        const t = setTimeout(() => {
          this.emit('status', this.status); // local lock/unlock right away
          void this.checkIn();
        }, delay);
        t.unref();
        this.maintTimers.push(t);
      }
    }
  }

  async checkIn(invite?: string): Promise<OwnerStatus & { inviteError?: string | null }> {
    if (!this.enabled) return this.status;
    let inviteError: string | null = null;
    try {
      const res = await this.fetchImpl(this.url('/v1/checkin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installId: this.installId,
          name: this.opts.name().slice(0, 40) || 'PC',
          kind: 'pc',
          platform: this.opts.platform.slice(0, 24),
          appVersion: this.opts.appVersion,
          ...(invite ? { invite: invite.trim().slice(0, 32) } : {})
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!res.ok) return this.status;
      const b = (await res.json()) as Record<string, unknown>;
      const m = b.maintenance as OwnerStatus['maintenance'];
      const pm = b.personal as OwnerStatus['personal'];
      inviteError = typeof b.inviteError === 'string' ? b.inviteError : null;
      this.update({
        enabled: true,
        locked: !!b.locked,
        reason: REASONS.includes(b.reason as LockReason) ? (b.reason as LockReason) : null,
        message: typeof b.message === 'string' ? b.message.slice(0, 300) : '',
        announcement: typeof b.announcement === 'string' ? b.announcement.slice(0, 500) : '',
        updateAvailable: !!b.updateAvailable,
        admin: !!b.admin,
        lastCheck: Date.now(),
        maintenance: m && typeof m === 'object' ? { start: num(m.start), end: num(m.end), message: String(m.message ?? '').slice(0, 300) } : null,
        personal: pm && typeof pm === 'object' && pm.text ? { text: String(pm.text).slice(0, 300), at: num(pm.at) } : null,
        beta: !!b.beta,
        stableVersion: typeof b.stableVersion === 'string' && /^(\d+\.\d+\.\d+)?$/.test(b.stableVersion) ? b.stableVersion : ''
      });
    } catch {
      /* offline – keep the last known status */
    }
    return { ...this.status, inviteError };
  }

  /** Redeems an invite code for this PC. */
  async redeemInvite(code: string): Promise<OwnerStatus> {
    const r = await this.checkIn(code);
    if (r.inviteError) throw new Error(r.inviteError);
    if (r.lastCheck === null || Date.now() - r.lastCheck > 15_000) throw new Error('The owner service could not be reached');
    return this.status;
  }

  /** Makes this PC an admin install (exempt from the lock). The code is verified by the service. */
  async login(code: string): Promise<void> {
    if (!this.enabled) throw new Error('The owner service is not configured in this build');
    await this.checkIn();
    const res = await this.fetchImpl(this.url('/v1/admin/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installId: this.installId, code }),
      signal: AbortSignal.timeout(10_000)
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; token?: string };
    if (!res.ok) throw new Error(body.error ?? `error ${res.status}`);
    if (body.token) this.setToken(body.token);
    await this.checkIn();
  }

  hasToken(): boolean {
    return !!this.getToken();
  }

  private getToken(): string | null {
    // memory copy keeps the session working if OS secure storage is unavailable
    return this.opts.tokenStore?.get() ?? this.memToken;
  }

  private setToken(t: string | null) {
    this.memToken = t;
    try {
      this.opts.tokenStore?.set(t);
    } catch {
      /* stays signed in until the app restarts */
    }
  }

  private async admin<T>(method: 'GET' | 'POST', p: string, body?: unknown): Promise<T> {
    const token = this.getToken();
    if (!token) throw new Error('not signed in as admin');
    const res = await this.fetchImpl(this.url(p), {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000)
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.status === 401) this.setToken(null);
    if (!res.ok) throw new Error(json.error ?? `error ${res.status}`);
    return json;
  }

  overview() {
    return this.admin<AdminOverview>('GET', '/v1/admin/overview');
  }

  stats(days = 30) {
    return this.admin<OwnerStats>('GET', `/v1/admin/stats?days=${Math.round(days)}`);
  }

  setConfig(c: Partial<AdminConfig>) {
    return this.admin<{ config: AdminConfig }>('POST', '/v1/admin/config', c);
  }

  updateInstall(installId: string, patch: { blocked?: boolean; remove?: true; approve?: true; beta?: boolean; message?: string }) {
    return this.admin<{ ok: true }>('POST', '/v1/admin/install', { installId, ...patch });
  }

  auditLog() {
    return this.admin<{ entries: AdminLogEntry[] }>('GET', '/v1/admin/log');
  }

  release() {
    return this.admin<{ config: AdminConfig }>('POST', '/v1/admin/release', {});
  }

  createInvite(maxUses: number, note: string) {
    return this.admin<{ code: string }>('POST', '/v1/admin/invite', { maxUses, note });
  }

  deleteInvite(code: string) {
    return this.admin<{ ok: true }>('POST', '/v1/admin/invite/delete', { code });
  }

  notifyTest() {
    return this.admin<{ ok: true }>('POST', '/v1/admin/notify-test', {});
  }

  async logout() {
    await this.admin('POST', '/v1/admin/logout', {}).catch(() => undefined);
    this.setToken(null);
  }

  private update(s: OwnerStatus) {
    if (JSON.stringify(s.maintenance) !== JSON.stringify(this.status.maintenance) || !this.maintTimers.length) this.scheduleMaintenance(s.maintenance);
    this.status = s;
    this.opts.store.setSetting('ownerStatus', s);
    this.emit('status', s);
  }
}
