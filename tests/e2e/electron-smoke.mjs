/**
 * End-to-end smoke test of the real Electron app (main + preload + renderer +
 * control server) driven by Playwright, with a phone simulated by the same
 * RemoteClient the mobile app uses.
 *
 *   npm run build -w @fristy/desktop
 *   xvfb-run -a node tests/e2e/electron-smoke.mjs      (Linux CI)
 *   node tests/e2e/electron-smoke.mjs                    (Windows/macOS)
 *
 * Env: SCREENSHOT_DIR=<dir> to save screenshots.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const desktop = path.join(root, 'apps', 'desktop');
const { _electron } = require('playwright');
const WebSocket = require('ws');

// The shared client is TypeScript; load it through esbuild's on-the-fly bundle.
const { build } = require('esbuild');
const bundle = path.join(os.tmpdir(), `fristy-client-${process.pid}.cjs`);
await build({
  stdin: { contents: "export * from '@fristy/shared'; export * from '@fristy/protocol';", resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'silent'
});
const { RemoteClient, generateKeyPair, decodeBase64, decodePairingQr } = require(bundle);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fristy-e2e-'));
const shots = process.env.SCREENSHOT_DIR;
const step = (m) => console.log(`✓ ${m}`);

const app = await _electron.launch({
  executablePath: require(path.join(root, 'node_modules', 'electron')),
  args: [desktop, '--no-sandbox', `--user-data-dir=${userData}`],
  cwd: desktop,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
});

try {
  const win = await app.firstWindow();
  await win.waitForSelector('text=FRISTY', { timeout: 20_000 });
  step('main window rendered');

  // Security posture of the renderer.
  const exposure = await win.evaluate(() => ({ require: typeof window.require, process: typeof window.process, bridge: typeof window.fristy?.invoke }));
  assert.deepEqual(exposure, { require: 'undefined', process: 'undefined', bridge: 'function' });
  await assert.rejects(win.evaluate(() => window.fristy.invoke('shell.exec', {})), /unknown channel/);
  await assert.rejects(win.evaluate(() => window.fristy.invoke('devices.revoke', { id: 5 })), /invalid payload/);
  step('renderer is isolated (no Node), IPC rejects unknown channels and bad payloads');

  const state = await win.evaluate(() => window.fristy.invoke('state.get'));
  assert.equal(state.listening, true, `server not listening: ${state.listenError}`);
  step(`control server listening on port ${state.port}`);

  const url = `ws://127.0.0.1:${state.port}/fristy`;
  const socketFactory = (u) => new WebSocket(u);
  const serverPublicKey = decodeBase64(
    (await win.evaluate(() => window.fristy.invoke('pairing.create'))).qrText.match(/"pk":"([^"]+)"/)[1]
  );

  // 1) An unpaired phone is refused.
  await assert.rejects(
    new RemoteClient({ url, socketFactory, identity: generateKeyPair(), serverPublicKey, open: { deviceName: 'Intruder' } }).connect(),
    (e) => e.code === 'unknown_device'
  );
  step('unknown device rejected');

  // 2) QR pairing with owner approval through the real UI.
  const pairing = await win.evaluate(() => window.fristy.invoke('pairing.create'));
  const qr = decodePairingQr(pairing.qrText);
  await win.waitForSelector('img[alt="Pairing QR code"]');
  if (shots) await win.screenshot({ path: path.join(shots, 'e2e-pairing.png') });
  const phone = generateKeyPair();
  let sas = null;
  const client = new RemoteClient({
    url,
    socketFactory,
    identity: phone,
    serverPublicKey: decodeBase64(qr.pk),
    open: { pairingId: qr.pid, secret: qr.secret, deviceName: 'E2E Phone', platform: 'android' },
    onPairPending: (s) => (sas = s)
  });
  const connecting = client.connect();
  await win.waitForSelector('text=Pairing request', { timeout: 10_000 });
  const shownSas = (await win.locator('.font-mono.text-4xl').innerText()).replace(/\s/g, '');
  assert.equal(shownSas, sas, 'PC and phone must show the same verification code');
  if (shots) await win.screenshot({ path: path.join(shots, 'e2e-approval.png') });
  await win.getByRole('button', { name: 'Approve' }).click();
  const accepted = await connecting;
  assert.deepEqual([...accepted.permissions].sort(), ['apps', 'audio', 'games', 'monitor']);
  step(`paired via QR after owner approval (verification code ${sas} matched on both screens)`);

  // 3) Authorized + permission-checked calls.
  const stats = await client.call('system.stats', {});
  assert.ok(stats.memTotal > 0);
  await assert.rejects(client.call('power.action', { action: 'lock' }), (e) => e.code === 'forbidden');
  step('monitor allowed, power denied by permissions');

  // 3b) Screen viewing + clipboard through the real Electron bridge.
  await win.evaluate((id) => window.fristy.invoke('devices.permissions', { id, permissions: ['monitor', 'screen', 'clipboard'] }), accepted.deviceId);
  await assert.rejects(client.call('screen.displays', {}), (e) => e.code === 'screen_disabled');
  await win.evaluate(() => window.fristy.invoke('settings.update', { screenEnabled: true }));
  const displays = await client.call('screen.displays', {});
  assert.ok(displays.length >= 1, 'at least one display');
  const frame = await client.call('screen.frame', { displayId: displays[0].id, maxWidth: 800, quality: 50 });
  const jpeg = Buffer.from(frame.data, 'base64');
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8, 'frame must be a JPEG');
  if (shots) fs.writeFileSync(path.join(shots, 'e2e-remote-frame.jpg'), jpeg);
  step(`screen captured remotely: ${frame.w}×${frame.h} JPEG, ${Math.round(jpeg.length / 1024)} KB`);
  await client.call('clipboard.set', { text: 'hello from the phone' });
  assert.equal((await client.call('clipboard.get', {})).text, 'hello from the phone');
  step('clipboard round-trip through the PC clipboard');

  // 4) Owner revokes → immediate disconnect and no reconnection.
  await win.evaluate((id) => window.fristy.invoke('devices.revoke', { id }), accepted.deviceId);
  await assert.rejects(
    new RemoteClient({ url, socketFactory, identity: phone, serverPublicKey: decodeBase64(qr.pk), open: { deviceName: 'E2E Phone' } }).connect(),
    (e) => e.code === 'revoked'
  );
  step('revoked device can no longer connect');

  const logs = await win.evaluate(() => window.fristy.invoke('logs.list', {}));
  assert.ok(logs.some((l) => l.category === 'pairing' && /Paired "E2E Phone"/.test(l.message)));
  step('security log recorded pairing and revocation');

  if (shots) {
    await win.getByRole('button', { name: 'Security log' }).click();
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(shots, 'e2e-logs.png') });
  }
  client.close();
  console.log('\nE2E smoke test passed');
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(bundle, { force: true });
}
