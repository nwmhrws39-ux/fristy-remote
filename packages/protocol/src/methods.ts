import { z } from 'zod';
import type { Permission } from './permissions';

/* ------------------------------------------------------------------ */
/* Shared domain types                                                 */
/* ------------------------------------------------------------------ */

/** Numbers are `null` when the hardware/OS cannot provide a real reading (shown as N/A). */
export interface SystemStats {
  ts: number;
  cpuLoad: number | null; // %
  cpuTemp: number | null; // °C
  gpuLoad: number | null; // %
  gpuTemp: number | null; // °C
  gpuName: string | null;
  memUsed: number | null; // bytes
  memTotal: number | null; // bytes
  diskFree: number | null; // bytes (sum of local fixed drives)
  diskTotal: number | null;
  netRx: number | null; // bytes/sec
  netTx: number | null; // bytes/sec
  uptime: number | null; // seconds
  runningGame: { id: string; name: string } | null;
  /** laptop battery; null on desktops / when unknown */
  battery?: { percent: number; charging: boolean } | null;
}

export interface DisplayInfo {
  id: string;
  name: string;
  width: number; // physical pixels
  height: number;
  primary: boolean;
}

export interface ScreenFrame {
  w: number;
  h: number;
  /** JPEG, base64 */
  data: string;
  ts: number;
  /** mouse cursor position on this display (0..1), null when it is on another display */
  cursor?: { x: number; y: number } | null;
}

/** File types that may be opened on the PC from the phone (never executables or scripts). */
export const OPENABLE_EXTENSIONS = [
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v',
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic',
  'pdf', 'txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'csv'
] as const;

export interface SystemInfo {
  computerName: string;
  os: string;
  cpuModel: string | null;
  gpuModels: string[];
  memTotal: number | null;
  wol: { supported: boolean; mac: string | null; broadcast: string | null; note: string };
}

export const GAME_SOURCES = ['steam', 'epic', 'rockstar', 'ea', 'ubisoft', 'xbox', 'battlenet', 'fristy', 'manual'] as const;
export type GameSource = (typeof GAME_SOURCES)[number];

export interface GameEntry {
  id: string;
  name: string;
  source: GameSource;
  artworkUrl: string | null;
  favorite: boolean;
  running: boolean;
  lastPlayed: number | null;
  playtimeSec: number;
}

export interface AppEntry {
  id: string;
  name: string;
  /** PNG data URL extracted from the executable, if available */
  icon: string | null;
  favorite: boolean;
  running: boolean;
}

export interface AudioSession {
  pid: number;
  name: string;
  volume: number; // 0..100
  muted: boolean;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AudioState {
  volume: number | null; // 0..100
  muted: boolean | null;
  micMuted: boolean | null;
  sessions: AudioSession[];
  outputs: AudioDevice[];
  inputs: AudioDevice[];
  nowPlaying: { app: string; title: string } | null;
}

export interface SharedRoot {
  id: string;
  name: string;
  writable: boolean;
}

export interface FileItem {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface TransferRecord {
  id: string;
  direction: 'upload' | 'download';
  name: string;
  size: number;
  transferred: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  startedAt: number;
  finishedAt: number | null;
}

export interface MacroEntry {
  id: string;
  name: string;
  icon: string;
  color: string;
  steps: MacroStep[];
}

/* ------------------------------------------------------------------ */
/* Macro steps (whitelisted actions only — no shell commands)          */
/* ------------------------------------------------------------------ */

export const MacroStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('launchApp'), appId: z.string().max(64) }),
  z.object({ type: z.literal('launchGame'), gameId: z.string().max(128) }),
  z.object({ type: z.literal('openUrl'), url: z.string().url().max(2048) }),
  z.object({ type: z.literal('setVolume'), level: z.number().int().min(0).max(100) }),
  z.object({ type: z.literal('mute'), muted: z.boolean() }),
  z.object({ type: z.literal('media'), action: z.enum(['playPause', 'next', 'previous', 'stop']) }),
  z.object({ type: z.literal('power'), action: z.enum(['lock', 'monitorOff', 'monitorOn', 'sleep']) }),
  z.object({ type: z.literal('wait'), ms: z.number().int().min(0).max(30_000) })
]);
export type MacroStep = z.infer<typeof MacroStepSchema>;

