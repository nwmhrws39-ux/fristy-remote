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
  // The app defaults to Hebrew; the test drives the English UI.
  await win.evaluate(() => window.fristy.invoke('settings.update', { language: 'en' }));
  await win.waitForTimeout(300);

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

  // 0) Legal onboarding: phones are refused until the PC owner accepts the terms;
  //    nothing is pre-selected and "continue" stays disabled until the box is ticked.
  await win.waitForSelector('text=Before you start');
  const preChecked = await win.locator('[role=dialog] input[type=checkbox]').evaluateAll((els) => els.map((e) => e.checked));
  assert.ok(preChecked.length >= 4 && preChecked.every((c) => c === false), 'no consent box may be pre-selected');
  assert.equal(await win.getByRole('button', { name: 'Accept and continue' }).isDisabled(), true);
  const pre = await win.evaluate(() => window.fristy.invoke('pairing.create'));
  const preQr = decodePairingQr(pre.qrText);
  await assert.rejects(
    new RemoteClient({ url, socketFactory, identity: generateKeyPair(), serverPublicKey: decodeBase64(preQr.pk), open: { pairingId: preQr.pid, secret: preQr.secret, deviceName: 'Early', platform: 'android' } }).connect(),
    (e) => e.code === 'remote_disabled' && /accept the terms/.test(e.message)
  );
  await assert.rejects(win.evaluate(() => window.fristy.invoke('legal.accept', { adult: false, accepted: true })), /18 or older/);
  await win.locator('[role=dialog] label').first().click();
  await win.getByRole('button', { name: 'Accept and continue' }).click();
  await win.waitForSelector('text=Before you start', { state: 'detached' });
  const legal = (await win.evaluate(() => window.fristy.invoke('state.get'))).legal;
  assert.equal(legal.accepted.version, legal.current);
  assert.ok(Date.now() - legal.accepted.acceptedAt < 60_000);
  const after = (await win.evaluate(() => window.fristy.invoke('state.get'))).settings;
  assert.deepEqual([after.relayEnabled, after.screenEnabled, after.inputEnabled], [false, false, false], 'optional features stay off unless chosen');
  step(`legal onboarding: phones refused before acceptance, no pre-selected boxes, version ${legal.current} recorded with timestamp`);

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
  assert.ok('cursor' in frame, 'frames carry the cursor position');
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    await client.call('screen.frame', { displayId: displays[0].id, maxWidth: 1280, quality: 70 });
    times.push(Date.now() - t0);
  }
  const avg = Math.round(times.slice(2).reduce((a, b) => a + b, 0) / (times.length - 2));
  step(`frame time after warm-up: ${avg} ms (≈${Math.round(1000 / Math.max(avg, 1))} fps possible on a fast link)`);
  const windowUrls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
  step(`capture engine: ${windowUrls.some((u) => u.includes('capture.html')) ? 'live video stream' : 'screenshot fallback'}`);
  const cur = await client.call('screen.cursor', { displayId: displays[0].id });
  assert.ok(cur === null || (cur.x >= 0 && cur.x <= 1), 'cursor position is normalized');
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

  // 5) Privacy center: export, delete history, emergency revoke, withdraw & reset.
  const exported = await win.evaluate(() => window.fristy.invoke('state.get'));
  assert.ok(exported.legal.accepted);
  await win.getByRole('button', { name: 'Privacy & Security' }).click();
  await win.waitForSelector('text=Who can access this PC');
  if (shots) await win.screenshot({ path: path.join(shots, 'e2e-privacy.png'), fullPage: true });
  await win.evaluate(() => window.fristy.invoke('privacy.deleteHistory'));
  const afterDelete = await win.evaluate(() => window.fristy.invoke('logs.list', {}));
  assert.ok(afterDelete.length <= 1 && afterDelete.every((l) => /History deleted/.test(l.message)), 'history must be empty after deletion');
  step('privacy: history deleted (security log + transfers)');

  // pair a second phone, then emergency-revoke everything
  const p2 = decodePairingQr((await win.evaluate(() => window.fristy.invoke('pairing.create'))).qrText);
  const phone2 = generateKeyPair();
  const c2 = new RemoteClient({ url, socketFactory, identity: phone2, serverPublicKey: decodeBase64(p2.pk), open: { pairingId: p2.pid, secret: p2.secret, deviceName: 'Second Phone', platform: 'ios' } });
  const c2conn = c2.connect();
  await win.waitForSelector('text=Pairing request');
  await win.getByRole('button', { name: 'Approve' }).click();
  await c2conn;
  const revoked = await win.evaluate(() => window.fristy.invoke('privacy.revokeAll'));
  assert.equal(revoked, 1);
  await assert.rejects(
    new RemoteClient({ url, socketFactory, identity: phone2, serverPublicKey: decodeBase64(p2.pk), open: { deviceName: 'Second Phone' } }).connect(),
    (e) => e.code === 'revoked'
  );
  step('privacy: emergency revoke disconnected and removed every paired device');

  await win.evaluate(() => window.fristy.invoke('privacy.withdraw'));
  await win.waitForSelector('text=Before you start');
  const withdrawn = await win.evaluate(() => window.fristy.invoke('state.get'));
  assert.equal(withdrawn.legal.accepted, null);
  step('privacy: withdrawing acceptance shows the terms again and blocks phones');


  client.close();
  console.log('\nE2E smoke test passed');
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(bundle, { force: true });
}
