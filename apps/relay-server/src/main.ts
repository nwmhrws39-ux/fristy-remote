import fs from 'node:fs';
import { RelayServer } from './relay';

/*
 * Environment:
 *   PORT          listen port (default 8443)
 *   HOST          bind address (default 0.0.0.0)
 *   TLS_KEY_FILE  / TLS_CERT_FILE  – serve wss:// directly. Alternatively run
 *                 behind a TLS-terminating reverse proxy (Caddy, nginx, a cloud LB).
 *   MAX_CHANNELS_PER_HOST (default 8)
 */
const port = Number(process.env.PORT ?? 8443);
const keyFile = process.env.TLS_KEY_FILE;
const certFile = process.env.TLS_CERT_FILE;

const relay = new RelayServer({
  port,
  host: process.env.HOST,
  tls: keyFile && certFile ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) } : undefined,
  maxChannelsPerHost: Number(process.env.MAX_CHANNELS_PER_HOST ?? 8),
  log: (m) => console.log(new Date().toISOString(), m)
});

relay.listen().then((p) => {
  console.log(`FRISTY relay listening on ${keyFile ? 'wss' : 'ws'}://0.0.0.0:${p}/relay`);
  if (!keyFile) console.log('No TLS configured: put this behind a TLS proxy before exposing it to the internet.');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void relay.close().then(() => process.exit(0)));
