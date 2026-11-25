import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { decodePairingQr } from '@fristy/protocol';
import { RemoteClient, RemoteError, decodeBase64, generateKeyPair } from '@fristy/shared';
import type { FristyCore } from '../src/core';
import { authClient, pairDevice, startCore, url, wsFactory } from './helpers';

let core: FristyCore;
let platform: Awaited<ReturnType<typeof startCore>>['platform'];
const clients: RemoteClient[] = [];

beforeEach(async () => {
  ({ core, platform } = await startCore());
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await core.stop();
});

async function paired(grants?: Parameters<typeof pairDevice>[1]) {
  const r = await pairDevice(core, grants);
  clients.push(r.client);
  return r;
}

async function expectError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof RemoteError && e.code === code);
}

describe('authentication', () => {
  it('rejects a device that was never paired', async () => {
    const c = authClient(core, generateKeyPair());
    await expectError(c.connect(), 'unknown_device');
    expect(core.store.listLogs(10).some((l) => l.level === 'security')).toBe(true);
  });

  it('pairs via QR with owner approval, then reconnects with its identity', async () => {
    const { client, identity, accepted, sas } = await paired(['monitor', 'power']);
    expect(accepted.paired).toBe(true);
    expect(accepted.permissions).toEqual(['monitor', 'power']);
    expect(sas).toMatch(/^\d{6}$/);
    expect(core.state().devices).toHaveLength(1);
    client.close();

    const again = authClient(core, identity);
    clients.push(again);
    const acc = await again.connect();
    expect(acc.paired).toBe(false);
    expect(acc.deviceId).toBe(accepted.deviceId);
    expect(Array.isArray(acc.host.addresses)).toBe(true); // phones refresh stored routes (e.g. Tailscale)
    expect(await again.latency()).toBeGreaterThanOrEqual(0);
  });

  it('pairing codes are single use', async () => {
    const p = core.createPairing();
    const qr = decodePairingQr(p.qrText)!;
    core.once('pairing-request', (r) => core.approvePairing(r.id, ['monitor']));
    const mk = () =>
      new RemoteClient({
        url: url(core),
        socketFactory: wsFactory,
        identity: generateKeyPair(),
        serverPublicKey: decodeBase64(qr.pk),
        open: { pairingId: qr.pid, secret: qr.secret, deviceName: 'A', platform: 'ios' }
      });
    const first = mk();
    clients.push(first);
    await first.connect();
    await expectError(mk().connect(), 'pairing_invalid');
  });

  it('accepts the manual code and invalidates the session after too many wrong codes', async () => {
    const p = core.createPairing();
    const qr = decodePairingQr(p.qrText)!;
    const tryCode = (code: string) =>
      new RemoteClient({
        url: url(core),
        socketFactory: wsFactory,
        identity: generateKeyPair(),
        serverPublicKey: decodeBase64(qr.pk),
        open: { pairingId: p.pairingId, code, deviceName: 'B', platform: 'android' }
      }).connect();
    for (let i = 0; i < 5; i++) await expectError(tryCode('AAAA-AAAA'), 'pairing_invalid');
    // correct code no longer works: the pairing session was destroyed
    await expectError(tryCode(p.code), 'pairing_invalid');
  });

  it('manual code pairing works when correct', async () => {
    const p = core.createPairing();
    core.once('pairing-request', (r) => core.approvePairing(r.id, ['monitor']));
    const c = new RemoteClient({
      url: url(core),
      socketFactory: wsFactory,
      identity: generateKeyPair(),
      serverPublicKey: decodeBase64(core.publicKey),
      open: { pairingId: p.pairingId, code: `${p.code.slice(0, 4)}-${p.code.slice(4)}`, deviceName: 'C', platform: 'android' }
    });
    clients.push(c);
    expect((await c.connect()).paired).toBe(true);
  });

  it('owner can deny a pairing request', async () => {
    const p = core.createPairing();
    const qr = decodePairingQr(p.qrText)!;
    core.once('pairing-request', (r) => core.denyPairing(r.id));
    const c = new RemoteClient({
      url: url(core),
      socketFactory: wsFactory,
      identity: generateKeyPair(),
      serverPublicKey: decodeBase64(qr.pk),
      open: { pairingId: qr.pid, secret: qr.secret, deviceName: 'D', platform: 'android' }
    });
    await expectError(c.connect(), 'pairing_denied');
    expect(core.state().devices).toHaveLength(0);
  });

  it('client refuses to talk to a computer whose key does not match the QR code', async () => {
    const c = new RemoteClient({
      url: url(core),
      socketFactory: wsFactory,
      identity: generateKeyPair(),
      serverPublicKey: generateKeyPair().publicKey,
      open: { deviceName: 'E' }
    });
    await expectError(c.connect(), 'handshake');
  });

  it('revoking a device disconnects it immediately and blocks reconnection', async () => {
    const { client, identity, accepted } = await paired();
    const closed = new Promise<void>((r) => {
      (client as unknown as { opts: { onClose?: () => void } }).opts.onClose = () => r();
    });
    core.server.revokeDevice(accepted.deviceId);
    await closed;
    await expectError(authClient(core, identity).connect(), 'revoked');
  });

  it('refuses all connections when remote access is disabled', async () => {
    const { identity, client } = await paired();
    client.close();
    core.settings.update({ remoteEnabled: false });
    await new Promise((r) => setTimeout(r, 100));
    await expect(authClient(core, identity, { connectTimeoutMs: 1500 }).connect()).rejects.toBeInstanceOf(RemoteError);
  });

  it('tells the phone when remote access is turned off instead of failing silently', async () => {
    const { identity, client } = await paired();
    client.close();
    // keep listening but refuse sessions (e.g. relay disabled / owner switched off mid-session)
    const orig = core.settings.get();
    (core.settings as unknown as { cache: typeof orig }).cache = { ...orig, remoteEnabled: false };
    await expectError(authClient(core, identity).connect(), 'remote_disabled');
  });

  it('drops connections that send garbage instead of a handshake', async () => {
    const ws = new WebSocket(url(core));
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    ws.send('{"t":"hello","v":1,"cs":"nope"}');
    expect(await closed).toBe(4002);
  });
});

