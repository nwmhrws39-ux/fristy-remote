import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteError, type RemoteClient } from '@fristy/shared';
import type { FristyCore } from '../src/core';
import type { DesktopBridge } from '../src/core/bridge';
import { authClient, fakePlatform, pairDevice, startCore } from './helpers';

/** Fake Electron bridge: one 1920×1080 display at origin, recorded side effects. */
function fakeBridge() {
  const log: [string, ...unknown[]][] = [];
  let clip = 'pc clipboard text';
  const bridge: DesktopBridge = {
    displays: () => [{ id: '1', name: 'Main', width: 1920, height: 1080, primary: true }],
    grab: async (id, maxWidth, quality) => {
      log.push(['grab', id, maxWidth, quality]);
      return { w: Math.min(maxWidth, 1920), h: 540, data: Buffer.from('jpeg').toString('base64'), cursor: { x: 0.25, y: 0.5 } };
    },
    toScreenPoint: (_id, nx, ny) => ({ x: Math.round(nx * 1919), y: Math.round(ny * 1079) }),
    cursor: () => ({ x: 0.25, y: 0.5 }),
    clipboardRead: async () => clip,
    clipboardWrite: (t) => {
      clip = t;
      log.push(['clipboardWrite', t]);
    },
    notify: (title, body) => log.push(['notify', title, body]),
    openPath: async (f) => {
      log.push(['openPath', f]);
      return '';
    }
  };
  return { bridge, log, clip: () => clip };
}

let core: FristyCore;
let platform: ReturnType<typeof fakePlatform>;
let fb: ReturnType<typeof fakeBridge>;
const clients: RemoteClient[] = [];

beforeEach(async () => {
  fb = fakeBridge();
  platform = fakePlatform();
  ({ core } = await startCore(platform, fb.bridge));
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await core.stop();
});

async function paired(grants: Parameters<typeof pairDevice>[1]) {
  const r = await pairDevice(core, grants);
  clients.push(r.client);
  return r.client;
}
const code = (p: Promise<unknown>, c: string) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof RemoteError && e.code === c);

describe('screen viewing', () => {
  it('needs the screen permission and the global switch, and is logged', async () => {
    const noPerm = await paired(['monitor']);
    await code(noPerm.call('screen.displays', {}), 'forbidden');

    const c = await paired(['screen']);
    await code(c.call('screen.frame', { displayId: '1', maxWidth: 1280, quality: 50 }), 'screen_disabled');
    core.settings.update({ screenEnabled: true });
    const displays = await c.call('screen.displays', {});
    expect(displays).toEqual([{ id: '1', name: 'Main', width: 1920, height: 1080, primary: true }]);
    const frame = await c.call('screen.frame', { displayId: '1', maxWidth: 1280, quality: 50 });
    expect(frame.w).toBe(1280);
    expect(frame.cursor).toEqual({ x: 0.25, y: 0.5 });
    expect(await c.call('screen.cursor', { displayId: '1' })).toEqual({ x: 0.25, y: 0.5 });
    expect(frame.ts).toBeGreaterThan(0);
    await code(c.call('screen.frame', { displayId: 'nope', maxWidth: 1280, quality: 50 }), 'not_found');
    expect(core.store.listLogs(50).some((l) => l.category === 'screen' && /started viewing/.test(l.message))).toBe(true);
  });

  it('emergency stop turns screen viewing off too', async () => {
    core.settings.update({ screenEnabled: true, inputEnabled: true });
    const c = await paired(['screen']);
    await c.call('screen.displays', {});
    core.emergencyStop();
    await code(c.call('screen.displays', {}), 'screen_disabled');
  });

  it('tap-to-click maps normalized points to screen pixels and needs input', async () => {
    core.settings.update({ screenEnabled: true });
    const viewer = await paired(['screen']);
    await code(viewer.call('input.moveTo', { displayId: '1', x: 0.5, y: 0.5 }), 'forbidden');

    const c = await paired(['screen', 'input']);
    await code(c.call('input.moveTo', { displayId: '1', x: 0.5, y: 0.5 }), 'input_disabled');
    core.settings.update({ inputEnabled: true });
    await c.call('input.moveTo', { displayId: '1', x: 0.5, y: 1 });
    expect(platform.calls).toContainEqual(['moveCursor', 960, 1079]);
    await code(c.call('input.moveTo', { displayId: '1', x: 1.5, y: 0 }), 'bad_request');
  });
});

describe('clipboard, messages, open on PC', () => {
  it('clipboard needs its own permission', async () => {
    const no = await paired(['monitor', 'input']);
    await code(no.call('clipboard.get', {}), 'forbidden');
    const c = await paired(['clipboard']);
    expect(await c.call('clipboard.get', {})).toEqual({ text: 'pc clipboard text' });
    await c.call('clipboard.set', { text: 'from phone' });
    expect(fb.clip()).toBe('from phone');
  });

  it('shows a message on the PC and optionally speaks it', async () => {
    const c = await paired(['apps']);
    await c.call('system.message', { text: 'dinner is ready', speak: true });
    expect(fb.log).toContainEqual(['notify', 'FRISTY Remote – Test Phone', 'dinner is ready']);
    expect(platform.calls).toContainEqual(['speak', 'dinner is ready']);
  });

  it('opens only media/documents inside shared folders', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fristy-open-'));
    fs.writeFileSync(path.join(dir, 'movie.mp4'), 'x');
    fs.writeFileSync(path.join(dir, 'evil.exe'), 'x');
    fs.writeFileSync(path.join(dir, 'run.bat'), 'x');
    fs.writeFileSync(path.join(dir, 'link.lnk'), 'x');
    core.store.addSharedFolder({ id: 's', name: 'S', path: dir, writable: false });
    const c = await paired(['files']);
    await c.call('files.open', { rootId: 's', path: 'movie.mp4' });
    expect(fb.log).toContainEqual(['openPath', path.join(fs.realpathSync(dir), 'movie.mp4')]);
    for (const bad of ['evil.exe', 'run.bat', 'link.lnk']) await code(c.call('files.open', { rootId: 's', path: bad }), 'forbidden');
    await code(c.call('files.open', { rootId: 's', path: '../../etc/passwd' }), 'forbidden');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('mandatory updates', () => {
  it('refuses phones while an update must be installed, then works again', async () => {
    const { identity, client } = await pairDevice(core, ['monitor']);
    client.close();
    core.setUpdateRequired('A new version is available. Click "Update now" on the PC.');
    await code(authClient(core, identity).connect(), 'remote_disabled');
    core.setUpdateRequired(null);
    const ok = authClient(core, identity);
    clients.push(ok);
    await expect(ok.connect()).resolves.toMatchObject({ paired: false });
  });
});

describe('without Electron', () => {
  it('reports unsupported instead of failing silently', async () => {
    await core.stop();
    ({ core } = await startCore(platform));
    core.settings.update({ screenEnabled: true });
    const c = await paired(['screen']);
    await code(c.call('screen.displays', {}), 'unsupported');
  });
});
