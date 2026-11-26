import { EventEmitter } from 'node:events';
import { randomId } from '@fristy/shared';
import type { Store } from './db';

/*
 * Client for the optional FRISTY owner service (apps/admin-server).
 * Disabled unless the build was given an https:// URL. The PC checks in with
 * a random install id, its computer name, platform and version – no IP
 * addresses or personal data. When the owner locks the app, this PC refuses
 * phone connections until it is unlocked again (unless this install is an admin).
 */

export interface OwnerStatus {
  enabled: boolean;
  locked: boolean;
  reason: 'locked' | 'blocked' | null;
  message: string;
  announcement: string;
  updateAvailable: boolean;
  admin: boolean;
  lastCheck: number | null;
}

export interface OwnerOptions {
  apiUrl: string;
  store: Store;
  name: () => string;
  platform: string;
  appVersion: string;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
}

const DISABLED: OwnerStatus = { enabled: false, locked: false, reason: null, message: '', announcement: '', updateAvailable: false, admin: false, lastCheck: null };

export class OwnerClient extends EventEmitter<{ status: [OwnerStatus] }> {
  status: OwnerStatus;
  private timer: NodeJS.Timeout | null = null;
  private readonly fetchImpl: typeof fetch;

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
    void this.checkIn();
    this.timer = setInterval(() => void this.checkIn(), this.opts.intervalMs ?? 15 * 60_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkIn(): Promise<OwnerStatus> {
    if (!this.enabled) return this.status;
    try {
      const res = await this.fetchImpl(this.url('/v1/checkin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installId: this.installId,
          name: this.opts.name().slice(0, 40) || 'PC',
          kind: 'pc',
          platform: this.opts.platform.slice(0, 24),
          appVersion: this.opts.appVersion
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!res.ok) return this.status;
      const b = (await res.json()) as Partial<OwnerStatus>;
      this.update({
        enabled: true,
        locked: !!b.locked,
        reason: b.reason === 'blocked' || b.reason === 'locked' ? b.reason : null,
        message: typeof b.message === 'string' ? b.message.slice(0, 300) : '',
        announcement: typeof b.announcement === 'string' ? b.announcement.slice(0, 500) : '',
        updateAvailable: !!b.updateAvailable,
        admin: !!b.admin,
        lastCheck: Date.now()
      });
    } catch {
      /* offline – keep the last known status */
    }
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
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `error ${res.status}`);
    await this.checkIn();
  }

  private update(s: OwnerStatus) {
    this.status = s;
    this.opts.store.setSetting('ownerStatus', s);
    this.emit('status', s);
  }
}
