import fs from 'node:fs';
import path from 'node:path';
import type { AppEntry } from '@fristy/protocol';
import { randomId } from '@fristy/shared';
import type { AppRow, Store, UrlRow } from '../db';
import type { Platform } from '../platform/types';
import { ProcessCache, processesForExecutable } from './processes';

export class AppError extends Error {
  constructor(
    readonly code: 'not_found' | 'forbidden' | 'bad_request',
    message: string
  ) {
    super(message);
  }
}

export interface AppPreset {
  key: string;
  name: string;
  candidates: string[];
  args: string[];
  processName: string | null;
}

/** Well-known install locations for the preset applications. */
export function appPresets(env: NodeJS.ProcessEnv = process.env): AppPreset[] {
  const pf = env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = env['LOCALAPPDATA'] ?? '';
  const roaming = env['APPDATA'] ?? '';
  const j = path.win32.join;
  return [
    {
      key: 'chrome',
      name: 'Google Chrome',
      candidates: [j(pf, 'Google\\Chrome\\Application\\chrome.exe'), j(pf86, 'Google\\Chrome\\Application\\chrome.exe'), j(local, 'Google\\Chrome\\Application\\chrome.exe')],
      args: [],
      processName: 'chrome'
    },
    {
      key: 'discord',
      name: 'Discord',
      candidates: [j(local, 'Discord\\Update.exe')],
      args: ['--processStart', 'Discord.exe'],
      processName: 'Discord'
    },
    { key: 'spotify', name: 'Spotify', candidates: [j(roaming, 'Spotify\\Spotify.exe')], args: [], processName: 'Spotify' },
    { key: 'obs', name: 'OBS Studio', candidates: [j(pf, 'obs-studio\\bin\\64bit\\obs64.exe')], args: [], processName: 'obs64' },
    {
      key: 'vscode',
      name: 'Visual Studio Code',
      candidates: [j(local, 'Programs\\Microsoft VS Code\\Code.exe'), j(pf, 'Microsoft VS Code\\Code.exe')],
      args: [],
      processName: 'Code'
    },
    { key: 'steam', name: 'Steam', candidates: [j(pf86, 'Steam\\steam.exe'), j(pf, 'Steam\\steam.exe')], args: [], processName: 'steam' }
  ];
}

/** Hostname allow-list check for "open approved website". */
export function isApprovedUrl(url: string, approved: UrlRow[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  return approved.some((a) => {
    try {
      const host = new URL(a.url).hostname.toLowerCase();
      const h = u.hostname.toLowerCase();
      return h === host || h.endsWith('.' + host);
    } catch {
      return false;
    }
  });
}

export class AppService {
  constructor(
    private readonly store: Store,
    private readonly platform: Platform,
    private readonly procs: ProcessCache,
    private readonly iconFor: (exe: string) => Promise<string | null> = async () => null
  ) {}

  async list(): Promise<AppEntry[]> {
    const procs = await this.procs.list();
    return this.store.listApps().map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      favorite: a.favorite,
      running: processesForExecutable(procs, a.path, a.processName).length > 0
    }));
  }

  async launch(appId: string) {
    const app = this.store.getApp(appId);
    if (!app) throw new AppError('not_found', 'application is not on the approved list');
    if (!fs.existsSync(app.path)) throw new AppError('not_found', 'application executable no longer exists');
    await this.platform.launchExecutable(app.path, app.args, path.dirname(app.path));
    this.procs.invalidate();
    return { ok: true as const };
  }

  async close(appId: string) {
    const app = this.store.getApp(appId);
    if (!app) throw new AppError('not_found', 'application is not on the approved list');
    const pids = processesForExecutable(await this.procs.list(), app.path, app.processName).map((p) => p.pid);
    const closed = await this.platform.closeProcesses(pids, false);
    this.procs.invalidate();
    return { closed };
  }

  favorite(appId: string, favorite: boolean) {
    if (!this.store.getApp(appId)) throw new AppError('not_found', 'application not found');
    this.store.setAppFavorite(appId, favorite);
    return { ok: true as const };
  }

  /* ---- owner-side management (desktop UI only, never callable remotely) ---- */

  async addExecutable(exePath: string, name?: string, args: string[] = [], processName: string | null = null): Promise<AppRow> {
    if (!/\.exe$/i.test(exePath) || !fs.existsSync(exePath)) throw new AppError('bad_request', 'select an existing .exe file');
    const row: AppRow = {
      id: randomId(8),
      name: (name ?? path.basename(exePath, path.extname(exePath))).slice(0, 64),
      path: exePath,
      args: args.slice(0, 16).map((a) => a.slice(0, 256)),
      processName,
      icon: await this.iconFor(exePath),
      favorite: false
    };
    this.store.upsertApp(row);
    return row;
  }

  /** Adds every preset whose executable is installed and not yet added. */
  async addDetectedPresets(): Promise<number> {
    const existing = new Set(this.store.listApps().map((a) => a.path.toLowerCase()));
    let added = 0;
    for (const p of appPresets()) {
      const found = p.candidates.find((c) => c && fs.existsSync(c));
      if (!found || existing.has(found.toLowerCase())) continue;
      const iconSource = p.key === 'discord' ? path.join(path.dirname(found), 'app.ico') : found;
      this.store.upsertApp({
        id: p.key,
        name: p.name,
        path: found,
        args: p.args,
        processName: p.processName,
        icon: await this.iconFor(fs.existsSync(iconSource) ? iconSource : found),
        favorite: false
      });
      added++;
    }
    return added;
  }

  urls() {
    return this.store.listUrls();
  }

  async openUrl(url: string) {
    if (!isApprovedUrl(url, this.store.listUrls())) throw new AppError('forbidden', 'this website is not on the approved list');
    await this.platform.openUrl(new URL(url).toString());
    return { ok: true as const };
  }
}
