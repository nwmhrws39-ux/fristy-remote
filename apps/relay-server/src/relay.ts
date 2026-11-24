import http from 'node:http';
import https from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_FRAME_BYTES,
  RelayClientHelloSchema,
  RelayHostHelloSchema,
  RelayHostInboundSchema,
  RelayProveSchema
} from '@fristy/protocol';
import { RateLimiter, constantTimeEqualString, decodeBase64, encodeBase64, makeRelayChallenge } from '@fristy/shared';

/*
 * FRISTY relay server
 * -------------------
 * Lets a phone reach its PC across networks without port forwarding.
 * - PCs connect outbound and prove ownership of their public key by answering
 *   an encrypted challenge, so nobody can impersonate a registered PC.
 * - Phones ask for a PC by public key. The relay pipes opaque frames between
 *   them; all FRISTY traffic is end-to-end encrypted and authenticated by the
 *   PC itself, exactly like on the LAN. The relay never holds keys and cannot
 *   read or forge commands.
 * - Per-IP connection rate limits, frame size limits, per-host channel limits
 *   and idle timeouts protect the relay itself.
 */

export interface RelayOptions {
  port: number;
  host?: string;
  tls?: { key: string | Buffer; cert: string | Buffer };
  maxChannelsPerHost?: number;
  log?: (msg: string) => void;
}

interface HostConn {
  ws: WebSocket;
  pk: string;
  channels: Map<number, WebSocket>;
  nextCh: number;
}

export class RelayServer {
  private server: http.Server | https.Server;
  private wss: WebSocketServer;
  private hosts = new Map<string, HostConn>();
  private limiter = new RateLimiter(30, 1);
  private heartbeat: NodeJS.Timeout;
  private log: (msg: string) => void;

  constructor(private readonly opts: RelayOptions) {
    this.log = opts.log ?? (() => undefined);
    const handler: http.RequestListener = (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, hosts: this.hosts.size }));
        return;
      }
      res.writeHead(404);
      res.end();
    };
    this.server = opts.tls ? https.createServer(opts.tls, handler) : http.createServer(handler);
    this.wss = new WebSocketServer({ server: this.server, path: '/relay', maxPayload: MAX_FRAME_BYTES * 2, perMessageDeflate: false });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '?'));
    const alive = new WeakMap<WebSocket, boolean>();
    this.wss.on('connection', (ws) => {
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
    });
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!alive.get(ws)) ws.terminate();
        else {
          alive.set(ws, false);
          ws.ping();
        }
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        const a = this.server.address();
        resolve(typeof a === 'object' && a ? a.port : this.opts.port);
      });
    });
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  get hostCount() {
    return this.hosts.size;
  }

  private onConnection(ws: WebSocket, ip: string) {
    if (!this.limiter.take(ip)) {
      ws.close(4029, 'rate limited');
      return;
    }
    const helloTimer = setTimeout(() => ws.terminate(), 10_000);
    ws.once('message', (raw, isBinary) => {
      clearTimeout(helloTimer);
      if (isBinary) return ws.terminate();
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return ws.terminate();
      }
      const host = RelayHostHelloSchema.safeParse(msg);
      if (host.success) return this.registerHost(ws, host.data.pk);
      const client = RelayClientHelloSchema.safeParse(msg);
      if (client.success) return this.connectClient(ws, client.data.host);
      ws.terminate();
    });
  }

  private registerHost(ws: WebSocket, pk: string) {
    let challenge: ReturnType<typeof makeRelayChallenge>;
    try {
      challenge = makeRelayChallenge(decodeBase64(pk));
    } catch {
      return ws.terminate();
    }
    ws.send(JSON.stringify(challenge.frame));
    const timer = setTimeout(() => ws.terminate(), 10_000);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      let ok = false;
      try {
        const prove = RelayProveSchema.safeParse(JSON.parse(raw.toString()));
        ok = prove.success && constantTimeEqualString(prove.data.r, encodeBase64(challenge.challenge));
      } catch {
        ok = false;
      }
      if (!ok) {
        ws.send(JSON.stringify({ t: 'error', message: 'ownership proof failed' }));
        return ws.close(4003, 'proof failed');
      }
      // A newer authenticated connection for the same key replaces the old one.
      const existing = this.hosts.get(pk);
      if (existing) existing.ws.close(4000, 'replaced');
      const conn: HostConn = { ws, pk, channels: new Map(), nextCh: 1 };
      this.hosts.set(pk, conn);
      ws.send(JSON.stringify({ t: 'registered' }));
      this.log(`host registered (${this.hosts.size} online)`);

      ws.on('message', (data) => {
        let m;
        try {
          m = RelayHostInboundSchema.safeParse(JSON.parse(data.toString()));
        } catch {
          return;
        }
        if (!m.success) return;
        const client = conn.channels.get(m.data.ch);
        if (!client) return;
        if (m.data.t === 'data') client.send(m.data.d);
        else {
          conn.channels.delete(m.data.ch);
          client.close(1000, 'closed by computer');
        }
      });
      ws.on('close', () => {
        if (this.hosts.get(pk) === conn) this.hosts.delete(pk);
        for (const c of conn.channels.values()) c.close(1001, 'computer went offline');
        conn.channels.clear();
      });
    });
  }

  private connectClient(ws: WebSocket, hostPk: string) {
    const host = this.hosts.get(hostPk);
    if (!host) {
      ws.send(JSON.stringify({ t: 'offline' }));
      return ws.close(1000, 'offline');
    }
    if (host.channels.size >= (this.opts.maxChannelsPerHost ?? 8)) {
      ws.send(JSON.stringify({ t: 'error', message: 'too many connections' }));
      return ws.close(4029, 'busy');
    }
    const ch = host.nextCh++;
    host.channels.set(ch, ws);
    host.ws.send(JSON.stringify({ t: 'open', ch }));
    ws.send(JSON.stringify({ t: 'ready' }));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.terminate();
      if (host.ws.readyState === host.ws.OPEN) host.ws.send(JSON.stringify({ t: 'data', ch, d: data.toString() }));
    });
    ws.on('close', () => {
      if (host.channels.delete(ch) && host.ws.readyState === host.ws.OPEN) host.ws.send(JSON.stringify({ t: 'close', ch }));
    });
  }
}
