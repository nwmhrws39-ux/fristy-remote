/** Normalizes "AA-BB-CC-DD-EE-FF" / "aa:bb:..." / "aabbcc..." to "AA:BB:CC:DD:EE:FF". */
export function normalizeMac(mac: string): string | null {
  const hex = mac.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) return null;
  if (/^0{12}$/.test(hex) || /^f{12}$/i.test(hex)) return null;
  return hex.toUpperCase().match(/.{2}/g)!.join(':');
}

/** Builds a Wake-on-LAN magic packet: 6 × 0xFF followed by the MAC repeated 16 times. */
export function buildMagicPacket(mac: string): Uint8Array {
  const norm = normalizeMac(mac);
  if (!norm) throw new Error('invalid MAC address');
  const bytes = norm.split(':').map((h) => parseInt(h, 16));
  const packet = new Uint8Array(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) packet.set(bytes, 6 + i * 6);
  return packet;
}

/** True for the CGNAT range 100.64.0.0/10 used by Tailscale. */
export function isTailscaleIPv4(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/** Computes the IPv4 directed broadcast address for an address/netmask pair. */
export function broadcastAddress(ip: string, netmask: string): string | null {
  const a = ip.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return a.map((o, i) => (o | (~m[i]! & 255)) & 255).join('.');
}
