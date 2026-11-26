import { z } from 'zod';
import { MacroStepSchema, PERMISSIONS } from '@fristy/protocol';

/**
 * Every IPC call the renderer may make, with its payload schema.
 * The preload exposes a single `invoke(channel, payload)`; main rejects any
 * channel not listed here and validates every payload before use.
 */
const id = z.string().min(1).max(128);
const none = z.undefined().or(z.null()).or(z.object({}).strict());
const perms = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

export const IPC = {
  'state.get': none,
  'pairing.create': none,
  'pairing.cancel': none,
  'pairing.approve': z.object({ id, permissions: perms }).strict(),
  'pairing.deny': z.object({ id }).strict(),
  'pairing.qr': z.object({ text: z.string().max(4096) }).strict(),
  'devices.revoke': z.object({ id }).strict(),
  'devices.permissions': z.object({ id, permissions: perms }).strict(),
  'devices.rename': z.object({ id, name: z.string().min(1).max(64) }).strict(),
  'devices.disconnectAll': none,
  'settings.update': z.record(z.string(), z.unknown()),
  'stats.get': none,
  'info.get': none,
  'logs.list': z.object({ category: z.string().max(32).optional() }).strict().optional(),
  'apps.list': none,
  'apps.addDialog': none,
  'apps.detect': none,
  'apps.remove': z.object({ id }).strict(),
  'games.list': none,
  'games.rescan': none,
  'games.addManual': z
    .object({
      name: z.string().min(1).max(96),
      kind: z.enum(['uri', 'aumid']),
      target: z.string().min(1).max(512),
      source: z.enum(['steam', 'epic', 'rockstar', 'ea', 'ubisoft', 'xbox', 'battlenet', 'manual']).optional(),
      artworkUrl: z.string().max(1024).nullable().optional()
    })
    .strict(),
  'games.addExeDialog': z.object({ name: z.string().max(96).optional(), source: z.enum(['ea', 'rockstar', 'manual']).optional() }).strict(),
  'games.hide': z.object({ id, hidden: z.boolean() }).strict(),
  'games.remove': z.object({ id }).strict(),
  'urls.list': none,
  'urls.add': z.object({ label: z.string().min(1).max(64), url: z.string().url().max(2048) }).strict(),
  'urls.remove': z.object({ id }).strict(),
  'folders.list': none,
  'folders.addDialog': z.object({ writable: z.boolean() }).strict(),
  'folders.remove': z.object({ id }).strict(),
  'macros.list': none,
  'macros.save': z
    .object({
      id: z.string().max(64).optional(),
      name: z.string().min(1).max(48),
      icon: z.string().max(32),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      steps: z.array(MacroStepSchema).min(1).max(20)
    })
    .strict(),
  'macros.remove': z.object({ id }).strict(),
  'transfers.list': none,
  'diagnostics.run': none,
  'launcher.setToken': z.object({ token: z.string().max(512).nullable() }).strict(),
  'launcher.test': none,
  'app.info': none,
  'owner.login': z.object({ code: z.string().min(1).max(128) }).strict(),
  'owner.refresh': none,
  'owner.overview': none,
  'owner.hasToken': none,
  'owner.config': z
    .object({
      locked: z.boolean().optional(),
      lockMessage: z.string().max(300).optional(),
      announcement: z.string().max(500).optional(),
      minVersion: z.string().regex(/^(\d+\.\d+\.\d+)?$/).optional()
    })
    .strict(),
  'owner.install': z.object({ installId: z.string().min(1).max(80), blocked: z.boolean() }).strict(),
  'owner.logout': none,
  'update.state': none,
  'update.check': none,
  'update.install': none,
  'shell.openDocs': z.object({ page: z.enum(['wol', 'security', 'readme']) }).strict()
} as const;

export type IpcChannel = keyof typeof IPC;
export const IPC_CHANNELS = Object.keys(IPC) as IpcChannel[];

/** main → renderer push events */
export const IPC_EVENTS = ['state', 'pairing-request', 'input-activity', 'security', 'update'] as const;
export type IpcEvent = (typeof IPC_EVENTS)[number];
