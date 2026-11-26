import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { readJson, remove, writeJson } from '../store/secure';

/*
 * Client for the optional FRISTY owner service (apps/admin-server).
 * Enabled only when the build has EXPO_PUBLIC_ADMIN_API_URL (https).
 * Sends: random install id, the name the user typed, device type, platform,
 * app version. Never IP addresses, files, screens or keystrokes.
 */

const API = (process.env.EXPO_PUBLIC_ADMIN_API_URL ?? '').replace(/\/+$/, '');
export const ownerEnabled = /^https:\/\/[^\s/]+/.test(API);

export interface OwnerStatus {
  locked: boolean;
  reason: 'locked' | 'blocked' | null;
  message: string;
  announcement: string;
  updateAvailable: boolean;
  admin: boolean;
  checked: boolean;
}

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
}

export interface Overview {
  config: { locked: boolean; lockMessage: string; announcement: string; minVersion: string };
  you: string;
  installs: InstallInfo[];
}

const K_ID = 'fristy.installId.v1';
const K_STATUS = 'fristy.ownerStatus.v1';
const K_TOKEN = 'fristy.adminToken.v1';

const appVersion = () => {
  const v = Constants.expoConfig?.version ?? '0.0.0';
  return /^\d+\.\d+\.\d+$/.test(v) ? v : '0.0.0';
};

let status: OwnerStatus = { locked: false, reason: null, message: '', announcement: '', updateAvailable: false, admin: false, checked: false };
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

export async function checkIn(): Promise<OwnerStatus> {
  if (!ownerEnabled) return status;
  const name = userName().trim();
  if (!name) return status;
  try {
    const r = await request<Omit<OwnerStatus, 'checked'>>('POST', '/v1/checkin', {
      installId: await installId(),
      name: name.slice(0, 40),
      kind: 'phone',
      platform: Platform.OS,
      appVersion: appVersion()
    });
    const next: OwnerStatus = {
      locked: !!r.locked,
      reason: r.reason === 'blocked' || r.reason === 'locked' ? r.reason : null,
      message: String(r.message ?? '').slice(0, 300),
      announcement: String(r.announcement ?? '').slice(0, 500),
      updateAvailable: !!r.updateAvailable,
      admin: !!r.admin,
      checked: true
    };
    await writeJson(K_STATUS, next);
    set(next);
  } catch {
    /* offline: keep the last known status (a lock stays in force) */
  }
  return status;
}

/** Loads the cached status and starts periodic check-ins. */
export async function startOwner(getName: () => string) {
  userName = getName;
  if (!ownerEnabled) return;
  const cached = await readJson<OwnerStatus | null>(K_STATUS, null);
  if (cached) set({ ...cached, checked: true });
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

export const setConfig = (c: Partial<Overview['config']>) => request<{ config: Overview['config'] }>('POST', '/v1/admin/config', c, true);

export const updateInstall = (installId: string, patch: { blocked?: boolean; admin?: false }) =>
  request<{ ok: true }>('POST', '/v1/admin/install', { installId, ...patch }, true);

export async function adminLogout() {
  await request('POST', '/v1/admin/logout', {}, true).catch(() => undefined);
  await remove(K_TOKEN);
  await checkIn();
}
