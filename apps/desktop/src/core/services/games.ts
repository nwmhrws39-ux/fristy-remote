import fs from 'node:fs';
import path from 'node:path';
import type { GameEntry, GameSource } from '@fristy/protocol';
import { randomId } from '@fristy/shared';
import type { GameRow, LaunchKind, Store } from '../db';
import type { Platform } from '../platform/types';
import type { FristyLauncherClient } from '../integrations/fristy-launcher';
import { ProcessCache, processesForExecutable, processesInDirectory } from './processes';

export class GameError extends Error {
  constructor(
    readonly code: 'not_found' | 'bad_request' | 'forbidden',
    message: string
  ) {
    super(message);
  }
}

/**
 * Only official launcher protocols are ever opened. They hand the launch to
 * the store client, which keeps DRM, account authentication and updates intact.
 */
export const LAUNCHER_URI_PATTERNS: RegExp[] = [
  /^steam:\/\/rungameid\/\d{1,10}$/,
  /^com\.epicgames\.launcher:\/\/apps\/[A-Za-z0-9_.-]+%3A[A-Za-z0-9_.-]+%3A[A-Za-z0-9_.-]+\?action=launch&silent=true$/,
  /^uplay:\/\/launch\/\d{1,10}\/0$/,
  /^battlenet:\/\/[A-Za-z0-9]{1,16}$/,
  /^origin2:\/\/game\/launch\?offerIds=[A-Za-z0-9.:,_-]{1,256}$/
];

export function isAllowedLaunchUri(uri: string): boolean {
  return LAUNCHER_URI_PATTERNS.some((re) => re.test(uri));
}

const TICK_MS = 5000;

export class GameService {
  private running = new Map<string, number>(); // gameId -> since
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly platform: Platform,
    private readonly procs: ProcessCache,
    private readonly onLaunched: (game: GameRow) => void = () => undefined,
    private readonly launcher: FristyLauncherClient | null = null
  ) {}

  startTracking() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => undefined), TICK_MS);
    this.timer.unref();
    void this.tick().catch(() => undefined);
  }

  stopTracking() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private matchRunning(g: GameRow, procs: Awaited<ReturnType<ProcessCache['list']>>): number[] {
    if (g.launchKind === 'exe') return processesForExecutable(procs, g.launchTarget, null).map((p) => p.pid);
    if (g.installDir) return processesInDirectory(procs, g.installDir).map((p) => p.pid);
    return [];
  }

  /** Detects running games, accumulates playtime and emits launch events. */
  async tick() {
    const procs = await this.procs.list();
    const now = Date.now();
    for (const g of this.store.listGames()) {
      const isRunning = this.matchRunning(g, procs).length > 0;
      const since = this.running.get(g.id);
      if (isRunning && since === undefined) {
        this.running.set(g.id, now);
        this.store.markGamePlayed(g.id);
        this.onLaunched(g);
      } else if (isRunning && since !== undefined) {
        this.store.addPlaytime(g.id, TICK_MS / 1000);
      } else if (!isRunning && since !== undefined) {
        this.running.delete(g.id);
      }
    }
  }

  currentGame(): { id: string; name: string } | null {
    const [id] = [...this.running.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!id) return null;
    const g = this.store.getGame(id);
    return g ? { id: g.id, name: g.name } : null;
  }

  async list(): Promise<GameEntry[]> {
    return this.store.listGames().map((g) => ({
      id: g.id,
      name: g.name,
      source: g.source as GameSource,
      artworkUrl: g.artworkUrl,
      favorite: g.favorite,
      running: this.running.has(g.id),
      lastPlayed: g.lastPlayed,
      playtimeSec: g.playtimeSec
    }));
  }

  async launch(gameId: string) {
    const g = this.store.getGame(gameId);
    if (!g || g.hidden) throw new GameError('not_found', 'game not found');
    switch (g.launchKind) {
      case 'uri':
        if (!isAllowedLaunchUri(g.launchTarget)) throw new GameError('forbidden', 'launch target is not an official launcher protocol');
        await this.platform.openUri(g.launchTarget);
        break;
      case 'exe':
        if (!fs.existsSync(g.launchTarget)) throw new GameError('not_found', 'game executable not found');
        await this.platform.launchExecutable(g.launchTarget, [], path.dirname(g.launchTarget));
        break;
      case 'aumid':
        await this.platform.launchAumid(g.launchTarget);
        break;
      case 'fristy':
        if (!this.launcher) throw new GameError('bad_request', 'FRISTY Launcher integration is disabled');
        await this.launcher.launch(g.launchTarget);
        break;
    }
    this.procs.invalidate();
    this.store.markGamePlayed(g.id);
    return { ok: true as const };
  }

  async close(gameId: string) {
    const g = this.store.getGame(gameId);
    if (!g) throw new GameError('not_found', 'game not found');
    this.procs.invalidate();
    const pids = this.matchRunning(g, await this.procs.list());
    if (!pids.length) return { closed: 0 };
    // Ask nicely first; the remote user already confirmed, so force after a timeout.
    const closed = await this.platform.closeProcesses(pids, true);
    this.procs.invalidate();
    return { closed };
  }

  favorite(gameId: string, favorite: boolean) {
    if (!this.store.getGame(gameId)) throw new GameError('not_found', 'game not found');
    this.store.setGameFavorite(gameId, favorite);
    return { ok: true as const };
  }

  /* ---- owner-side management ---- */

  async rescan(): Promise<number> {
    const found = await this.platform.scanGames();
    for (const g of found) this.store.upsertGame({ ...g, manual: false });
    if (this.launcher) {
      try {
        for (const g of await this.launcher.listGames()) {
          this.store.upsertGame({
            id: `fristy:${g.id}`,
            name: g.name,
            source: 'fristy',
            launchKind: 'fristy',
            launchTarget: g.id,
            installDir: g.installDir,
            artworkUrl: g.artworkUrl,
            manual: false
          });
        }
      } catch {
        /* launcher not running – ignore */
      }
    }
    return found.length;
  }

  addManual(input: { name: string; kind: LaunchKind; target: string; source?: GameSource; artworkUrl?: string | null }): GameRow {
    const name = input.name.trim().slice(0, 96);
    if (!name) throw new GameError('bad_request', 'name is required');
    let installDir: string | null = null;
    if (input.kind === 'exe') {
      if (!/\.exe$/i.test(input.target) || !fs.existsSync(input.target)) throw new GameError('bad_request', 'select an existing .exe file');
      installDir = path.dirname(input.target);
    } else if (input.kind === 'uri') {
      if (!isAllowedLaunchUri(input.target)) throw new GameError('bad_request', 'only official launcher URIs are allowed');
    } else if (input.kind === 'aumid') {
      if (!/^[A-Za-z0-9._-]{1,128}_[a-z0-9]{13}![A-Za-z0-9._-]{1,64}$/.test(input.target)) {
        throw new GameError('bad_request', 'invalid AppUserModelID (example: Microsoft.MinecraftUWP_8wekyb3d8bbwe!App)');
      }
    } else {
      throw new GameError('bad_request', 'unsupported launch type');
    }
    const artwork = input.artworkUrl && /^https:\/\//.test(input.artworkUrl) ? input.artworkUrl : null;
    const row = {
      id: `manual:${randomId(6)}`,
      name,
      source: input.source ?? (input.kind === 'aumid' ? 'xbox' : 'manual'),
      launchKind: input.kind,
      launchTarget: input.target,
      installDir,
      artworkUrl: artwork,
      manual: true
    };
    this.store.upsertGame(row);
    return this.store.getGame(row.id)!;
  }
}
