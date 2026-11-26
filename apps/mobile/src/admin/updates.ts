import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { compareVersions } from './version';
import { readJson, writeJson } from '../store/secure';

/*
 * Mandatory updates for the iPhone app. Sideloaded apps cannot replace
 * themselves, so when a newer iPhone build exists in the public releases
 * repository this version locks itself and links to the new one.
 * Enabled only when the build has EXPO_PUBLIC_RELEASES_REPO ("owner/repo").
 */

const REPO = process.env.EXPO_PUBLIC_RELEASES_REPO ?? '';
export const updatesEnabled = /^[\w.-]+\/[\w.-]+$/.test(REPO);

export interface UpdateInfo {
  required: boolean;
  latest: string | null;
  url: string | null;
}

const K = 'fristy.latestIos.v1';
let state: UpdateInfo = { required: false, latest: null, url: null };
const listeners = new Set<() => void>();
let started = false;

export const updateStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  get: () => state
};

export const currentVersion = () => {
  const v = Constants.expoConfig?.version ?? '0.0.0';
  return /^\d+\.\d+\.\d+$/.test(v) ? v : '0.0.0';
};

function apply(latest: string | null, url: string | null) {
  const required = !!latest && compareVersions(currentVersion(), latest) < 0;
  state = { required, latest, url };
  for (const l of listeners) l();
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!updatesEnabled) return state;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) return state;
    const list = (await res.json()) as { tag_name?: string; draft?: boolean; html_url?: string }[];
    let best: { v: string; url: string } | null = null;
    for (const r of list) {
      const m = /^ios-v(\d+\.\d+\.\d+)$/.exec(r.tag_name ?? '');
      if (!m || r.draft) continue;
      if (!best || compareVersions(m[1]!, best.v) > 0) best = { v: m[1]!, url: r.html_url ?? `https://github.com/${REPO}/releases` };
    }
    if (best) {
      await writeJson(K, best);
      apply(best.v, best.url);
    }
  } catch {
    /* offline – keep the last known result */
  }
  return state;
}

export async function startUpdateChecks() {
  if (!updatesEnabled || started) return;
  started = true;
  // Enforce the last known latest version even when offline.
  const cached = await readJson<{ v: string; url: string } | null>(K, null);
  if (cached) apply(cached.v, cached.url);
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), 30 * 60_000);
  AppState.addEventListener('change', (s) => s === 'active' && void checkForUpdate());
}
