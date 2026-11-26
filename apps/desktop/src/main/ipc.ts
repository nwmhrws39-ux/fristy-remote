import path from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import QRCode from 'qrcode';
import { randomId } from '@fristy/shared';
import type { FristyCore } from '../core';
import type { SecretStore } from '../core/identity';
import { FristyLauncherClient } from '../core/integrations/fristy-launcher';
import { IPC, type IpcChannel } from './ipc-contract';
import { runDiagnostics } from './diagnostics';
import type { Updater } from './updater';

type Handler = (payload: never, win: BrowserWindow | null) => unknown;

export function registerIpc(core: FristyCore, secrets: SecretStore, isTrustedUrl: (url: string) => boolean, updater: Updater) {
  const handlers: Record<IpcChannel, Handler> = {
    'state.get': () => core.state(),
    'pairing.create': () => core.createPairing(),
    'pairing.cancel': () => core.cancelPairing(),
    'pairing.approve': (p: { id: string; permissions: never[] }) => core.approvePairing(p.id, p.permissions),
    'pairing.deny': (p: { id: string }) => core.denyPairing(p.id),
    'pairing.qr': (p: { text: string }) =>
      QRCode.toDataURL(p.text, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#0b0b12', light: '#ffffff' } }),
    'devices.revoke': (p: { id: string }) => core.server.revokeDevice(p.id),
    'devices.permissions': (p: { id: string; permissions: never[] }) => core.server.updatePermissions(p.id, p.permissions),
    'devices.rename': (p: { id: string; name: string }) => {
      core.store.renameDevice(p.id, p.name);
      core.emitState();
    },
    'devices.disconnectAll': () => core.server.disconnectAll(),
    'settings.update': (p: Record<string, unknown>) => {
      const next = core.settings.update(p as never);
      if ('startWithWindows' in p) {
        app.setLoginItemSettings({ openAtLogin: next.startWithWindows, args: ['--hidden'] });
      }
      return next;
    },
    'stats.get': () => core.stats(),
    'info.get': () => core.systemInfo(),
    'logs.list': (p?: { category?: string }) => core.store.listLogs(300, p?.category),
    'apps.list': () => core.store.listApps(),
    'apps.addDialog': async (_p, win) => {
      const r = await dialog.showOpenDialog(win!, {
        title: 'Add application',
        properties: ['openFile'],
        filters: [{ name: 'Applications', extensions: ['exe'] }]
      });
      if (r.canceled || !r.filePaths[0]) return null;
      return core.apps.addExecutable(r.filePaths[0]);
    },
    'apps.detect': () => core.apps.addDetectedPresets(),
    'apps.remove': (p: { id: string }) => core.store.removeApp(p.id),
    'games.list': () => core.store.listGames(true),
    'games.rescan': () => core.games.rescan(),
    'games.addManual': (p: never) => core.games.addManual(p),
    'games.addExeDialog': async (p: { name?: string; source?: 'ea' | 'rockstar' | 'manual' }, win) => {
      const r = await dialog.showOpenDialog(win!, {
        title: 'Select game executable',
        properties: ['openFile'],
        filters: [{ name: 'Games', extensions: ['exe'] }]
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const exe = r.filePaths[0];
      return core.games.addManual({ name: p.name || path.basename(exe, '.exe'), kind: 'exe', target: exe, source: p.source ?? 'manual' });
    },
    'games.hide': (p: { id: string; hidden: boolean }) => core.store.setGameHidden(p.id, p.hidden),
    'games.remove': (p: { id: string }) => core.store.removeGame(p.id),
    'urls.list': () => core.store.listUrls(),
    'urls.add': (p: { label: string; url: string }) => {
      const u = new URL(p.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) websites can be approved');
      core.store.addUrl({ id: randomId(6), label: p.label, url: u.toString() });
    },
    'urls.remove': (p: { id: string }) => core.store.removeUrl(p.id),
    'folders.list': () => core.store.listSharedFolders(),
    'folders.addDialog': async (p: { writable: boolean }, win) => {
      const r = await dialog.showOpenDialog(win!, { title: 'Choose a folder to share', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      const dir = r.filePaths[0];
      const forbidden = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
        .filter(Boolean)
        .map((d) => path.resolve(d!).toLowerCase());
      const resolved = path.resolve(dir).toLowerCase();
      if (forbidden.some((f) => resolved === f || resolved.startsWith(f + path.sep)) || /^[a-z]:\\?$/i.test(dir)) {
        throw new Error('System folders and whole drives cannot be shared');
      }
      const row = { id: randomId(6), name: path.basename(dir) || dir, path: dir, writable: p.writable };
      core.store.addSharedFolder(row);
      core.store.log('security', 'files', `Shared folder added: ${dir} (${p.writable ? 'read/write' : 'read only'})`);
      return row;
    },
    'folders.remove': (p: { id: string }) => {
      core.store.removeSharedFolder(p.id);
      core.store.log('security', 'files', 'Shared folder removed');
    },
    'macros.list': () => core.macros.list(),
    'macros.save': (p: never) => core.macros.save(p),
    'macros.remove': (p: { id: string }) => core.macros.remove(p.id),
    'transfers.list': () => core.store.listTransfers(),
    'diagnostics.run': () => runDiagnostics(core),
    'launcher.setToken': (p: { token: string | null }) => secrets.set('launcher-token', p.token),
    'launcher.test': async () => {
      const s = core.settings.get();
      const client = new FristyLauncherClient(s.launcherApiUrl, () => secrets.get('launcher-token'));
      return client.health();
    },
    'owner.login': (p: { code: string }) => core.owner.login(p.code),
    'owner.refresh': () => core.owner.checkIn(),
    'owner.overview': () => core.owner.overview(),
    'owner.hasToken': () => core.owner.hasToken(),
    'owner.stats': (p: { days: number }) => core.owner.stats(p.days),
    'owner.config': (p: Record<string, unknown>) => core.owner.setConfig(p),
    'owner.install': (p: { installId: string; blocked: boolean }) => core.owner.updateInstall(p.installId, { blocked: p.blocked }),
    'owner.logout': () => core.owner.logout(),
    'update.state': () => updater.state,
    'update.check': () => updater.check(),
    'update.install': () => updater.install(),
    'app.info': () => ({ version: app.getVersion(), platform: process.platform, electron: process.versions.electron }),
    'shell.openDocs': (p: { page: 'wol' | 'security' | 'readme' }) => {
      // Documentation ships with the app (extraResources/docs) – no network needed.
      const files = { wol: 'WAKE_ON_LAN.md', security: 'SECURITY.md', readme: 'README.md' } as const;
      const base = app.isPackaged ? path.join(process.resourcesPath, 'docs') : path.join(app.getAppPath(), '..', '..', 'docs');
      return shell.openPath(path.join(base, files[p.page]));
    }
  };

  ipcMain.handle('fristy:invoke', async (event: IpcMainInvokeEvent, channel: unknown, payload: unknown) => {
    // Only our own renderer may call privileged APIs.
    if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) throw new Error('untrusted sender');
    if (typeof channel !== 'string' || !Object.prototype.hasOwnProperty.call(IPC, channel)) throw new Error('unknown channel');
    const schema = IPC[channel as IpcChannel];
    const parsed = schema.safeParse(payload ?? undefined);
    if (!parsed.success) throw new Error(`invalid payload: ${parsed.error.issues[0]?.message ?? 'error'}`);
    const win = BrowserWindow.fromWebContents(event.sender);
    return handlers[channel as IpcChannel](parsed.data as never, win);
  });
}
