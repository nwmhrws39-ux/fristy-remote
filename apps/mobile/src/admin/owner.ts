import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { DEFAULT_ADMIN_API_URL } from '@fristy/shared';
import { readJson, remove, writeJson } from '../store/secure';
import { legalAccepted } from '../legal/legal';

/*
 * Client for the optional FRISTY owner service (apps/admin-server).
 * Enabled only when the build has EXPO_PUBLIC_ADMIN_API_URL (https).
 * Sends: random install id, the name the user typed, device type, platform,
 * app version. Never IP addresses, files, screens or keystrokes.
 */

const API = (process.env.EXPO_PUBLIC_ADMIN_API_URL || DEFAULT_ADMIN_API_URL).replace(/\/+$/, '');
export const ownerEnabled = /^https:\/\/[^\s/]+/.test(API);

export type LockReason = 'locked' | 'blocked' | 'invite' | 'maintenance';

export interface OwnerStatus {
  locked: boolean;
  reason: LockReason | null;
  message: string;
  announcement: string;
  updateAvailable: boolean;
  admin: boolean;
  checked: boolean;
  maintenance: { start: number; end: number; message: string } | null;
  personal: { text: string; at: number } | null;
  beta: boolean;
  /** newest version this install may update to ('' = any) */
  stableVersion: string;
}

