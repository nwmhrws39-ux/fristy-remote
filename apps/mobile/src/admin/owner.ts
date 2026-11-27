import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { DEFAULT_ADMIN_API_URL } from '@fristy/shared';
import { readJson, remove, writeJson } from '../store/secure';

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

function set(s: OwnerStatus) {
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

/** Redeems an invite code for this phone. */
export async function redeemInvite(code: string): Promise<void> {
  const r = await checkIn(code);
  if (r.inviteError) throw new Error(r.inviteError);
}

/** Loads the cached status and starts periodic check-ins. */
export async function startOwner(getName: () => string) {
  userName = getName;
  if (!ownerEnabled) return;
  const cached = await readJson<OwnerStatus | null>(K_STATUS, null);
  if (cached) set({ ...status, ...cached, checked: true });
  void checkIn();
  if (!timer) {
    timer = setInterval(() => void checkIn(), 15 * 60_000);
    AppState.addEventListener('change', (s) => s === 'active' && void checkIn());
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

export const getOverview = () => request<Overview>('GET', '/v1/admin/overview', undefined, true);

export interface OwnerStats {
  days: { day: string; users: number; phones: number; pcs: number; newUsers: number }[];
  versions: { version: string; kind: string; users: number }[];
  countries: { country: string | null; users: number }[];
  totals: { users: number; phones: number; pcs: number; active7: number; active30: number };
}

export const getStats = (days: number) => request<OwnerStats>('GET', `/v1/admin/stats?days=${days}`, undefined, true);

export const setConfig = (c: Partial<AdminConfig>) => request<{ config: AdminConfig }>('POST', '/v1/admin/config', c, true);
export const getLog = () => request<{ entries: LogEntry[] }>('GET', '/v1/admin/log', undefined, true);
export const releaseToEveryone = () => request<{ config: AdminConfig }>('POST', '/v1/admin/release', {}, true);
export const createInvite = (maxUses: number, note: string) => request<{ code: string }>('POST', '/v1/admin/invite', { maxUses, note }, true);
export const deleteInvite = (code: string) => request<{ ok: true }>('POST', '/v1/admin/invite/delete', { code }, true);
export const notifyTest = () => request<{ ok: true }>('POST', '/v1/admin/notify-test', {}, true);

export const updateInstall = (installId: string, patch: { blocked?: boolean; admin?: false; remove?: true; approve?: true; beta?: boolean; message?: string }) =>
  request<{ ok: true }>('POST', '/v1/admin/install', { installId, ...patch }, true);

export async function adminLogout() {
  await request('POST', '/v1/admin/logout', {}, true).catch(() => undefined);
  await remove(K_TOKEN);
  await checkIn();
}
