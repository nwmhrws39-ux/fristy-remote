import { z } from 'zod';

/*
 * FRISTY Remote owner service.
 *
 * - Every app install checks in with a random install id and a self-chosen
 *   name; the response says whether the app is locked and carries the
 *   current announcement. No IP addresses are stored – only Cloudflare's
 *   2-letter country code.
 * - The owner unlocks the admin role by entering a code that is verified
 *   HERE (never in the app), with a strict attempt limit.
 * - Admins can lock the app for everyone else, block single installs,
 *   publish an announcement and a minimum version.
 * - This service has no way to reach anyone's computer: it only decides
 *   whether the FRISTY apps themselves keep working.
 */

export interface Db {
  first<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  all<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  run(sql: string, ...params: (string | number | null)[]): Promise<void>;
}

export interface Deps {
  db: Db;
  /** owner code, configured as a Worker secret */
  adminCode: string;
  now(): number;
  /** Cloudflare's country code for the caller (no IP) */
  country: string | null;
  /** opaque per-caller key for rate limiting (hashed, never stored raw) */
  clientKey: string;
}

const ONLINE_MS = 20 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60 * 60_000;

const InstallId = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);

const CheckinSchema = z
  .object({
    installId: InstallId,
    name: z.string().trim().min(1).max(40),
    kind: z.enum(['phone', 'pc']),
    platform: z.string().max(24),
    appVersion: z.string().regex(/^\d+\.\d+\.\d+$/)
  })
  .strict();

const LoginSchema = z.object({ installId: InstallId, code: z.string().min(1).max(128) }).strict();

const ConfigSchema = z
  .object({
    locked: z.boolean().optional(),
    lockMessage: z.string().max(300).optional(),
    announcement: z.string().max(500).optional(),
    minVersion: z
      .string()
      .regex(/^(\d+\.\d+\.\d+)?$/)
      .optional()
  })
  .strict();

const STATS_DAYS_MAX = 90;
const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export interface Stats {
  days: { day: string; users: number; phones: number; pcs: number; newUsers: number }[];
  versions: { version: string; kind: string; users: number }[];
  totals: { users: number; phones: number; pcs: number; active7: number; active30: number };
}

async function stats(deps: Deps, days: number): Promise<Stats> {
  const now = deps.now();
  const from = dayKey(now - (days - 1) * 86_400_000);
  const active = await deps.db.all<{ day: string; kind: string; n: number }>(
    'SELECT day, kind, COUNT(*) AS n FROM daily_activity WHERE day >= ? GROUP BY day, kind',
    from
  );
  const fresh = await deps.db.all<{ first_seen: number }>('SELECT first_seen FROM installs WHERE first_seen >= ?', Date.parse(`${from}T00:00:00Z`));
  const out: Stats['days'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now - i * 86_400_000);
    const phones = active.find((a) => a.day === day && a.kind === 'phone')?.n ?? 0;
    const pcs = active.find((a) => a.day === day && a.kind === 'pc')?.n ?? 0;
    out.push({ day, users: phones + pcs, phones, pcs, newUsers: fresh.filter((f) => dayKey(f.first_seen) === day).length });
  }
  // versions of everyone seen in the last 30 days
  const versions = await deps.db.all<{ version: string; kind: string; users: number }>(
    'SELECT app_version AS version, kind, COUNT(*) AS users FROM installs WHERE last_seen >= ? GROUP BY app_version, kind',
    now - 30 * 86_400_000
  );
  versions.sort((a, b) => compareVersions(b.version, a.version) || a.kind.localeCompare(b.kind));
  const count = async (sql: string, ...p: number[]) => (await deps.db.first<{ n: number }>(sql, ...p))?.n ?? 0;
  return {
    days: out,
    versions,
    totals: {
      users: await count('SELECT COUNT(*) AS n FROM installs'),
      phones: await count("SELECT COUNT(*) AS n FROM installs WHERE kind = 'phone'"),
      pcs: await count("SELECT COUNT(*) AS n FROM installs WHERE kind = 'pc'"),
      active7: await count('SELECT COUNT(*) AS n FROM installs WHERE last_seen >= ?', now - 7 * 86_400_000),
      active30: await count('SELECT COUNT(*) AS n FROM installs WHERE last_seen >= ?', now - 30 * 86_400_000)
    }
  };
}

