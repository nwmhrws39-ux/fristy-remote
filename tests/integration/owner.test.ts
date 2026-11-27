import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteError } from '@fristy/shared';
import { handle, type Db } from '../../apps/admin-server/src/api';
import { FristyCore } from '../../apps/desktop/src/core';
import { authClient, fakePlatform, freePort, pairDevice } from '../../apps/desktop/test/helpers';
import { generateKeyPair } from '@fristy/shared';

/** Owner service (real request handler + SQLite) wired to a real desktop core via fetch. */
function ownerService(code = 'owner-secret-code') {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(__dirname, '../../apps/admin-server/schema.sql'), 'utf8'));
  const db: Db = {
    first: async (q, ...p) => (sql.prepare(q).get(...p) as never) ?? null,
    all: async (q, ...p) => sql.prepare(q).all(...p) as never[],
    run: async (q, ...p) => {
      sql.prepare(q).run(...p);
    }
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), { db, adminCode: code, now: () => Date.now(), country: 'IL', clientKey: 'test' })) as typeof fetch;
  const api = async (method: string, p: string, body?: unknown, token?: string) => {
    const res = await fetchImpl(`https://owner.test${p}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return (await res.json()) as Record<string, unknown>;
  };
  return { fetchImpl, api, code };
}

const cores: FristyCore[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.stop();
});

async function startOwnedCore(svc: ReturnType<typeof ownerService>) {
  const core = await FristyCore.create({
    dataDir: null,
    platform: fakePlatform(),
    identity: generateKeyPair(),
    identityPersisted: true,
    appVersion: '0.1.0',
    computerName: 'FRIEND-PC',
    discovery: false,
    ownerApiUrl: 'https://owner.test',
    fetchImpl: svc.fetchImpl,
    ownerLive: false
  });
  core.settings.update({ port: await freePort() });
  await core.start();
  cores.push(core);
  return core;
}

describe('owner lock', () => {
  it('locks every other PC: phones are refused until the owner unlocks', async () => {
    const svc = ownerService();
    const friendPc = await startOwnedCore(svc);
    const { identity, client } = await pairDevice(friendPc, ['monitor']);
    client.close();

    // The owner signs in from their own phone install and locks the app.
    await svc.api('POST', '/v1/checkin', { installId: 'owner-phone-000001', name: 'Owner', kind: 'phone', platform: 'ios', appVersion: '0.1.0' });
    const { token } = (await svc.api('POST', '/v1/admin/login', { installId: 'owner-phone-000001', code: svc.code })) as { token: string };
    await svc.api('POST', '/v1/admin/config', { locked: true, lockMessage: 'Paused by the owner' }, token as string);

    await friendPc.owner.checkIn();
    expect(friendPc.state().owner).toMatchObject({ enabled: true, locked: true, message: 'Paused by the owner' });
    const refused = authClient(friendPc, identity).connect();
    await expect(refused).rejects.toSatisfy((e: unknown) => e instanceof RemoteError && e.code === 'remote_disabled' && /Paused by the owner/.test(e.message));

    // The owner sees the friend's PC in the user list – by name, never by IP.
    const overview = await svc.api('GET', '/v1/admin/overview', undefined, token);
    expect((overview.installs as { name: string; kind: string }[]).map((i) => `${i.name}/${i.kind}`)).toContain('FRIEND-PC/pc');
    expect(JSON.stringify(overview)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);

    await svc.api('POST', '/v1/admin/config', { locked: false }, token);
    await friendPc.owner.checkIn();
    const ok = authClient(friendPc, identity);
    await expect(ok.connect()).resolves.toMatchObject({ paired: false });
    ok.close();
  });

  it("the owner's own PC keeps working while the app is locked", async () => {
    const svc = ownerService();
    const ownerPc = await startOwnedCore(svc);
    await ownerPc.owner.login(svc.code);
    const { token } = (await svc.api('POST', '/v1/admin/login', { installId: ownerPc.owner.installId, code: svc.code })) as { token: string };
    await svc.api('POST', '/v1/admin/config', { locked: true }, token);
    await ownerPc.owner.checkIn();
    expect(ownerPc.state().owner).toMatchObject({ locked: false, admin: true });
    const { client } = await pairDevice(ownerPc, ['monitor']);
    expect(client.isOpen).toBe(true);
    client.close();
  });

  it('a wrong code does not grant admin', async () => {
    const svc = ownerService();
    const pc = await startOwnedCore(svc);
    await expect(pc.owner.login('nope')).rejects.toThrow(/wrong code/);
    expect(pc.state().owner.admin).toBe(false);
  });

  it('is fully disabled when no owner service is configured', async () => {
    const core = await FristyCore.create({
      dataDir: null,
      platform: fakePlatform(),
      identity: generateKeyPair(),
      identityPersisted: true,
      appVersion: '0.1.0',
      discovery: false
    });
    cores.push(core);
    expect(core.state().owner.enabled).toBe(false);
  });
});

describe('live owner updates', () => {
  it('a lock and a personal message reach a running PC instantly, without a restart', async () => {
    // Real HTTP + WebSocket owner service on localhost (the hub sends only "refresh").
    const sql = new DatabaseSync(':memory:');
    sql.exec(fs.readFileSync(path.join(__dirname, '../../apps/admin-server/schema.sql'), 'utf8'));
    const db: Db = {
      first: async (q, ...p) => (sql.prepare(q).get(...p) as never) ?? null,
      all: async (q, ...p) => sql.prepare(q).all(...p) as never[],
      run: async (q, ...p) => {
        sql.prepare(q).run(...p);
      }
    };
    const sockets = new Map<WsSocket, string>();
    const changed = (target?: string) => {
      for (const [ws, id] of sockets) if (!target || id === target) ws.send('refresh');
    };
    const deps = { db, adminCode: 'code-123456', now: () => Date.now(), country: 'IL', clientKey: 'k', changed };
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const out = await handle(new Request(`http://x${req.url}`, { method: req.method, headers: req.headers as never, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }), deps);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(await out.text());
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const id = new URL(req.url ?? '', 'http://x').searchParams.get('installId') ?? '';
      wss.handleUpgrade(req, socket, head, (ws) => {
        sockets.set(ws, id);
        ws.on('message', (m) => m.toString() === 'ping' && ws.send('pong'));
        ws.on('close', () => sockets.delete(ws));
      });
    });
    const port = await freePort();
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    const base = `http://127.0.0.1:${port}`;
    const api = async (method: string, p: string, body?: unknown, token?: string) =>
      (await (await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json()) as Record<string, unknown>;

    try {
      const pc = await FristyCore.create({
        dataDir: null,
        platform: fakePlatform(),
        identity: generateKeyPair(),
        identityPersisted: true,
        appVersion: '0.1.0',
        computerName: 'LIVE-PC',
        discovery: false,
        ownerApiUrl: base
      });
      pc.settings.update({ port: await freePort() });
      await pc.start();
      cores.push(pc);
      const until = async (ok: () => boolean, ms = 3000) => {
        const end = Date.now() + ms;
        while (!ok()) {
          if (Date.now() > end) throw new Error('timed out');
          await new Promise((r) => setTimeout(r, 25));
        }
      };
      await until(() => sockets.size === 1 && pc.state().owner.lastCheck !== null);

      await api('POST', '/v1/checkin', { installId: 'owner-phone-000001', name: 'Owner', kind: 'phone', platform: 'ios', appVersion: '0.1.0' });
      const { token } = (await api('POST', '/v1/admin/login', { installId: 'owner-phone-000001', code: 'code-123456' })) as { token: string };

      const t0 = Date.now();
      await api('POST', '/v1/admin/config', { locked: true, lockMessage: 'Paused' }, token);
      await until(() => pc.state().owner.locked);
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(pc.state().owner.message).toBe('Paused');

      await api('POST', '/v1/admin/config', { locked: false }, token);
      await until(() => !pc.state().owner.locked);

      await api('POST', '/v1/admin/install', { installId: pc.owner.installId, message: 'Hi there' }, token);
      await until(() => pc.state().owner.personal?.text === 'Hi there');
    } finally {
      for (const c of cores.splice(0)) await c.stop();
      for (const ws of sockets.keys()) ws.terminate();
      wss.close();
      server.close();
    }
  });
});
