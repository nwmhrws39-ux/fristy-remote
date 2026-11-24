import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RemoteClient, RemoteError, decodeBase64, generateKeyPair, encodeBase64 } from '@fristy/shared';
import { RelayServer } from '../../apps/relay-server/src/relay';
import { freePort, pairDevice, startCore, wsFactory } from '../../apps/desktop/test/helpers';
import type { FristyCore } from '../../apps/desktop/src/core';

/**
 * End-to-end: phone → relay → PC, with the PC enforcing the exact same
 * authentication and permissions as on the LAN.
 */
let relay: RelayServer;
let relayUrl: string;
let core: FristyCore;

async function waitFor(cond: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(async () => {
  const port = await freePort();
  relay = new RelayServer({ port, host: '127.0.0.1' });
  await relay.listen();
  relayUrl = `ws://127.0.0.1:${port}/relay`;
  ({ core } = await startCore());
});

afterEach(async () => {
  await core.stop();
  await relay.close();
});

describe('internet relay', () => {
  it('routes an authorized device to its PC and enforces permissions end-to-end', async () => {
    const { identity, client: lan } = await pairDevice(core, ['monitor']);
    lan.close();
    core.settings.update({ relayEnabled: true, relayUrl });
    await waitFor(() => core.state().relay.status === 'connected');

    const remote = new RemoteClient({
      url: relayUrl,
      viaRelay: true,
      socketFactory: wsFactory,
      identity,
      serverPublicKey: decodeBase64(core.publicKey),
      open: { deviceName: 'Phone' }
    });
    const acc = await remote.connect();
    expect(acc.permissions).toEqual(['monitor']);
    expect((await remote.call('system.stats', {})).uptime).toBe(100);
    await expect(remote.call('power.action', { action: 'lock' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(core.state().sessions.some((s) => s.kind === 'relay')).toBe(true);
    remote.close();
  });

  it('rejects unknown devices through the relay too', async () => {
    core.settings.update({ relayEnabled: true, relayUrl });
    await waitFor(() => core.state().relay.status === 'connected');
    const c = new RemoteClient({
      url: relayUrl,
      viaRelay: true,
      socketFactory: wsFactory,
      identity: generateKeyPair(),
      serverPublicKey: decodeBase64(core.publicKey),
      open: { deviceName: 'Stranger' }
    });
    await expect(c.connect()).rejects.toMatchObject({ code: 'unknown_device' });
  });

  it('reports offline when the PC is not connected', async () => {
    const c = new RemoteClient({
      url: relayUrl,
      viaRelay: true,
      socketFactory: wsFactory,
      identity: generateKeyPair(),
      serverPublicKey: generateKeyPair().publicKey,
      open: { deviceName: 'X' }
    });
    await expect(c.connect()).rejects.toBeInstanceOf(RemoteError);
  });

  it('a host cannot register a public key it does not own', async () => {
    const victim = generateKeyPair();
    const ws = new WebSocket(relayUrl);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'host', pk: encodeBase64(victim.publicKey) }));
    await new Promise((r) => ws.once('message', r)); // challenge (cannot be answered without the secret key)
    ws.send(JSON.stringify({ t: 'prove', r: encodeBase64(new Uint8Array(32)) }));
    const code = await new Promise<number>((r) => ws.once('close', (c) => r(c)));
    expect(code).toBe(4003);
    expect(relay.hostCount).toBe(0);
  });
});
