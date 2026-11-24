import dgram from 'node:dgram';
import os from 'node:os';
import { DISCOVERY_PORT, DISCOVERY_REQUEST, PROTOCOL_VERSION, type DiscoveryBeacon } from '@fristy/protocol';
import { RateLimiter } from '@fristy/shared';

/**
 * LAN discovery responder. Phones broadcast DISCOVERY_REQUEST on UDP 47801 and
 * the PC answers (unicast) with a beacon containing its name, port and public
 * key. The beacon carries no secrets; the key is verified during pairing via
 * the QR code or the 6-digit verification code shown on both screens.
 */
export class DiscoveryResponder {
  private socket: dgram.Socket | null = null;
  private limiter = new RateLimiter(10, 2);

  constructor(private readonly beacon: () => DiscoveryBeacon) {}

  start(port = DISCOVERY_PORT): Promise<void> {
    if (this.socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg, rinfo) => {
        if (msg.length > 64 || msg.toString('utf8').trim() !== DISCOVERY_REQUEST) return;
        if (!this.limiter.take(rinfo.address)) return;
        const reply = Buffer.from(JSON.stringify(this.beacon()));
        sock.send(reply, rinfo.port, rinfo.address);
      });
      sock.once('error', (e) => {
        this.socket = null;
        reject(e);
      });
      sock.bind(port, () => {
        this.socket = sock;
        resolve();
      });
    });
  }

  stop() {
    this.socket?.close();
    this.socket = null;
  }
}

export function makeBeacon(name: string, publicKey: string, port: number, pairingId: string | null): DiscoveryBeacon {
  return {
    type: 'fristy.beacon',
    v: PROTOCOL_VERSION,
    name,
    pk: publicKey,
    port,
    pairing: pairingId !== null,
    ...(pairingId ? { pid: pairingId } : {})
  };
}

function isPrivateIPv4(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^169\.254\./.test(ip);
}

/** IPv4 LAN addresses, private ranges first (virtual adapters such as vEthernet last). */
export function lanAddresses(): string[] {
  const out: { ip: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let score = isPrivateIPv4(a.address) ? 10 : 0;
      if (/vethernet|virtual|vmware|vbox|hyper-v|docker|wsl|tailscale|zerotier/i.test(name)) score -= 5;
      if (/^169\.254\./.test(a.address)) score -= 8;
      out.push({ ip: a.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.ip);
}