const REASONS: LockReason[] = ['locked', 'blocked', 'invite', 'maintenance'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export interface InstallInfo {
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

export interface Overview {
  config: AdminConfig;
  you: string;
  betaVersions: { pc: string; ios: string };
  invites: { code: string; note: string; maxUses: number; uses: number; createdAt: number }[];
  installs: InstallInfo[];
}

export interface LogEntry {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

const K_ID = 'fristy.installId.v1';
const K_STATUS = 'fristy.ownerStatus.v1';
const K_TOKEN = 'fristy.adminToken.v1';

const appVersion = () => {
  const v = Constants.expoConfig?.version ?? '0.0.0';
  return /^\d+\.\d+\.\d+$/.test(v) ? v : '0.0.0';
};

let status: OwnerStatus = {
  locked: false,
  reason: null,
  message: '',
  announcement: '',
  updateAvailable: false,
  admin: false,
  checked: false,
  maintenance: null,
  personal: null,
  beta: false,
  stableVersion: ''
};
const listeners = new Set<() => void>();
let userName: () => string = () => '';
let timer: ReturnType<typeof setInterval> | null = null;

export const ownerStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  get: () => status
};

let maintTimers: ReturnType<typeof setTimeout>[] = [];

/** Check in exactly when a scheduled maintenance window starts and ends. */
function scheduleMaintenance(m: OwnerStatus['maintenance']) {
  for (const t of maintTimers) clearTimeout(t);
  maintTimers = [];
  if (!m) return;
  for (const at of [m.start, m.end + 1000]) {
    const delay = at - Date.now();
    if (delay > 0 && delay < 7 * 24 * 60 * 60_000)
      maintTimers.push(
        setTimeout(() => {
          set({ ...status }); // re-render: the lock screen appears/disappears on time
          void checkIn();
        }, delay)
      );
  }
}

function set(s: OwnerStatus) {
  if (JSON.stringify(s.maintenance) !== JSON.stringify(status.maintenance) || !maintTimers.length) scheduleMaintenance(s.maintenance);
  status = s;
  for (const l of listeners) l();
}

async function installId(): Promise<string> {
  let id = await readJson<string | null>(K_ID, null);
  if (!id) {
    id = `ph-${Crypto.randomUUID()}`;
    await writeJson(K_ID, id);
  }
  return id;
}

async function request<T>(method: 'GET' | 'POST', p: string, body?: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await readJson<string | null>(K_TOKEN, null);
    if (!token) throw new Error('not signed in as admin');
    headers.Authorization = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      if (res.status === 401 && auth) await remove(K_TOKEN);
      throw new Error(json.error ?? `error ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

export async function checkIn(invite?: string): Promise<OwnerStatus & { inviteError?: string | null }> {
  if (!ownerEnabled) return status;
  // nothing is sent before the user has accepted the current terms
  if (!legalAccepted()) return status;
  const name = userName().trim();
  if (!name) return status;
  let inviteError: string | null = null;
  try {
    const r = await request<Record<string, unknown>>('POST', '/v1/checkin', {
      installId: await installId(),
      name: name.slice(0, 40),
      kind: 'phone',
      platform: Platform.OS,
      appVersion: appVersion(),
      ...(invite ? { invite: invite.trim().slice(0, 32) } : {})
    });
    const m = r.maintenance as OwnerStatus['maintenance'];
    const pm = r.personal as OwnerStatus['personal'];
    inviteError = typeof r.inviteError === 'string' ? r.inviteError : null;
    const next: OwnerStatus = {
      locked: !!r.locked,
      reason: REASONS.includes(r.reason as LockReason) ? (r.reason as LockReason) : null,
      message: String(r.message ?? '').slice(0, 300),
      announcement: String(r.announcement ?? '').slice(0, 500),
      updateAvailable: !!r.updateAvailable,
      admin: !!r.admin,
      checked: true,
      maintenance: m && typeof m === 'object' ? { start: num(m.start), end: num(m.end), message: String(m.message ?? '').slice(0, 300) } : null,
      personal: pm && typeof pm === 'object' && pm.text ? { text: String(pm.text).slice(0, 300), at: num(pm.at) } : null,
      beta: !!r.beta,
      stableVersion: typeof r.stableVersion === 'string' && /^(\d+\.\d+\.\d+)?$/.test(r.stableVersion) ? r.stableVersion : ''
    };
    await writeJson(K_STATUS, next);
    set(next);
  } catch {
    /* offline: keep the last known status (a lock stays in force) */
    if (invite) throw new Error('The owner service could not be reached');
  }
  return { ...status, inviteError };
}

/** Everything the owner service stores about this phone (data access / portability). */
export async function exportMyData(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('POST', '/v1/me/export', { installId: await installId() });
}

/** Erases this phone's record on the owner service and starts over with a new install id. */
export async function deleteMyData(): Promise<{ deleted: boolean }> {
  const r = await request<{ deleted: boolean }>('POST', '/v1/me/delete', { installId: await installId() });
  await remove(K_ID);
  await remove(K_TOKEN);
  await remove(K_STATUS);
  return r;
}

/** Abuse / security report to the operator. */
export async function sendReport(category: string, message: string, contact?: string): Promise<void> {
  await request('POST', '/v1/report', { installId: await installId(), category, message, ...(contact ? { contact } : {}) });
}

/** Starts talking to the owner service right after the terms were accepted. */
export function resumeOwner() {
  void checkIn();
  if (timer) setLive(true);
}

/** Stops the live channel (used when the user withdraws acceptance). */
export function stopOwner() {
  setLive(false);
}

/** Redeems an invite code for this phone. */
export async function redeemInvite(code: string): Promise<void> {
  const r = await checkIn(code);
  if (r.inviteError) throw new Error(r.inviteError);
}

/*
 * Live channel: while the app is open it holds a WebSocket to the owner
 * service. The service only ever sends "refresh" (no data) and the app then
 * checks in, so a lock or a message shows up within a second.
 */
let ws: WebSocket | null = null;
let liveRetry: ReturnType<typeof setTimeout> | null = null;
let liveBackoff = 2000;
let liveWanted = false;

async function connectLive() {
  if (!liveWanted || ws || !ownerEnabled || !legalAccepted()) return;
  const id = await installId();
  const sock = new WebSocket(`${API.replace(/^http/, 'ws')}/v1/live?installId=${encodeURIComponent(id)}`);
  ws = sock;
  let ping: ReturnType<typeof setInterval> | null = null;
  let refresh: ReturnType<typeof setTimeout> | null = null;
  let alive = true;
  sock.onopen = () => {
    liveBackoff = 2000;
    void checkIn(); // catch up on anything missed
    ping = setInterval(() => {
      if (!alive) return sock.close();
      alive = false;
      try {
        sock.send('ping');
      } catch {
        /* closing */
      }
    }, 25_000);
  };
  sock.onmessage = (e) => {
    alive = true;
    if (e.data === 'refresh') {
      if (refresh) clearTimeout(refresh);
      refresh = setTimeout(() => void checkIn(), 150);
    }
  };
  sock.onerror = () => undefined;
  sock.onclose = () => {
    if (ping) clearInterval(ping);
    if (ws === sock) ws = null;
    if (!liveWanted) return;
    liveRetry = setTimeout(() => void connectLive(), liveBackoff);
    liveBackoff = Math.min(liveBackoff * 2, 5 * 60_000);
  };
}

function setLive(on: boolean) {
  liveWanted = on;
  if (liveRetry) clearTimeout(liveRetry);
  liveRetry = null;
  if (on) {
    liveBackoff = 2000;
    void connectLive();
  } else {
    ws?.close();
    ws = null;
  }
}

/** Loads the cached status, connects the live channel and starts fallback check-ins. */
export async function startOwner(getName: () => string) {
  userName = getName;
  if (!ownerEnabled) return;
  const cached = await readJson<OwnerStatus | null>(K_STATUS, null);
  if (cached) set({ ...status, ...cached, checked: true });
  void checkIn();
  if (!timer) {
    // fallback only: with the live channel open, changes arrive instantly
    timer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) void checkIn();
    }, 3 * 60_000);
    AppState.addEventListener('change', (s) => {
      // iOS suspends background apps anyway: close the socket there, reconnect (and catch up) on return
      if (s === 'active') {
        void checkIn();
        setLive(true);
      } else if (s === 'background') setLive(false);
    });
    setLive(true);
  }
}

export async function adminLogin(code: string): Promise<void> {
  await checkIn();
  const r = await request<{ token: string }>('POST', '/v1/admin/login', { installId: await installId(), code });
  await writeJson(K_TOKEN, r.token);
  await checkIn();
}

export async function hasAdminToken(): Promise<boolean> {
  return !!(await readJson<string | null>(K_TOKEN, null));
}

/** True when the owner server is older than this app (it lacks the newer admin features). */
export let serverOutdated = false;

/** Fills in fields an older owner server does not send yet, so the panel never crashes. */
export async function getOverview(): Promise<Overview> {
  const o = await request<Omit<Partial<Overview>, 'config'> & { config?: Partial<AdminConfig> }>('GET', '/v1/admin/overview', undefined, true);
  const c: Partial<AdminConfig> = o.config ?? {};
  serverOutdated = !Array.isArray(o.invites);
  return {
    you: o.you ?? '',
    betaVersions: { pc: o.betaVersions?.pc ?? '', ios: o.betaVersions?.ios ?? '' },
    invites: Array.isArray(o.invites) ? o.invites : [],
    installs: (Array.isArray(o.installs) ? o.installs : []).map((i) => ({ ...i, pending: !!i.pending, beta: !!i.beta, message: i.message ?? '' })),
    config: {
      locked: !!c.locked,
      lockMessage: c.lockMessage ?? '',
      announcement: c.announcement ?? '',
      minVersion: c.minVersion ?? '',
      inviteRequired: !!c.inviteRequired,
      maintenance: c.maintenance ?? null,
      notifyTopic: c.notifyTopic ?? '',
      betaChannel: !!c.betaChannel,
      stablePc: c.stablePc ?? '',
      stableIos: c.stableIos ?? ''
    }
  };
}

export interface OwnerStats {
  days: { day: string; users: number; phones: number; pcs: number; newUsers: number }[];
  versions: { version: string; kind: string; users: number }[];
  countries: { country: string | null; users: number }[];
  totals: { users: number; phones: number; pcs: number; active7: number; active30: number };
}

export const getStats = async (days: number): Promise<OwnerStats> => {
  const s = await request<Partial<OwnerStats>>('GET', `/v1/admin/stats?days=${days}`, undefined, true);
  return { days: s.days ?? [], versions: s.versions ?? [], countries: s.countries ?? [], totals: s.totals ?? { users: 0, phones: 0, pcs: 0, active7: 0, active30: 0 } };
};

export const setConfig = (c: Partial<AdminConfig>) => request<{ config: AdminConfig }>('POST', '/v1/admin/config', c, true);
export const getLog = () => request<{ entries: LogEntry[] }>('GET', '/v1/admin/log', undefined, true);
export const releaseToEveryone = () => request<{ config: AdminConfig }>('POST', '/v1/admin/release', {}, true);
export const createInvite = (maxUses: number, note: string) => request<{ code: string }>('POST', '/v1/admin/invite', { maxUses, note }, true);
export const deleteInvite = (code: string) => request<{ ok: true }>('POST', '/v1/admin/invite/delete', { code }, true);
export interface AttemptLimit {
  id: string;
  installId: string | null;
  name: string | null;
  kind: 'admin' | 'invite';
  attempts: number;
  resetAt: number;
}
/** Version of the deployed owner service (0 = older than version reporting, -1 = unreachable). */
export async function getServerVersion(): Promise<number> {
  try {
    const res = await fetch(API + '/');
    const b = (await res.json().catch(() => ({}))) as { version?: unknown };
    return typeof b.version === 'number' ? b.version : 0;
  } catch {
    return -1;
  }
}
export const getLimits = () => request<{ limits: AttemptLimit[] }>('GET', '/v1/admin/limits', undefined, true);
export const resetLimit = (p: { installId?: string; id?: string }) => request<{ ok: true }>('POST', '/v1/admin/limits/reset', p, true);
export const notifyTest = () => request<{ ok: true }>('POST', '/v1/admin/notify-test', {}, true);

export const updateInstall = (installId: string, patch: { blocked?: boolean; admin?: false; remove?: true; approve?: true; beta?: boolean; message?: string }) =>
  request<{ ok: true }>('POST', '/v1/admin/install', { installId, ...patch }, true);

export async function adminLogout() {
  await request('POST', '/v1/admin/logout', {}, true).catch(() => undefined);
  await remove(K_TOKEN);
  await checkIn();
}
