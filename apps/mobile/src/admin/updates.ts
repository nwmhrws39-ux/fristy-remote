import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { compareVersions } from './version';
import { readJson, writeJson } from '../store/secure';
import { ownerStore } from './owner';

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

const K = 'fristy.iosReleases.v1';
let releases: { v: string; url: string }[] = [];
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

/**
 * Picks the newest release this install may use. With the owner's beta
 * channel on, non-beta installs only go up to the released ("stable") version.
 */
function apply() {
  const stable = ownerStore.get().stableVersion;
  let best: { v: string; url: string } | null = null;
  for (const r of releases) {
    if (stable && compareVersions(r.v, stable) > 0) continue;
    if (!best || compareVersions(r.v, best.v) > 0) best = r;
  }
  const required = !!best && compareVersions(currentVersion(), best.v) < 0;
  state = { required, latest: best?.v ?? null, url: best?.url ?? null };
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
    const found: { v: string; url: string }[] = [];
    for (const r of list) {
      const m = /^ios-v(\d+\.\d+\.\d+)$/.exec(r.tag_name ?? '');
      if (!m || r.draft) continue;
      found.push({ v: m[1]!, url: r.html_url ?? `https://github.com/${REPO}/releases` });
    }
    if (found.length) {
      releases = found;
      await writeJson(K, found);
      apply();
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
  const cached = await readJson<{ v: string; url: string }[] | null>(K, null);
  if (Array.isArray(cached)) {
    releases = cached;
    apply();
  }
  // the owner may release a beta build to everyone – re-evaluate when that changes
  let stable = ownerStore.get().stableVersion;
  ownerStore.subscribe(() => {
    if (ownerStore.get().stableVersion !== stable) {
      stable = ownerStore.get().stableVersion;
      apply();
    }
  });
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), 30 * 60_000);
  AppState.addEventListener('change', (s) => s === 'active' && void checkForUpdate());
}
