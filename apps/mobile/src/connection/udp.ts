import { Platform } from 'react-native';
import { DISCOVERY_PORT, DISCOVERY_REQUEST, DiscoveryBeaconSchema, type DiscoveryBeacon } from '@fristy/protocol';
import { buildMagicPacket } from '@fristy/shared';

/*
 * UDP features (LAN discovery, Wake-on-LAN) use react-native-udp, a native
 * module: they work in a development/production build, not in Expo Go.
 * iOS note: sending broadcast packets requires Apple's multicast networking
 * entitlement (com.apple.developer.networking.multicast). Without it,
 * discovery/WoL fail on iOS – QR pairing and manual IP entry still work.
 */

type UdpSocket = {
  bind(port?: number, cb?: () => void): void;
  setBroadcast(flag: boolean): void;
  send(msg: Uint8Array | string, offset: number | undefined, length: number | undefined, port: number, host: string, cb?: (err?: Error) => void): void;
  on(ev: 'message', cb: (msg: Uint8Array, rinfo: { address: string; port: number }) => void): void;
  on(ev: 'error', cb: (err: Error) => void): void;
  close(): void;
};

function udp(): { createSocket(opts: { type: 'udp4'; reusePort?: boolean }): UdpSocket } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-udp');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export const udpAvailable = () => udp() !== null;

export interface DiscoveredHost extends DiscoveryBeacon {
  address: string;
}

/** Broadcasts (or unicasts to `target`) a discovery request and collects beacons for `timeoutMs`. */
export function discoverHosts(timeoutMs = 2500, target = '255.255.255.255'): Promise<DiscoveredHost[]> {
  const dgram = udp();
  if (!dgram) return Promise.reject(new Error('LAN discovery needs the FRISTY development or release build (not Expo Go).'));
  return new Promise((resolve, reject) => {
    const found = new Map<string, DiscoveredHost>();
    const sock = dgram.createSocket({ type: 'udp4', reusePort: true });
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      if (err && found.size === 0) reject(err);
      else resolve([...found.values()]);
    };
    sock.on('error', (e) => finish(e));
    sock.on('message', (msg, rinfo) => {
      try {
        const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg);
        const b = DiscoveryBeaconSchema.safeParse(JSON.parse(text));
        if (b.success) found.set(b.data.pk, { ...b.data, address: rinfo.address });
      } catch {
        /* ignore foreign packets */
      }
    });
    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* ignore */
      }
      const send = () => sock.send(DISCOVERY_REQUEST, undefined, undefined, DISCOVERY_PORT, target, (e) => e && finish(e));
      send();
      setTimeout(send, 600);
    });
    setTimeout(() => finish(), timeoutMs);
  });
}

/** Sends a Wake-on-LAN magic packet to the broadcast address(es). */
export function sendWakeOnLan(mac: string, broadcast: string | null): Promise<void> {
  const dgram = udp();
  if (!dgram) return Promise.reject(new Error('Wake-on-LAN needs the FRISTY development or release build (not Expo Go).'));
  const packet = buildMagicPacket(mac);
  const targets = [...new Set([broadcast, '255.255.255.255'].filter(Boolean) as string[])];
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: 'udp4' });
    sock.on('error', (e) => {
      sock.close();
      reject(Platform.OS === 'ios' ? new Error(`${e.message}. iOS requires the multicast networking entitlement for Wake-on-LAN.`) : e);
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      let pending = targets.length * 2;
      const sent = (err?: Error) => {
        if (err) return reject(err);
        if (--pending === 0) {
          sock.close();
          resolve();
        }
      };
      for (const t of targets) for (const port of [9, 7]) sock.send(packet, 0, packet.length, port, t, sent);
    });
  });
}
