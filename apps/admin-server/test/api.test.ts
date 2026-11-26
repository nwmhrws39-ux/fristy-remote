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