/* ------------------------------------------------------------------ */
/* Method table                                                         */
/* ------------------------------------------------------------------ */

const id = z.string().min(1).max(128);
const empty = z.object({}).strict();

export const KEY_NAMES = [
  'enter', 'escape', 'backspace', 'tab', 'space', 'delete', 'insert', 'home', 'end', 'pageUp', 'pageDown',
  'left', 'right', 'up', 'down',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'win', 'printScreen', 'capsLock',
  'volumeUp', 'volumeDown', 'volumeMute', 'mediaPlayPause', 'mediaNext', 'mediaPrevious', 'mediaStop',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export const MODIFIERS = ['ctrl', 'alt', 'shift', 'win'] as const;

/**
 * Every remote method: its parameter schema and the permission it requires.
 * `null` permission = available to any authenticated device.
 * The desktop rejects any method not in this table.
 */
export const METHODS = {
  'session.ping': { permission: null, params: z.object({ t: z.number() }).strict() },
  'session.subscribeStats': { permission: 'monitor', params: z.object({ enabled: z.boolean() }).strict() },

  'system.info': { permission: 'monitor', params: empty },
  'system.stats': { permission: 'monitor', params: empty },

  'power.action': {
    permission: 'power',
    params: z
      .object({
        action: z.enum(['shutdown', 'restart', 'sleep', 'hibernate', 'lock', 'monitorOff', 'monitorOn']),
        confirm: z.boolean().optional()
      })
      .strict()
  },
  'power.schedule': {
    permission: 'power',
    params: z
      .object({ action: z.enum(['shutdown', 'restart']), delaySec: z.number().int().min(30).max(24 * 3600), confirm: z.literal(true) })
      .strict()
  },
  'power.cancelSchedule': { permission: 'power', params: empty },
  'power.scheduleState': { permission: 'power', params: empty },

  'apps.list': { permission: 'apps', params: empty },
  'apps.launch': { permission: 'apps', params: z.object({ appId: id }).strict() },
  'apps.close': { permission: 'apps', params: z.object({ appId: id, confirm: z.literal(true) }).strict() },
  'apps.favorite': { permission: 'apps', params: z.object({ appId: id, favorite: z.boolean() }).strict() },
  'apps.urls': { permission: 'apps', params: empty },
  'apps.openUrl': { permission: 'apps', params: z.object({ url: z.string().url().max(2048) }).strict() },

  'games.list': { permission: 'games', params: empty },
  'games.launch': { permission: 'games', params: z.object({ gameId: id }).strict() },
  'games.close': { permission: 'games', params: z.object({ gameId: id, confirm: z.literal(true) }).strict() },
  'games.favorite': { permission: 'games', params: z.object({ gameId: id, favorite: z.boolean() }).strict() },

  'input.mouseMove': {
    permission: 'input',
    params: z.object({ dx: z.number().int().min(-2000).max(2000), dy: z.number().int().min(-2000).max(2000) }).strict()
  },
  'input.mouseButton': {
    permission: 'input',
    params: z
      .object({ button: z.enum(['left', 'right', 'middle']), action: z.enum(['click', 'double', 'down', 'up']) })
      .strict()
  },
  'input.scroll': {
    permission: 'input',
    params: z.object({ dx: z.number().int().min(-50).max(50), dy: z.number().int().min(-50).max(50) }).strict()
  },
  'input.text': { permission: 'input', params: z.object({ text: z.string().min(1).max(256) }).strict() },
  'input.key': {
    permission: 'input',
    params: z.object({ key: z.enum(KEY_NAMES), modifiers: z.array(z.enum(MODIFIERS)).max(4).default([]) }).strict()
  },

  'audio.state': { permission: 'audio', params: empty },
  'audio.setVolume': { permission: 'audio', params: z.object({ level: z.number().int().min(0).max(100) }).strict() },
  'audio.setMute': { permission: 'audio', params: z.object({ muted: z.boolean() }).strict() },
  'audio.setMicMute': { permission: 'audio', params: z.object({ muted: z.boolean() }).strict() },
  'audio.setAppVolume': {
    permission: 'audio',
    params: z.object({ pid: z.number().int().positive(), level: z.number().int().min(0).max(100) }).strict()
  },
  'audio.setAppMute': {
    permission: 'audio',
    params: z.object({ pid: z.number().int().positive(), muted: z.boolean() }).strict()
  },
  'audio.setDefaultDevice': {
    permission: 'audio',
    params: z.object({ deviceId: z.string().min(1).max(256), kind: z.enum(['output', 'input']) }).strict()
  },
  'audio.media': {
    permission: 'audio',
    params: z.object({ action: z.enum(['playPause', 'next', 'previous', 'stop']) }).strict()
  },

  'files.roots': { permission: 'files', params: empty },
  'files.list': { permission: 'files', params: z.object({ rootId: id, path: z.string().max(1024) }).strict() },
  'files.downloadStart': { permission: 'files', params: z.object({ rootId: id, path: z.string().min(1).max(1024) }).strict() },
  'files.downloadChunk': {
    permission: 'files',
    params: z.object({ transferId: id, index: z.number().int().min(0) }).strict()
  },
  'files.uploadStart': {
    permission: 'files',
    params: z
      .object({ rootId: id, dir: z.string().max(1024), name: z.string().min(1).max(255), size: z.number().int().min(0) })
      .strict()
  },
  'files.uploadChunk': {
    permission: 'files',
    params: z
      .object({ transferId: id, index: z.number().int().min(0), data: z.string().max(Math.ceil((128 * 1024 * 4) / 3) + 4) })
      .strict()
  },
  'files.finish': { permission: 'files', params: z.object({ transferId: id }).strict() },
  'files.pause': { permission: 'files', params: z.object({ transferId: id, paused: z.boolean() }).strict() },
  'files.cancel': { permission: 'files', params: z.object({ transferId: id }).strict() },
  'files.history': { permission: 'files', params: empty },

  'macros.list': { permission: 'macros', params: empty },
  'macros.run': { permission: 'macros', params: z.object({ macroId: id }).strict() },

  'screen.displays': { permission: 'screen', params: empty },
  'screen.frame': {
    permission: 'screen',
    params: z
      .object({
        displayId: z.string().min(1).max(64),
        maxWidth: z.number().int().min(320).max(2560),
        quality: z.number().int().min(20).max(90)
      })
      .strict()
  },
  'screen.cursor': { permission: 'screen', params: z.object({ displayId: z.string().min(1).max(64) }).strict() },
  'input.moveTo': {
    permission: 'input',
    params: z.object({ displayId: z.string().min(1).max(64), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()
  },

  'clipboard.get': { permission: 'clipboard', params: empty },
  'clipboard.set': { permission: 'clipboard', params: z.object({ text: z.string().max(10_000) }).strict() },

  'files.open': { permission: 'files', params: z.object({ rootId: id, path: z.string().min(1).max(1024) }).strict() },

  'system.message': {
    permission: 'apps',
    params: z.object({ text: z.string().min(1).max(300), speak: z.boolean() }).strict()
  }
} as const satisfies Record<string, { permission: Permission | null; params: z.ZodType }>;

export type MethodName = keyof typeof METHODS;
export type MethodParams<M extends MethodName> = z.input<(typeof METHODS)[M]['params']>;

/** Result type for each method (for typed clients). */
export interface MethodResults {
  'session.ping': { t: number; serverTime: number };
  'session.subscribeStats': { enabled: boolean };
  'system.info': SystemInfo;
  'system.stats': SystemStats;
  'power.action': { ok: true };
  'power.schedule': { action: 'shutdown' | 'restart'; at: number };
  'power.cancelSchedule': { cancelled: boolean };
  'power.scheduleState': { action: 'shutdown' | 'restart'; at: number } | null;
  'apps.list': AppEntry[];
  'apps.launch': { ok: true };
  'apps.close': { closed: number };
  'apps.favorite': { ok: true };
  'apps.urls': { id: string; label: string; url: string }[];
  'apps.openUrl': { ok: true };
  'games.list': GameEntry[];
  'games.launch': { ok: true };
  'games.close': { closed: number };
  'games.favorite': { ok: true };
  'input.mouseMove': null;
  'input.mouseButton': null;
  'input.scroll': null;
  'input.text': null;
  'input.key': null;
  'audio.state': AudioState;
  'audio.setVolume': { ok: true };
  'audio.setMute': { ok: true };
  'audio.setMicMute': { ok: true };
  'audio.setAppVolume': { ok: true };
  'audio.setAppMute': { ok: true };
  'audio.setDefaultDevice': { ok: true };
  'audio.media': { ok: true };
  'files.roots': SharedRoot[];
  'files.list': FileItem[];
  'files.downloadStart': { transferId: string; name: string; size: number; chunkSize: number; chunks: number };
  'files.downloadChunk': { index: number; data: string; last: boolean };
  'files.uploadStart': { transferId: string; chunkSize: number };
  'files.uploadChunk': { received: number };
  'files.finish': { ok: true; path: string };
  'files.pause': { ok: true };
  'files.cancel': { ok: true };
  'files.history': TransferRecord[];
  'macros.list': MacroEntry[];
  'macros.run': { steps: number };
  'screen.displays': DisplayInfo[];
  'screen.frame': ScreenFrame;
  'input.moveTo': null;
  'screen.cursor': { x: number; y: number } | null;
  'clipboard.get': { text: string };
  'clipboard.set': { ok: true };
  'files.open': { ok: true };
  'system.message': { ok: true; spoken: boolean; speakError: string | null };
}

/* ------------------------------------------------------------------ */
/* RPC envelopes (inside the encrypted channel)                         */
/* ------------------------------------------------------------------ */

export const RequestSchema = z.object({
  kind: z.literal('req'),
  id: z.number().int().nonnegative(),
  method: z.string().max(64),
  params: z.unknown()
});
export type RpcRequest = z.infer<typeof RequestSchema>;

export const ERROR_CODES = [
  'bad_request',
  'unknown_method',
  'forbidden',
  'input_disabled',
  'screen_disabled',
  'not_found',
  'confirmation_required',
  'rate_limited',
  'unsupported',
  'limit_exceeded',
  'internal'
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface RpcError {
  code: ErrorCode;
  message: string;
}

export type RpcResponse =
  | { kind: 'res'; id: number; ok: true; result: unknown }
  | { kind: 'res'; id: number; ok: false; error: RpcError };

export const ResponseSchema = z.union([
  z.object({ kind: z.literal('res'), id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    kind: z.literal('res'),
    id: z.number().int(),
    ok: z.literal(false),
    error: z.object({ code: z.enum(ERROR_CODES), message: z.string() })
  })
]);

/** Server → device push events. */
export interface ServerEvents {
  stats: SystemStats;
  permissions: { permissions: Permission[] };
  inputState: { enabled: boolean };
  alert: {
    type:
      | 'cpuTemp'
      | 'gpuTemp'
      | 'lowStorage'
      | 'gameLaunched'
      | 'transferComplete'
      | 'unauthorizedAttempt'
      | 'shutdown'
      | 'deviceDisconnected';
    message: string;
  };
  powerSchedule: { action: 'shutdown' | 'restart'; at: number } | null;
  revoked: { reason: string };
}
export type EventName = keyof ServerEvents;

export const EventSchema = z.object({
  kind: z.literal('evt'),
  event: z.string().max(64),
  data: z.unknown()
});

export const InboundToClientSchema = z.union([ResponseSchema, EventSchema]);

export function validateParams<M extends MethodName>(
  method: M,
  params: unknown
): { ok: true; value: z.output<(typeof METHODS)[M]['params']> } | { ok: false; message: string } {
  const def = METHODS[method];
  const parsed = def.params.safeParse(params ?? {});
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; ') };
  }
  return { ok: true, value: parsed.data as z.output<(typeof METHODS)[M]['params']> };
}

export function isMethodName(name: string): name is MethodName {
  return Object.prototype.hasOwnProperty.call(METHODS, name);
}
