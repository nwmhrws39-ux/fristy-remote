import { getLocales } from 'expo-localization';
import type { AccentName } from '@fristy/ui';
import type { Language } from '@fristy/shared';
import { readJson, writeJson } from './secure';

export interface NotificationPrefs {
  startup: boolean;
  shutdown: boolean;
  cpuTemp: boolean;
  gpuTemp: boolean;
  lowStorage: boolean;
  gameLaunched: boolean;
  transferComplete: boolean;
  unauthorizedAttempt: boolean;
  deviceDisconnected: boolean;
}

export interface Prefs {
  language: Language;
  theme: 'dark' | 'light';
  accent: AccentName;
  sensitivity: number; // 0.5 .. 3
  naturalScroll: boolean;
  haptics: boolean;
  notifications: NotificationPrefs;
  /** name shown to the app owner (only used when the owner service is configured) */
  userName: string;
}

export const DEFAULT_PREFS: Prefs = {
  language: 'en',
  theme: 'dark',
  accent: 'purple',
  sensitivity: 1.4,
  naturalScroll: false,
  haptics: true,
  userName: '',
  notifications: {
    startup: true,
    shutdown: true,
    cpuTemp: true,
    gpuTemp: true,
    lowStorage: true,
    gameLaunched: false,
    transferComplete: true,
    unauthorizedAttempt: true,
    deviceDisconnected: false
  }
};

const KEY = 'fristy.prefs.v1';

export async function loadPrefs(): Promise<Prefs> {
  const p = await readJson<Partial<Prefs> | null>(KEY, null);
  // First run: follow the phone's language.
  const language: Language = getLocales()[0]?.languageCode === 'he' ? 'he' : 'en';
  const base = { ...DEFAULT_PREFS, language };
  if (!p) return base;
  return { ...base, ...p, notifications: { ...DEFAULT_PREFS.notifications, ...(p.notifications ?? {}) } };
}

export const savePrefs = (p: Prefs) => writeJson(KEY, p);
