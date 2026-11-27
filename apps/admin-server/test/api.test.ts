import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { compareVersions, handle, type Db, type Deps } from '../src/api';

function sqliteDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  return {
    first: async (sql, ...p) => (db.prepare(sql).get(...p) as never) ?? null,
    all: async (sql, ...p) => db.prepare(sql).all(...p) as never[],
    run: async (sql, ...p) => {
      db.prepare(sql).run(...p);
    }
  };
}

let deps: Deps;
let now = 1_000_000;
const OWNER = 'owner-install-0001';
const FRIEND = 'friend-install-0002';
const CODE = 'correct horse battery staple';

beforeEach(() => {
  now = 1_000_000;
  deps = { db: sqliteDb(), adminCode: CODE, now: () => now, country: 'IL', clientKey: 'client-a' };
});

async function call(method: string, p: string, body?: unknown, token?: string, d: Partial<Deps> = {}) {
  const res = await handle(
    new Request(`https://x${p}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: body ? JSON.stringify(body) : undefined
    }),
    { ...deps, ...d }
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const checkin = (id: string, name = 'User', version = '0.1.0') =>
  call('POST', '/v1/checkin', { installId: id, name, kind: 'phone', platform: 'ios', appVersion: version });

async function becomeAdmin(id = OWNER) {
  await checkin(id, 'Owner');
  const r = await call('POST', '/v1/admin/login', { installId: id, code: CODE });
  expect(r.status).toBe(200);
  return r.body.token as string;
}

describe('check-in', () => {
  it('registers installs and is unlocked by default', async () => {
    const r = await checkin(FRIEND, 'Dani');
    expect(r.body).toMatchObject({ locked: false, admin: false, announcement: '' });
  });
  it('validates input', async () => {
    expect((await call('POST', '/v1/checkin', { installId: 'x', name: 'a', kind: 'phone', platform: 'ios', appVersion: '1' })).status).toBe(400);
    expect((await call('POST', '/v1/checkin', { installId: FRIEND, name: 'a', kind: 'phone', platform: 'ios', appVersion: '0.1.0', ip: '1.2.3.4' })).status).toBe(400);
  });
});

describe('admin login', () => {
  it('rejects wrong codes and limits attempts', async () => {
    await checkin(FRIEND);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/v1/admin/login', { installId: FRIEND, code: 'guess' + i })).status).toBe(403);
    // even the right code is refused once the limit is reached
    expect((await call('POST', '/v1/admin/login', { installId: FRIEND, code: CODE })).status).toBe(429);
    // and the limit resets after the window
    now += 61 * 60_000;
    expect((await call('POST', '/v1/admin/login', { installId: FRIEND, code: CODE })).status).toBe(200);
  });

  it('admin endpoints need a valid token', async () => {
    expect((await call('GET', '/v1/admin/overview')).status).toBe(401);
    expect((await call('GET', '/v1/admin/overview', undefined, 'a'.repeat(64))).status).toBe(401);
    const token = await becomeAdmin();
    expect((await call('GET', '/v1/admin/overview', undefined, token)).status).toBe(200);
  });

  it('refuses when no admin code is configured', async () => {
    await checkin(OWNER);
    expect((await call('POST', '/v1/admin/login', { installId: OWNER, code: '' }, undefined, { adminCode: '' })).status).toBe(503);
  });
});

describe('owner controls', () => {
  it('locks the app for everyone except admins', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND, 'Dani');
    await call('POST', '/v1/admin/config', { locked: true, lockMessage: 'Closed for maintenance' }, token);
    expect((await checkin(FRIEND, 'Dani')).body).toMatchObject({ locked: true, reason: 'locked', message: 'Closed for maintenance' });
    expect((await checkin(OWNER, 'Owner')).body).toMatchObject({ locked: false, admin: true });
    await call('POST', '/v1/admin/config', { locked: false }, token);
    expect((await checkin(FRIEND, 'Dani')).body.locked).toBe(false);
  });

  it('blocks single installs, but never the admin themself', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND);
    await call('POST', '/v1/admin/install', { installId: FRIEND, blocked: true }, token);
    expect((await checkin(FRIEND)).body).toMatchObject({ locked: true, reason: 'blocked' });
    expect((await call('POST', '/v1/admin/install', { installId: OWNER, blocked: true }, token)).status).toBe(400);
  });

  it('publishes announcements and minimum versions', async () => {
    const token = await becomeAdmin();
    await call('POST', '/v1/admin/config', { announcement: 'New version!', minVersion: '0.2.0' }, token);
    expect((await checkin(FRIEND, 'Dani', '0.1.0')).body).toMatchObject({ announcement: 'New version!', updateAvailable: true });
    expect((await checkin(FRIEND, 'Dani', '0.2.0')).body.updateAvailable).toBe(false);
  });

  it('lists users with online status and country, without IP addresses', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND, 'Dani');
    now += 30 * 60_000;
    await checkin(OWNER, 'Owner');
    const r = await call('GET', '/v1/admin/overview', undefined, token);
    const installs = r.body.installs as Record<string, unknown>[];
    expect(installs.map((i) => [i.name, i.online, i.country])).toEqual([
      ['Owner', true, 'IL'],
      ['Dani', false, 'IL']
    ]);
    expect(JSON.stringify(r.body)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('logout and demotion revoke access', async () => {
    const token = await becomeAdmin();
    await call('POST', '/v1/admin/logout', {}, token);
    expect((await call('GET', '/v1/admin/overview', undefined, token)).status).toBe(401);
  });
});

it('compares versions', () => {
  expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
  expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
});

describe('statistics', () => {
  it('counts daily users, new users and versions without personal data', async () => {
    const token = await becomeAdmin();
    const DAY = 86_400_000;
    now = Date.parse('2026-11-20T10:00:00Z');
    await checkin(FRIEND, 'Dani', '0.2.10');
    await checkin(FRIEND, 'Dani', '0.2.10'); // same day counts once
    now += DAY;
    await checkin(FRIEND, 'Dani', '0.2.11');
    await call('POST', '/v1/checkin', { installId: 'pc-install-00000003', name: 'PC', kind: 'pc', platform: 'win32', appVersion: '0.2.11' });
    const r = await call('GET', '/v1/admin/stats?days=7', undefined, token);
    expect(r.status).toBe(200);
    const s = r.body as unknown as import('../src/api').Stats;
    expect(s.days).toHaveLength(7);
    const last = s.days.at(-1)!;
    expect(last).toMatchObject({ day: '2026-11-21', users: 2, phones: 1, pcs: 1, newUsers: 1 });
    expect(s.days.at(-2)).toMatchObject({ day: '2026-11-20', users: 1, newUsers: 1 });
    expect(s.versions[0]).toMatchObject({ version: '0.2.11' });
    expect(s.totals.users).toBe(3);
    expect(JSON.stringify(s)).not.toMatch(/Dani|install/);
    expect((await call('GET', '/v1/admin/stats', undefined, 'f'.repeat(64))).status).toBe(401);
  });
});

it('admins can remove an install and its history', async () => {
  const token = await becomeAdmin();
  await checkin(FRIEND, 'CI runner');
  expect((await call('POST', '/v1/admin/install', { installId: OWNER, remove: true }, token)).status).toBe(400);
  expect((await call('POST', '/v1/admin/install', { installId: FRIEND, remove: true }, token)).status).toBe(200);
  const o = await call('GET', '/v1/admin/overview', undefined, token);
  expect((o.body.installs as { id: string }[]).map((i) => i.id)).toEqual([OWNER]);
  const st = await call('GET', '/v1/admin/stats', undefined, token);
  expect((st.body as { totals: { users: number } }).totals.users).toBe(1);
});

describe('new owner features', () => {
  const pc = (id: string, version = '0.2.10', extra: Record<string, unknown> = {}) =>
    call('POST', '/v1/checkin', { installId: id, name: 'PC', kind: 'pc', platform: 'win32', appVersion: version, ...extra });

  it('keeps schema.sql and the worker schema identical', async () => {
    const { SCHEMA_SQL } = await import('../src/schema');
    expect(SCHEMA_SQL).toBe(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
    const { schemaStatements } = await import('../src/schema');
    expect(schemaStatements(SCHEMA_SQL).every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });

  it('invite codes: existing users stay, new users need a code or approval', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND, 'Old friend');
    now += 1000;
    await call('POST', '/v1/admin/config', { inviteRequired: true }, token);
    now += 1000;
    expect((await checkin(FRIEND)).body).toMatchObject({ locked: false });
    const NEW = 'new-person-install-03';
    expect((await checkin(NEW, 'New')).body).toMatchObject({ locked: true, reason: 'invite', announcement: '' });
    expect((await call('POST', '/v1/checkin', { installId: NEW, name: 'New', kind: 'phone', platform: 'ios', appVersion: '0.1.0', invite: 'WRONG123' })).body).toMatchObject({
      locked: true,
      inviteError: 'wrong invite code'
    });
    const { code } = (await call('POST', '/v1/admin/invite', { maxUses: 1, note: 'for Dani' }, token)).body as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    const ok = await call('POST', '/v1/checkin', { installId: NEW, name: 'New', kind: 'phone', platform: 'ios', appVersion: '0.1.0', invite: code.toLowerCase() });
    expect(ok.body).toMatchObject({ locked: false, reason: null });
    // single-use
    const OTHER = 'other-person-install-4';
    expect((await call('POST', '/v1/checkin', { installId: OTHER, name: 'X', kind: 'phone', platform: 'ios', appVersion: '0.1.0', invite: code })).body).toMatchObject({ reason: 'invite' });
    const o = await call('GET', '/v1/admin/overview', undefined, token);
    const installs = o.body.installs as { id: string; pending: boolean }[];
    expect(installs.find((i) => i.id === OTHER)?.pending).toBe(true);
    expect(installs.find((i) => i.id === NEW)?.pending).toBe(false);
    expect((o.body.invites as { uses: number }[])[0]?.uses).toBe(1);
    // manual approval
    await call('POST', '/v1/admin/install', { installId: OTHER, approve: true }, token);
    expect((await checkin(OTHER)).body).toMatchObject({ locked: false });
  });

  it('scheduled maintenance locks everyone but admins only during the window', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND);
    const start = now + 60 * 60_000;
    await call('POST', '/v1/admin/config', { maintenance: { start, end: start + 60 * 60_000, message: 'Back soon' } }, token);
    const before = await checkin(FRIEND);
    expect(before.body).toMatchObject({ locked: false, maintenance: { start, message: 'Back soon' } });
    now = start + 1000;
    expect((await checkin(FRIEND)).body).toMatchObject({ locked: true, reason: 'maintenance', message: 'Back soon' });
    expect((await checkin(OWNER)).body).toMatchObject({ locked: false });
    now = start + 2 * 60 * 60_000;
    expect((await checkin(FRIEND)).body).toMatchObject({ locked: false, maintenance: null });
    expect((await call('POST', '/v1/admin/config', { maintenance: { start: 10, end: 5, message: '' } }, token)).status).toBe(400);
  });

  it('personal messages reach only that user', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND);
    await checkin('someone-else-install-5');
    await call('POST', '/v1/admin/install', { installId: FRIEND, message: 'Hi Dani!' }, token);
    expect((await checkin(FRIEND)).body.personal).toMatchObject({ text: 'Hi Dani!' });
    expect((await checkin('someone-else-install-5')).body.personal).toBeNull();
    await call('POST', '/v1/admin/install', { installId: FRIEND, message: '' }, token);
    expect((await checkin(FRIEND)).body.personal).toBeNull();
  });

  it('beta channel holds new versions until the owner releases them', async () => {
    const token = await becomeAdmin();
    await pc('pc-friend-000000000001', '0.2.10');
    await pc('pc-owner-0000000000002', '0.2.10');
    await call('POST', '/v1/admin/login', { installId: 'pc-owner-0000000000002', code: CODE });
    await call('POST', '/v1/admin/config', { betaChannel: true }, token);
    expect((await pc('pc-friend-000000000001', '0.2.10')).body).toMatchObject({ beta: false, stableVersion: '0.2.10' });
    expect((await pc('pc-owner-0000000000002', '0.2.12')).body).toMatchObject({ beta: true, stableVersion: '' });
    await call('POST', '/v1/admin/install', { installId: 'pc-friend-000000000001', beta: true }, token);
    expect((await pc('pc-friend-000000000001')).body).toMatchObject({ beta: true, stableVersion: '' });
    await call('POST', '/v1/admin/install', { installId: 'pc-friend-000000000001', beta: false }, token);
    const r = await call('POST', '/v1/admin/release', {}, token);
    expect((r.body.config as { stablePc: string }).stablePc).toBe('0.2.12');
    expect((await pc('pc-friend-000000000001')).body).toMatchObject({ stableVersion: '0.2.12' });
    await call('POST', '/v1/admin/config', { betaChannel: false }, token);
    expect((await pc('pc-friend-000000000001')).body).toMatchObject({ stableVersion: '' });
  });

  it('notifies the owner about new users without names', async () => {
    const sent: string[] = [];
    const notify = (_t: string, _title: string, m: string) => void sent.push(m);
    const token = await becomeAdmin();
    expect((await call('POST', '/v1/admin/notify-test', {}, token, { notify })).status).toBe(400);
    expect((await call('POST', '/v1/admin/config', { notifyTopic: 'short' }, token)).status).toBe(400);
    await call('POST', '/v1/admin/config', { notifyTopic: 'fristy-abcdefghijkl' }, token);
    await call('POST', '/v1/checkin', { installId: FRIEND, name: 'Secret Name', kind: 'phone', platform: 'ios', appVersion: '0.1.0' }, undefined, { notify });
    await call('POST', '/v1/checkin', { installId: FRIEND, name: 'Secret Name', kind: 'phone', platform: 'ios', appVersion: '0.1.0' }, undefined, { notify });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('New user joined');
    expect(sent[0]).not.toContain('Secret');
  });

  it('writes an audit log of admin actions', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND, 'Dani');
    await call('POST', '/v1/admin/config', { locked: true }, token);
    await call('POST', '/v1/admin/install', { installId: FRIEND, blocked: true }, token);
    await call('POST', '/v1/admin/login', { installId: FRIEND, code: 'nope' });
    const log = (await call('GET', '/v1/admin/log', undefined, token)).body.entries as { action: string; actor: string; target: string }[];
    expect(log.map((e) => e.action)).toEqual(['login.failed', 'block', 'lock', 'login']);
    expect(log[1]).toMatchObject({ actor: 'Owner', target: 'Dani' });
    expect((await call('GET', '/v1/admin/log')).status).toBe(401);
  });

  it('reports users by country', async () => {
    const token = await becomeAdmin();
    await checkin(FRIEND);
    await call('POST', '/v1/checkin', { installId: 'us-user-install-0006', name: 'A', kind: 'phone', platform: 'ios', appVersion: '0.1.0' }, undefined, { country: 'US' });
    const s = (await call('GET', '/v1/admin/stats', undefined, token)).body as unknown as import('../src/api').Stats;
    expect(s.countries).toEqual([
      { country: 'IL', users: 2 },
      { country: 'US', users: 1 }
    ]);
  });
});

it('shows the deployed version at the root address', async () => {
  const r = await call('GET', '/');
  expect(r.body).toMatchObject({ ok: true, version: 4 });
});

it('pings running apps when the owner changes something', async () => {
  const pings: (string | undefined)[] = [];
  const changed = (id?: string) => void pings.push(id);
  const token = await becomeAdmin();
  await checkin(FRIEND);
  await call('POST', '/v1/admin/config', { locked: true }, token, { changed });
  await call('POST', '/v1/admin/config', { locked: true }, token, { changed }); // no change → no ping
  await call('POST', '/v1/admin/install', { installId: FRIEND, message: 'hi' }, token, { changed });
  await call('POST', '/v1/admin/invite', { maxUses: 1 }, token, { changed }); // invisible to apps
  await call('POST', '/v1/admin/config', { notifyTopic: 'fristy-abcdefghijkl' }, token, { changed }); // invisible to apps
  expect(pings).toEqual([undefined, FRIEND]);
});