const InstallUpdateSchema = z.object({ installId: InstallId, blocked: z.boolean().optional(), admin: z.literal(false).optional() }).strict();

export interface AppConfig {
  locked: boolean;
  lockMessage: string;
  announcement: string;
  minVersion: string;
}

/* ---------------- helpers ---------------- */

const enc = new TextEncoder();

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two equal-length hex digests. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

const fail = (status: number, error: string) => json({ error }, status);

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 4096) throw new Error('too large');
  return text ? JSON.parse(text) : {};
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

async function getConfig(db: Db): Promise<AppConfig> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM config');
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    locked: m.get('locked') === '1',
    lockMessage: m.get('lockMessage') ?? '',
    announcement: m.get('announcement') ?? '',
    minVersion: m.get('minVersion') ?? ''
  };
}

async function setConfig(db: Db, key: string, value: string) {
  await db.run('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

async function adminFromToken(req: Request, deps: Deps): Promise<string | null> {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return null;
  const row = await deps.db.first<{ install_id: string }>(
    'SELECT t.install_id FROM admin_tokens t JOIN installs i ON i.id = t.install_id WHERE t.token_hash = ? AND i.admin = 1',
    await sha256Hex(m[1]!)
  );
  return row?.install_id ?? null;
}

/** Fixed-window limiter stored in D1. Returns false when the caller is over the limit. */
async function allowAttempt(deps: Deps, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = deps.now();
  const row = await deps.db.first<{ count: number; window_start: number }>('SELECT count, window_start FROM attempts WHERE key = ?', key);
  if (!row || now - row.window_start > windowMs) {
    await deps.db.run('INSERT INTO attempts (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start', key, now);
    return true;
  }
  if (row.count >= max) return false;
  await deps.db.run('UPDATE attempts SET count = count + 1 WHERE key = ?', key);
  return true;
}

/* ---------------- request handling ---------------- */

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname}`;
  let body: unknown = {};
  if (req.method === 'POST') {
    try {
      body = await readJson(req);
    } catch {
      return fail(400, 'invalid JSON');
    }
  }

  switch (route) {
    case 'GET /health':
      return json({ ok: true });

    case 'POST /v1/checkin': {
      const p = CheckinSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid check-in');
      const c = p.data;
      const now = deps.now();
      await deps.db.run(
        `INSERT INTO installs (id, name, kind, platform, app_version, country, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, platform = excluded.platform,
         app_version = excluded.app_version, country = excluded.country, last_seen = excluded.last_seen`,
        c.installId,
        c.name,
        c.kind,
        c.platform,
        c.appVersion,
        deps.country,
        now,
        now
      );
      await deps.db.run(
        `INSERT INTO daily_activity (day, install_id, kind, app_version) VALUES (?, ?, ?, ?)
         ON CONFLICT(day, install_id) DO UPDATE SET kind = excluded.kind, app_version = excluded.app_version`,
        dayKey(now),
        c.installId,
        c.kind,
        c.appVersion
      );
      const inst = await deps.db.first<{ blocked: number; admin: number }>('SELECT blocked, admin FROM installs WHERE id = ?', c.installId);
      const cfg = await getConfig(deps.db);
      const admin = inst?.admin === 1;
      const blocked = inst?.blocked === 1 && !admin;
      const locked = blocked || (cfg.locked && !admin);
      return json({
        locked,
        reason: blocked ? 'blocked' : locked ? 'locked' : null,
        message: locked ? cfg.lockMessage : '',
        announcement: cfg.announcement,
        updateAvailable: !!cfg.minVersion && compareVersions(c.appVersion, cfg.minVersion) < 0,
        admin
      });
    }

    case 'POST /v1/admin/login': {
      if (!deps.adminCode) return fail(503, 'admin code not configured');
      const p = LoginSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid request');
      if (!(await allowAttempt(deps, `login:${deps.clientKey}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS)) || !(await allowAttempt(deps, `login-install:${p.data.installId}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS))) {
        return fail(429, 'too many attempts, try again later');
      }
      const ok = safeEqual(await sha256Hex(p.data.code), await sha256Hex(deps.adminCode));
      if (!ok) return fail(403, 'wrong code');
      const inst = await deps.db.first<{ id: string }>('SELECT id FROM installs WHERE id = ?', p.data.installId);
      if (!inst) return fail(404, 'check in first');
      await deps.db.run('UPDATE installs SET admin = 1, blocked = 0 WHERE id = ?', p.data.installId);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      await deps.db.run('INSERT INTO admin_tokens (token_hash, install_id, created_at) VALUES (?, ?, ?)', await sha256Hex(token), p.data.installId, deps.now());
      return json({ token });
    }
  }

  // Everything below requires an admin token.
  if (url.pathname.startsWith('/v1/admin/')) {
    const adminId = await adminFromToken(req, deps);
    if (!adminId) return fail(401, 'not an admin');

    switch (route) {
      case 'GET /v1/admin/overview': {
        const installs = await deps.db.all<{
          id: string;
          name: string;
          kind: string;
          platform: string;
          app_version: string;
          country: string | null;
          first_seen: number;
          last_seen: number;
          blocked: number;
          admin: number;
        }>('SELECT * FROM installs ORDER BY last_seen DESC LIMIT 500');
        const now = deps.now();
        return json({
          config: await getConfig(deps.db),
          you: adminId,
          installs: installs.map((i) => ({
            id: i.id,
            name: i.name,
            kind: i.kind,
            platform: i.platform,
            appVersion: i.app_version,
            country: i.country,
            firstSeen: i.first_seen,
            lastSeen: i.last_seen,
            online: now - i.last_seen < ONLINE_MS,
            blocked: i.blocked === 1,
            admin: i.admin === 1
          }))
        });
      }

      case 'GET /v1/admin/stats': {
        const days = Math.min(STATS_DAYS_MAX, Math.max(7, Number(url.searchParams.get('days')) || 30));
        return json(await stats(deps, days));
      }

      case 'POST /v1/admin/config': {
        const p = ConfigSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid config');
        const c = p.data;
        if (c.locked !== undefined) await setConfig(deps.db, 'locked', c.locked ? '1' : '0');
        if (c.lockMessage !== undefined) await setConfig(deps.db, 'lockMessage', c.lockMessage);
        if (c.announcement !== undefined) await setConfig(deps.db, 'announcement', c.announcement);
        if (c.minVersion !== undefined) await setConfig(deps.db, 'minVersion', c.minVersion);
        return json({ config: await getConfig(deps.db) });
      }

      case 'POST /v1/admin/install': {
        const p = InstallUpdateSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid request');
        if (p.data.installId === adminId && (p.data.blocked || p.data.admin === false)) return fail(400, 'you cannot block or demote yourself');
        if (p.data.blocked !== undefined) await deps.db.run('UPDATE installs SET blocked = ? WHERE id = ?', p.data.blocked ? 1 : 0, p.data.installId);
        if (p.data.admin === false) {
          await deps.db.run('UPDATE installs SET admin = 0 WHERE id = ?', p.data.installId);
          await deps.db.run('DELETE FROM admin_tokens WHERE install_id = ?', p.data.installId);
        }
        return json({ ok: true });
      }

      case 'POST /v1/admin/logout': {
        const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization') ?? '');
        if (m) await deps.db.run('DELETE FROM admin_tokens WHERE token_hash = ?', await sha256Hex(m[1]!));
        return json({ ok: true });
      }
    }
  }
  return fail(404, 'not found');
}