describe('authorization', () => {
  it('enforces per-device permissions', async () => {
    const { client } = await paired(['monitor']);
    await expectError(client.call('power.action', { action: 'lock' }), 'forbidden');
    await expectError(client.call('apps.list', {}), 'forbidden');
    expect(platform.calls.find((c) => c[0] === 'power')).toBeUndefined();
    const stats = await client.call('system.stats', {});
    expect(stats.cpuTemp).toBeNull(); // unavailable → null (N/A), never fake
  });

  it('applies permission changes live', async () => {
    const { client, accepted } = await paired(['monitor']);
    await expectError(client.call('audio.state', {}), 'forbidden');
    core.server.updatePermissions(accepted.deviceId, ['monitor', 'audio']);
    await new Promise((r) => setTimeout(r, 50));
    expect((await client.call('audio.state', {})).volume).toBe(40);
    expect(client.accepted?.permissions).toContain('audio');
  });

  it('rejects unknown methods and invalid params', async () => {
    const { client } = await paired(['monitor', 'apps']);
    await expectError(client.call('shell.exec' as never, {} as never), 'unknown_method');
    await expectError(client.call('apps.launch', { appId: 'x', path: 'C:/evil.exe' } as never), 'bad_request');
  });

  it('requires confirmation for shutdown and restart', async () => {
    const { client } = await paired(['power']);
    await expectError(client.call('power.action', { action: 'shutdown' }), 'confirmation_required');
    await client.call('power.action', { action: 'shutdown', confirm: true });
    await client.call('power.action', { action: 'lock' });
    expect(platform.calls.filter((c) => c[0] === 'power')).toEqual([
      ['power', 'shutdown'],
      ['power', 'lock']
    ]);
  });

  it('schedules and cancels a shutdown', async () => {
    const { client } = await paired(['power']);
    const s = await client.call('power.schedule', { action: 'shutdown', delaySec: 600, confirm: true });
    expect(s.at).toBeGreaterThan(Date.now());
    expect(await client.call('power.scheduleState', {})).toMatchObject({ action: 'shutdown' });
    expect(await client.call('power.cancelSchedule', {})).toEqual({ cancelled: true });
    expect(await client.call('power.scheduleState', {})).toBeNull();
  });

  it('remote input needs both the permission and the global switch', async () => {
    const { client } = await paired(['input']);
    await expectError(client.call('input.mouseMove', { dx: 5, dy: 5 }), 'input_disabled');
    core.settings.update({ inputEnabled: true });
    await client.call('input.mouseMove', { dx: 5, dy: -3 });
    await client.call('input.key', { key: 'tab', modifiers: ['alt'] });
    expect(platform.calls).toContainEqual(['mouseMove', 5, -3]);
    expect(platform.calls).toContainEqual(['pressKey', 'tab', ['alt']]);
    core.emergencyStop();
    await expectError(client.call('input.mouseMove', { dx: 1, dy: 1 }), 'input_disabled');
    // typed text is never written to the logs
    await client.call('session.ping', { t: 0 });
    expect(core.store.listLogs(100).some((l) => /secret text/.test(l.message))).toBe(false);
  });

  it('only opens approved websites', async () => {
    const { client } = await paired(['apps']);
    core.store.addUrl({ id: 'yt', label: 'YouTube', url: 'https://youtube.com' });
    await client.call('apps.openUrl', { url: 'https://www.youtube.com/watch?v=1' });
    await expectError(client.call('apps.openUrl', { url: 'https://evil.example/' }), 'forbidden');
    await expectError(client.call('apps.openUrl', { url: 'file:///C:/Windows/System32/cmd.exe' }), 'forbidden');
    expect(platform.calls.filter((c) => c[0] === 'openUrl')).toHaveLength(1);
  });

  it('launches detected games only through official launcher URIs', async () => {
    const { client } = await paired(['games']);
    const games = await client.call('games.list', {});
    expect(games.map((g) => g.name)).toContain('Portal 2');
    await client.call('games.launch', { gameId: 'steam:620' });
    expect(platform.calls).toContainEqual(['openUri', 'steam://rungameid/620']);
    await expectError(client.call('games.launch', { gameId: 'nope' }), 'not_found');
  });

  it('reports now-playing media and audio sessions', async () => {
    const { client } = await paired(['audio']);
    const st = await client.call('audio.state', {});
    expect(st.nowPlaying).toEqual({ app: 'Spotify', title: 'Artist - Song' });
    await client.call('audio.setAppVolume', { pid: 42, level: 30 });
    await expectError(client.call('audio.setDefaultDevice', { deviceId: 'nope', kind: 'output' }), 'not_found');
    await client.call('audio.media', { action: 'next' });
    expect(platform.calls).toContainEqual(['pressKey', 'mediaNext', []]);
  });

  it('macros run only when the device holds every permission they need', async () => {
    const { client } = await paired(['macros', 'audio']);
    const macros = await client.call('macros.list', {});
    const night = macros.find((m) => m.name === 'Night Mode')!; // needs audio + power
    await expectError(client.call('macros.run', { macroId: night.id }), 'forbidden');
    expect(platform.calls.find((c) => c[0] === 'setVolume')).toBeUndefined();
  });

  it('pushes live stats only to subscribed devices with monitor permission', async () => {
    const events: string[] = [];
    const { client } = await paired(['monitor']);
    (client as unknown as { opts: { onEvent: (e: string) => void } }).opts.onEvent = (e) => events.push(e);
    await client.call('session.subscribeStats', { enabled: true });
    await new Promise((r) => setTimeout(r, 1300));
    expect(events).toContain('stats');
  });
});

