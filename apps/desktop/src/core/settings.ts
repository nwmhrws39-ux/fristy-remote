import { z } from 'zod';
import { DEFAULT_CONTROL_PORT } from '@fristy/protocol';
import type { Store } from './db';

export const SettingsSchema = z.object({
  /** master switch: when false the control server does not listen at all */
  remoteEnabled: z.boolean(),
  /** global gate for remote mouse/keyboard, in addition to per-device permission */
  inputEnabled: z.boolean(),
  /** global gate for remote screen viewing, in addition to per-device permission */
  screenEnabled: z.boolean(),
  port: z.number().int().min(1024).max(65535),
  language: z.enum(['en', 'he']),
  theme: z.enum(['dark', 'light']),
  accent: z.enum(['purple', 'violet', 'blue', 'pink', 'green']),
  startWithWindows: z.boolean(),
  startMinimized: z.boolean(),
  relayEnabled: z.boolean(),
  relayUrl: z.string().max(512),
  maxTransferMB: z.number().int().min(1).max(20_000),
  alertCpuTemp: z.number().int().min(40).max(110),
  alertGpuTemp: z.number().int().min(40).max(110),
  alertLowStoragePct: z.number().int().min(1).max(50),
  /** FRISTY Launcher local API (optional integration) */
  launcherIntegration: z.boolean(),
  launcherApiUrl: z.string().max(256),
  /** privacy: days to keep the security log and transfer history */
  historyRetentionDays: z.number().int().min(1).max(3650)
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  remoteEnabled: true,
  inputEnabled: false,
  screenEnabled: false,
  port: DEFAULT_CONTROL_PORT,
  language: 'en',
  theme: 'dark',
  accent: 'purple',
  startWithWindows: false,
  startMinimized: false,
  relayEnabled: false,
  relayUrl: '',
  maxTransferMB: 2048,
  alertCpuTemp: 90,
  alertGpuTemp: 85,
  alertLowStoragePct: 10,
  launcherIntegration: false,
  launcherApiUrl: 'http://127.0.0.1:47820',
  historyRetentionDays: 90
};

export class SettingsManager {
  private cache: Settings;
  private listeners = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

  constructor(private readonly store: Store) {
    const saved = store.getSetting<Partial<Settings>>('settings', {});
    const merged = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...saved });
    this.cache = merged.success ? merged.data : { ...DEFAULT_SETTINGS };
  }

  get(): Settings {
    return { ...this.cache };
  }

  update(patch: Partial<Settings>): Settings {
    const next = SettingsSchema.parse({ ...this.cache, ...patch });
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== this.cache[k]);
    if (next.relayUrl && !/^wss:\/\//.test(next.relayUrl) && !/^ws:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(next.relayUrl)) {
      throw new Error('Relay URL must use wss:// (plain ws:// is only allowed for localhost testing)');
    }
    this.cache = next;
    this.store.setSetting('settings', next);
    if (changed.length) for (const l of this.listeners) l(this.get(), changed);
    return this.get();
  }

  onChange(cb: (s: Settings, changed: (keyof Settings)[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
