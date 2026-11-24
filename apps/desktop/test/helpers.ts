import net from 'node:net';
import WebSocket from 'ws';
import { DEFAULT_GRANTS, decodePairingQr, type Permission } from '@fristy/protocol';
import { RemoteClient, decodeBase64, generateKeyPair, type KeyPair, type SocketLike } from '@fristy/shared';
import { FristyCore } from '../src/core';
import type { Platform } from '../src/core/platform/types';

export type Call = [string, ...unknown[]];

/** A platform that records calls instead of touching the OS. */
export function fakePlatform(): Platform & { calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    name: 'fake',
    supported: true,
    power: rec('power'),
    scheduleShutdown: rec('scheduleShutdown'),
    cancelShutdown: rec('cancelShutdown'),
    mouseMove: rec('mouseMove'),
    mouseButton: rec('mouseButton'),
    scroll: rec('scroll'),
    typeText: rec('typeText'),
    pressKey: rec('pressKey'),
    audioState: async () => ({
      volume: 40,
      muted: false,
      micMuted: false,
      sessions: [{ pid: 42, name: 'Spotify', volume: 80, muted: false }],
      outputs: [{ id: 'out-1', name: 'Speakers', isDefault: true }],
      inputs: [{ id: 'in-1', name: 'Mic', isDefault: true }]
    }),
    setVolume: rec('setVolume'),
    setMute: rec('setMute'),
    setMicMute: rec('setMicMute'),
    setAppVolume: rec('setAppVolume'),
    setDefaultDevice: rec('setDefaultDevice'),
    listProcesses: async () => [{ pid: 42, name: 'Spotify', path: 'C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe', title: 'Artist - Song' }],
    closeProcesses: async (pids: number[]) => {
      calls.push(['closeProcesses', pids]);
      return pids.length;
    },
    launchExecutable: rec('launchExecutable'),
    openUri: rec('openUri'),
    openUrl: rec('openUrl'),
    launchAumid: rec('launchAumid'),
    scanGames: async () => [
      {
        id: 'steam:620',
        name: 'Portal 2',
        source: 'steam',
        launchKind: 'uri',
        launchTarget: 'steam://rungameid/620',
        installDir: 'C:\\Steam\\steamapps\\common\\Portal 2',
        artworkUrl: null
      }
    ],
    stats: async () => ({
      cpuLoad: 12,
      cpuTemp: null,
      gpuLoad: null,
      gpuTemp: null,
      gpuName: null,
      memUsed: 1,
      memTotal: 2,
      diskFree: 10,
      diskTotal: 100,
      netRx: 0,
      netTx: 0,
      uptime: 100
    }),
    info: async () => ({
      computerName: 'TEST-PC',
      os: 'Test',
      cpuModel: null,
      gpuModels: [],
      memTotal: 2,
      wol: { supported: false, mac: null, broadcast: null, note: '' }
    })
  };
}

export async function startCore(platform = fakePlatform()) {
  const identity = generateKeyPair();
  const core = await FristyCore.create({
    dataDir: null,
    platform,
    identity,
    identityPersisted: true,
    appVersion: 'test',
    computerName: 'TEST-PC',
    discovery: false
  });
  core.settings.update({ port: await freePort() });
  await core.start();
  return { core, platform, identity };
}

export const wsFactory = (url: string) => new WebSocket(url) as unknown as SocketLike;

export function url(core: FristyCore) {
  return `ws://127.0.0.1:${core.state().port}/fristy`;
}

export function authClient(core: FristyCore, identity: KeyPair, extra: Partial<ConstructorParameters<typeof RemoteClient>[0]> = {}) {
  return new RemoteClient({
    url: url(core),
    socketFactory: wsFactory,
    identity,
    serverPublicKey: decodeBase64(core.publicKey),
    open: { deviceName: 'Phone' },
    ...extra
  });
}

/** Full QR pairing flow with owner approval. Returns a connected client + its identity. */
export async function pairDevice(core: FristyCore, grants: Permission[] = DEFAULT_GRANTS) {
  const identity = generateKeyPair();
  const p = core.createPairing();
  const qr = decodePairingQr(p.qrText)!;
  const approve = new Promise<void>((resolve) => {
    core.once('pairing-request', (req) => {
      core.approvePairing(req.id, grants);
      resolve();
    });
  });
  let sas = '';
  const client = new RemoteClient({
    url: url(core),
    socketFactory: wsFactory,
    identity,
    serverPublicKey: decodeBase64(qr.pk),
    open: { pairingId: qr.pid, secret: qr.secret, deviceName: 'Test Phone', platform: 'android' },
    onPairPending: (s) => {
      sas = s;
    }
  });
  const accepted = await client.connect();
  await approve;
  return { client, identity, accepted, sas };
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