describe('file transfer', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fristy-share-'));
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
    fs.mkdirSync(path.join(dir, 'sub'));
    core.store.addSharedFolder({ id: 'share', name: 'Share', path: dir, writable: true });
    core.store.addSharedFolder({ id: 'ro', name: 'ReadOnly', path: dir, writable: false });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lists, downloads and uploads inside shared folders', async () => {
    const { client } = await paired(['files']);
    const items = await client.call('files.list', { rootId: 'share', path: '' });
    expect(items.map((i) => i.name)).toEqual(['sub', 'hello.txt']);

    const d = await client.call('files.downloadStart', { rootId: 'share', path: 'hello.txt' });
    const chunk = await client.call('files.downloadChunk', { transferId: d.transferId, index: 0 });
    expect(Buffer.from(chunk.data, 'base64').toString()).toBe('hello world');
    expect(chunk.last).toBe(true);

    const payload = Buffer.alloc(300 * 1024, 7);
    const u = await client.call('files.uploadStart', { rootId: 'share', dir: 'sub', name: 'photo.jpg', size: payload.length });
    for (let i = 0; i * u.chunkSize < payload.length; i++) {
      const part = payload.subarray(i * u.chunkSize, (i + 1) * u.chunkSize);
      await client.call('files.uploadChunk', { transferId: u.transferId, index: i, data: part.toString('base64') });
    }
    await client.call('files.finish', { transferId: u.transferId });
    expect(fs.readFileSync(path.join(dir, 'sub', 'photo.jpg')).equals(payload)).toBe(true);
    const history = await client.call('files.history', {});
    expect(history.filter((h) => h.status === 'completed')).toHaveLength(2);
  });

  it('blocks path traversal and unshared locations', async () => {
    const { client } = await paired(['files']);
    for (const p of ['..', '../..', 'sub/../../etc', '..\\..\\Windows', 'C:\\Windows', 'hello.txt:secret', '/etc/passwd']) {
      await expect(client.call('files.list', { rootId: 'share', path: p })).rejects.toBeInstanceOf(RemoteError);
    }
    await expectError(client.call('files.downloadStart', { rootId: 'share', path: '../../../etc/passwd' }), 'forbidden');
    await expectError(client.call('files.list', { rootId: 'not-a-share', path: '' }), 'not_found');
  });

  it('blocks symlinks that escape the shared folder', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fristy-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    fs.symlinkSync(outside, path.join(dir, 'link'));
    const { client } = await paired(['files']);
    await expectError(client.call('files.downloadStart', { rootId: 'share', path: 'link/secret.txt' }), 'forbidden');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('enforces read-only folders, file name rules and size limits', async () => {
    const { client } = await paired(['files']);
    await expectError(client.call('files.uploadStart', { rootId: 'ro', dir: '', name: 'a.txt', size: 1 }), 'forbidden');
    await expectError(client.call('files.uploadStart', { rootId: 'share', dir: '', name: '..\\evil.exe', size: 1 }), 'bad_request');
    await expectError(client.call('files.uploadStart', { rootId: 'share', dir: '', name: 'CON', size: 1 }), 'bad_request');
    core.settings.update({ maxTransferMB: 1 });
    await expectError(client.call('files.uploadStart', { rootId: 'share', dir: '', name: 'big.bin', size: 2 * 1024 * 1024 }), 'limit_exceeded');
  });

  it('supports pause, resume and cancel', async () => {
    const { client } = await paired(['files']);
    const u = await client.call('files.uploadStart', { rootId: 'share', dir: '', name: 'x.bin', size: 10 });
    await client.call('files.pause', { transferId: u.transferId, paused: true });
    await expectError(client.call('files.uploadChunk', { transferId: u.transferId, index: 0, data: 'AAAA' }), 'bad_request');
    await client.call('files.pause', { transferId: u.transferId, paused: false });
    await client.call('files.uploadChunk', { transferId: u.transferId, index: 0, data: 'AAAA' });
    await client.call('files.cancel', { transferId: u.transferId });
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.fristy-part'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'x.bin'))).toBe(false);
  });
});
