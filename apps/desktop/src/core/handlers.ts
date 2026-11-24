import type { z } from 'zod';
import type { AudioState, EventName, METHODS, MethodName, MethodResults, ServerEvents, SystemStats } from '@fristy/protocol';
import type { Platform, ProcessInfo } from './platform/types';
import { PlatformError } from './platform/types';
import type { HandlerContext } from './server';
import type { AppService } from './services/apps';
import type { FileService } from './services/files';
import type { GameService } from './services/games';
import type { MacroService } from './services/macros';
import type { ProcessCache } from './services/processes';

type Params<M extends MethodName> = z.output<(typeof METHODS)[M]['params']>;
type MethodHandlers = { [M in MethodName]: (ctx: HandlerContext, p: Params<M>) => Promise<MethodResults[M]> };

export interface Handlers {
  methods: MethodHandlers;
  onDisconnect(deviceId: string): Promise<void>;
}

export interface HandlerDeps {
  platform: Platform;
  apps: AppService;
  games: GameService;
  files: FileService;
  macros: MacroService;
  procs: ProcessCache;
  stats(): Promise<SystemStats>;
  broadcast<E extends EventName>(event: E, data: ServerEvents[E], permission?: 'power' | 'monitor' | null): void;
}

function err(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Best-effort "now playing" from media player window titles (Spotify shows "Artist - Track"). */
export function nowPlayingFrom(procs: ProcessInfo[]): AudioState['nowPlaying'] {
  const spotify = procs.find((p) => p.name.toLowerCase() === 'spotify' && p.title && / - /.test(p.title));
  if (spotify?.title) return { app: 'Spotify', title: spotify.title };
  return null;
}

export function createHandlers(d: HandlerDeps): Handlers {
  let schedule: { action: 'shutdown' | 'restart'; at: number; timer: NodeJS.Timeout } | null = null;

  const mediaKey = { playPause: 'mediaPlayPause', next: 'mediaNext', previous: 'mediaPrevious', stop: 'mediaStop' } as const;

  const wrapPlatform = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof PlatformError) throw err(e.code === 'unsupported' ? 'unsupported' : e.code === 'not_found' ? 'not_found' : 'internal', e.message);
      throw e;
    }
  };

  const methods: MethodHandlers = {
    'session.ping': async (_c, p) => ({ t: p.t, serverTime: Date.now() }),
    'session.subscribeStats': async (c, p) => {
      c.setStatsSubscription(p.enabled);
      return { enabled: p.enabled };
    },

    'system.info': () => wrapPlatform(() => d.platform.info()),
    'system.stats': () => d.stats(),

    'power.action': async (c, p) => {
      if ((p.action === 'shutdown' || p.action === 'restart') && p.confirm !== true) {
        throw err('confirmation_required', `${p.action} requires confirmation`);
      }
      if (p.action === 'shutdown' || p.action === 'restart') {
        d.broadcast('alert', { type: 'shutdown', message: `${c.deviceName} requested ${p.action}` }, 'monitor');
      }
      await wrapPlatform(() => d.platform.power(p.action));
      return { ok: true };
    },
    'power.schedule': async (_c, p) => {
      await wrapPlatform(() => d.platform.scheduleShutdown(p.action, p.delaySec));
      if (schedule) clearTimeout(schedule.timer);
      const at = Date.now() + p.delaySec * 1000;
      const timer = setTimeout(() => {
        schedule = null;
      }, p.delaySec * 1000);
      timer.unref();
      schedule = { action: p.action, at, timer };
      d.broadcast('powerSchedule', { action: p.action, at }, 'power');
      return { action: p.action, at };
    },
    'power.cancelSchedule': async () => {
      await wrapPlatform(() => d.platform.cancelShutdown()).catch((e) => {
        // shutdown /a fails when nothing is scheduled – that's fine if we had nothing either
        if (schedule) throw e;
      });
      const had = schedule !== null;
      if (schedule) clearTimeout(schedule.timer);
      schedule = null;
      d.broadcast('powerSchedule', null, 'power');
      return { cancelled: had };
    },
    'power.scheduleState': async () => (schedule ? { action: schedule.action, at: schedule.at } : null),

    'apps.list': () => d.apps.list(),
    'apps.launch': (_c, p) => wrapPlatform(() => d.apps.launch(p.appId)),
    'apps.close': (_c, p) => wrapPlatform(() => d.apps.close(p.appId)),
    'apps.favorite': async (_c, p) => d.apps.favorite(p.appId, p.favorite),
    'apps.urls': async () => d.apps.urls(),
    'apps.openUrl': (_c, p) => wrapPlatform(() => d.apps.openUrl(p.url)),

    'games.list': () => d.games.list(),
    'games.launch': (_c, p) => wrapPlatform(() => d.games.launch(p.gameId)),
    'games.close': (_c, p) => wrapPlatform(() => d.games.close(p.gameId)),
    'games.favorite': async (_c, p) => d.games.favorite(p.gameId, p.favorite),

    'input.mouseMove': async (_c, p) => {
      await wrapPlatform(() => d.platform.mouseMove(p.dx, p.dy));
      return null;
    },
    'input.mouseButton': async (_c, p) => {
      await wrapPlatform(() => d.platform.mouseButton(p.button, p.action));
      return null;
    },
    'input.scroll': async (_c, p) => {
      await wrapPlatform(() => d.platform.scroll(p.dx, p.dy));
      return null;
    },
    'input.text': async (_c, p) => {
      await wrapPlatform(() => d.platform.typeText(p.text));
      return null;
    },
    'input.key': async (_c, p) => {
      await wrapPlatform(() => d.platform.pressKey(p.key, p.modifiers));
      return null;
    },

    'audio.state': async () => {
      const [state, procs] = await Promise.all([wrapPlatform(() => d.platform.audioState()), d.procs.list()]);
      return { ...state, nowPlaying: nowPlayingFrom(procs) };
    },
    'audio.setVolume': async (_c, p) => {
      await wrapPlatform(() => d.platform.setVolume(p.level));
      return { ok: true };
    },
    'audio.setMute': async (_c, p) => {
      await wrapPlatform(() => d.platform.setMute(p.muted));
      return { ok: true };
    },
    'audio.setMicMute': async (_c, p) => {
      await wrapPlatform(() => d.platform.setMicMute(p.muted));
      return { ok: true };
    },
    'audio.setAppVolume': async (_c, p) => {
      await wrapPlatform(() => d.platform.setAppVolume(p.pid, p.level, null));
      return { ok: true };
    },
    'audio.setAppMute': async (_c, p) => {
      await wrapPlatform(() => d.platform.setAppVolume(p.pid, null, p.muted));
      return { ok: true };
    },
    'audio.setDefaultDevice': async (_c, p) => {
      const state = await wrapPlatform(() => d.platform.audioState());
      const list = p.kind === 'output' ? state.outputs : state.inputs;
      if (!list.some((x) => x.id === p.deviceId)) throw err('not_found', 'audio device not found');
      await wrapPlatform(() => d.platform.setDefaultDevice(p.deviceId));
      return { ok: true };
    },
    'audio.media': async (_c, p) => {
      await wrapPlatform(() => d.platform.pressKey(mediaKey[p.action], []));
      return { ok: true };
    },

    'files.roots': async () => d.files.roots(),
    'files.list': (_c, p) => d.files.list(p.rootId, p.path),
    'files.downloadStart': (c, p) => d.files.downloadStart(c.deviceId, p.rootId, p.path),
    'files.downloadChunk': (c, p) => d.files.downloadChunk(c.deviceId, p.transferId, p.index),
    'files.uploadStart': (c, p) => d.files.uploadStart(c.deviceId, p.rootId, p.dir, p.name, p.size),
    'files.uploadChunk': (c, p) => d.files.uploadChunk(c.deviceId, p.transferId, p.index, p.data),
    'files.finish': (c, p) => d.files.finish(c.deviceId, p.transferId),
    'files.pause': async (c, p) => d.files.pause(c.deviceId, p.transferId, p.paused),
    'files.cancel': (c, p) => d.files.cancel(c.deviceId, p.transferId),
    'files.history': async (c) => d.files.history(c.deviceId),

    'macros.list': async () => d.macros.list(),
    'macros.run': (c, p) =>
      d.macros.run(p.macroId, c.permissions, {
        launchApp: (id) => wrapPlatform(() => d.apps.launch(id)),
        launchGame: (id) => wrapPlatform(() => d.games.launch(id)),
        openUrl: (url) => wrapPlatform(() => d.apps.openUrl(url)),
        setVolume: (level) => wrapPlatform(() => d.platform.setVolume(level)),
        mute: (m) => wrapPlatform(() => d.platform.setMute(m)),
        media: (a) => wrapPlatform(() => d.platform.pressKey(mediaKey[a], [])),
        power: (a) => wrapPlatform(() => d.platform.power(a))
      })
  };

  return {
    methods,
    onDisconnect: (deviceId) => d.files.cancelDevice(deviceId)
  };
}
