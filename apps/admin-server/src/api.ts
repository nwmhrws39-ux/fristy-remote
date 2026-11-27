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
 * - Admins can lock the app for everyone else (now or on a schedule), block
 *   or remove single installs, require invite codes for new users, send an
 *   announcement or a personal message, hold new versions for beta testers,
 *   and get a notification (ntfy) when someone new joins. Every admin action
 *   is written to an audit log.
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
  /** sends a push notification to an ntfy topic (fire and forget) */
  notify?: (topic: string, title: string, message: string) => void;
  /** tells running apps to check in now (all of them, or one install) */
  changed?: (installId?: string) => void;
}

/** bump when the API changes, so the owner can check what is deployed */
export const SERVER_VERSION = 6;

const ONLINE_MS = 20 * 60_000;
const DAY_MS = 86_400_000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60 * 60_000;
const INVITE_MAX_ATTEMPTS = 10;
const STATS_DAYS_MAX = 90;
const LOG_KEEP = 500;

const InstallId = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);
const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
const InviteCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,16}$/);

const CheckinSchema = z
  .object({
    installId: InstallId,
    name: z.string().trim().min(1).max(40),
    kind: z.enum(['phone', 'pc']),
    platform: z.string().max(24),
    appVersion: Version,
    invite: z.string().max(32).optional()
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
      .optional(),
    inviteRequired: z.boolean().optional(),
    maintenance: z
      .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), message: z.string().max(300) })
      .refine((m) => m.end > m.start, 'end must be after start')
      .nullable()
      .optional(),
    notifyTopic: z
      .string()
      .regex(/^([A-Za-z0-9_-]{12,64})?$/)
      .optional(),
    betaChannel: z.boolean().optional()
  })
  .strict();

const InstallUpdateSchema = z
  .object({
    installId: InstallId,
    blocked: z.boolean().optional(),
    admin: z.literal(false).optional(),
    remove: z.literal(true).optional(),
    approve: z.literal(true).optional(),
    beta: z.boolean().optional(),
    message: z.string().max(300).optional()
  })
  .strict();

const MeSchema = z.object({ installId: InstallId }).strict();
export const REPORT_CATEGORIES = ['unauthorized-access', 'unauthorized-tracking', 'account-compromise', 'vulnerability', 'other'] as const;
const ReportSchema = z
  .object({
    installId: InstallId.optional(),
    category: z.enum(REPORT_CATEGORIES),
    message: z.string().trim().min(5).max(1000),
    contact: z.string().trim().max(200).optional()
  })
  .strict();

/** How long the owner service keeps each kind of data (see legal/DATA_RETENTION_POLICY.md). */
export const RETENTION = {
  dailyActivityDays: 180,
  inactiveInstallDays: 365,
  attemptsDays: 2,
  adminLogDays: 365,
  resolvedReportDays: 365,
  adminTokenDays: 180
} as const;

const InviteCreateSchema = z.object({ maxUses: z.number().int().min(1).max(1000), note: z.string().max(60).optional() }).strict();
const InviteDeleteSchema = z.object({ code: InviteCode }).strict();

export interface AppConfig {
  locked: boolean;
  lockMessage: string;
  announcement: string;
  minVersion: string;
  inviteRequired: boolean;
  /** installs first seen before this time never need an invite */
  inviteSince: number;
  maintenance: { start: number; end: number; message: string } | null;
  notifyTopic: string;
  betaChannel: boolean;
  stablePc: string;
  stableIos: string;
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

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Unambiguous characters only (no 0/O, 1/I). */
function newInviteCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join('');
}

async function getConfig(db: Db): Promise<AppConfig> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM config');
  const m = new Map(rows.map((r) => [r.key, r.value]));
  let maintenance: AppConfig['maintenance'] = null;
  try {
    const v = JSON.parse(m.get('maintenance') ?? 'null') as AppConfig['maintenance'];
    if (v && typeof v.start === 'number' && typeof v.end === 'number') maintenance = { start: v.start, end: v.end, message: String(v.message ?? '') };
  } catch {
    /* ignore */
  }
  return {
    locked: m.get('locked') === '1',
    lockMessage: m.get('lockMessage') ?? '',
    announcement: m.get('announcement') ?? '',
    minVersion: m.get('minVersion') ?? '',
    inviteRequired: m.get('inviteRequired') === '1',
    inviteSince: Number(m.get('inviteSince') ?? 0),
    maintenance,
    notifyTopic: m.get('notifyTopic') ?? '',
    betaChannel: m.get('betaChannel') === '1',
    stablePc: m.get('stablePc') ?? '',
    stableIos: m.get('stableIos') ?? ''
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
async function allowAttempt(deps: Deps, key: string, max: number, windowMs: number, installId?: string): Promise<boolean> {
  const now = deps.now();
  if (installId) await deps.db.run('INSERT INTO attempt_installs (key, install_id) VALUES (?, ?) ON CONFLICT(key, install_id) DO NOTHING', key, installId);
  const row = await deps.db.first<{ count: number; window_start: number }>('SELECT count, window_start FROM attempts WHERE key = ?', key);
  if (!row || now - row.window_start > windowMs) {
    await deps.db.run('INSERT INTO attempts (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start', key, now);
    return true;
  }
  if (row.count >= max) return false;
  await deps.db.run('UPDATE attempts SET count = count + 1 WHERE key = ?', key);
  return true;
}

async function audit(deps: Deps, actor: string, action: string, target = '', detail = '') {
  await deps.db.run('INSERT INTO admin_log (ts, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)', deps.now(), actor, action, target, detail.slice(0, 300));
  await deps.db.run('DELETE FROM admin_log WHERE id <= (SELECT MAX(id) FROM admin_log) - ?', LOG_KEEP);
}

async function installName(db: Db, id: string): Promise<string> {
  return (await db.first<{ name: string }>('SELECT name FROM installs WHERE id = ?', id))?.name ?? id.slice(0, 12);
}

async function ensureExtra(db: Db, id: string) {
  await db.run('INSERT INTO install_extra (install_id) VALUES (?) ON CONFLICT(install_id) DO NOTHING', id);
}

/* ---------------- user data rights ---------------- */

/** Everything the owner service holds about one install (data access / portability). */
async function exportInstall(db: Db, id: string) {
  const install = await db.first<Record<string, unknown>>('SELECT id, name, kind, platform, app_version, country, first_seen, last_seen, blocked, admin FROM installs WHERE id = ?', id);
  const extra = await db.first<Record<string, unknown>>('SELECT invited, beta, message, message_at FROM install_extra WHERE install_id = ?', id);
  const activity = await db.all<{ day: string; kind: string; app_version: string }>('SELECT day, kind, app_version FROM daily_activity WHERE install_id = ? ORDER BY day', id);
  const reports = await db.all<Record<string, unknown>>('SELECT ts, category, message, contact, status FROM abuse_reports WHERE install_id = ?', id);
  const attempts = await db.all<{ key: string }>('SELECT key FROM attempt_installs WHERE install_id = ?', id);
  return {
    exportedAt: new Date().toISOString(),
    note: 'This is all data the FRISTY Remote owner service stores about this app installation. IP addresses are never stored; failed-code limits use a one-way hash of the network address for up to 2 days.',
    install,
    extra,
    dailyActivity: activity,
    reports,
    rateLimitEntries: attempts.length
  };
}

/** Erases an install and everything linked to it. */
async function deleteInstall(db: Db, id: string) {
  const keys = await db.all<{ key: string }>('SELECT key FROM attempt_installs WHERE install_id = ?', id);
  for (const k of keys) await db.run('DELETE FROM attempts WHERE key = ?', k.key);
  await db.run('DELETE FROM attempts WHERE key = ?', `login-install:${id}`);
  await db.run('DELETE FROM attempt_installs WHERE install_id = ?', id);
  await db.run('DELETE FROM admin_tokens WHERE install_id = ?', id);
  await db.run('DELETE FROM daily_activity WHERE install_id = ?', id);
  await db.run('DELETE FROM install_extra WHERE install_id = ?', id);
  await db.run('UPDATE abuse_reports SET install_id = NULL WHERE install_id = ?', id);
  await db.run('DELETE FROM installs WHERE id = ?', id);
}

/** Retention schedule, run daily (Cron Trigger) – see legal/DATA_RETENTION_POLICY.md. */
export async function purgeExpired(deps: Pick<Deps, 'db' | 'now'>): Promise<{ installs: number }> {
  const now = deps.now();
  const days = (n: number) => now - n * DAY_MS;
  await deps.db.run('DELETE FROM daily_activity WHERE day < ?', dayKey(days(RETENTION.dailyActivityDays)));
  await deps.db.run('DELETE FROM attempts WHERE window_start < ?', days(RETENTION.attemptsDays));
  await deps.db.run('DELETE FROM attempt_installs WHERE key NOT IN (SELECT key FROM attempts)');
  await deps.db.run('DELETE FROM admin_log WHERE ts < ?', days(RETENTION.adminLogDays));
  await deps.db.run("DELETE FROM abuse_reports WHERE status = 'resolved' AND resolved_at < ?", days(RETENTION.resolvedReportDays));
  await deps.db.run('DELETE FROM admin_tokens WHERE created_at < ?', days(RETENTION.adminTokenDays));
  const stale = await deps.db.all<{ id: string }>('SELECT id FROM installs WHERE last_seen < ? AND admin = 0', days(RETENTION.inactiveInstallDays));
  for (const s of stale) await deleteInstall(deps.db, s.id);
  return { installs: stale.length };
}

/* ---------------- attempt limits ---------------- */

export interface AttemptLimit {
  /** install that hit the limit, or null when it cannot be told (e.g. before checking in) */
  installId: string | null;
  name: string | null;
  kind: 'admin' | 'invite';
  attempts: number;
  resetAt: number;
  keys: string[];
}

/** Everyone who is currently blocked from trying a code, grouped per install. */
async function activeLimits(deps: Deps): Promise<AttemptLimit[]> {
  const now = deps.now();
  const rows = await deps.db.all<{ key: string; count: number; window_start: number }>('SELECT * FROM attempts WHERE window_start > ?', now - LOGIN_WINDOW_MS);
  const links = await deps.db.all<{ key: string; install_id: string }>('SELECT * FROM attempt_installs');
  const names = new Map((await deps.db.all<{ id: string; name: string }>('SELECT id, name FROM installs')).map((r) => [r.id, r.name]));
  const out = new Map<string, AttemptLimit>();
  for (const r of rows) {
    const kind = r.key.startsWith('invite:') ? 'invite' : 'admin';
    if (r.count < (kind === 'invite' ? INVITE_MAX_ATTEMPTS : LOGIN_MAX_ATTEMPTS)) continue;
    const ids = r.key.startsWith('login-install:') ? [r.key.slice('login-install:'.length)] : links.filter((l) => l.key === r.key).map((l) => l.install_id);
    for (const id of ids.length ? ids : [null]) {
      const k = `${kind}|${id ?? r.key}`;
      const e = out.get(k) ?? { installId: id, name: id ? (names.get(id) ?? null) : null, kind, attempts: 0, resetAt: 0, keys: [] };
      e.attempts = Math.max(e.attempts, r.count);
      e.resetAt = Math.max(e.resetAt, r.window_start + LOGIN_WINDOW_MS);
      e.keys.push(r.key);
      out.set(k, e);
    }
  }
  return [...out.values()].sort((a, b) => b.resetAt - a.resetAt);
}

/* ---------------- statistics ---------------- */

export interface Stats {
  days: { day: string; users: number; phones: number; pcs: number; newUsers: number }[];
  versions: { version: string; kind: string; users: number }[];
  countries: { country: string | null; users: number }[];
  totals: { users: number; phones: number; pcs: number; active7: number; active30: number };
}

async function stats(deps: Deps, days: number): Promise<Stats> {
  const now = deps.now();
  const from = dayKey(now - (days - 1) * DAY_MS);
  const active = await deps.db.all<{ day: string; kind: string; n: number }>(
    'SELECT day, kind, COUNT(*) AS n FROM daily_activity WHERE day >= ? GROUP BY day, kind',
    from
  );
  const fresh = await deps.db.all<{ first_seen: number }>('SELECT first_seen FROM installs WHERE first_seen >= ?', Date.parse(`${from}T00:00:00Z`));
  const out: Stats['days'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now - i * DAY_MS);
    const phones = active.find((a) => a.day === day && a.kind === 'phone')?.n ?? 0;
    const pcs = active.find((a) => a.day === day && a.kind === 'pc')?.n ?? 0;
    out.push({ day, users: phones + pcs, phones, pcs, newUsers: fresh.filter((f) => dayKey(f.first_seen) === day).length });
  }
  const since30 = now - 30 * DAY_MS;
  const versions = await deps.db.all<{ version: string; kind: string; users: number }>(
    'SELECT app_version AS version, kind, COUNT(*) AS users FROM installs WHERE last_seen >= ? GROUP BY app_version, kind',
    since30
  );
  versions.sort((a, b) => compareVersions(b.version, a.version) || a.kind.localeCompare(b.kind));
  const countries = await deps.db.all<{ country: string | null; users: number }>(
    'SELECT country, COUNT(*) AS users FROM installs WHERE last_seen >= ? GROUP BY country ORDER BY users DESC LIMIT 50',
    since30
  );
  const count = async (sql: string, ...p: number[]) => (await deps.db.first<{ n: number }>(sql, ...p))?.n ?? 0;
  return {
    days: out,
    versions,
    countries,
    totals: {
      users: await count('SELECT COUNT(*) AS n FROM installs'),
      phones: await count("SELECT COUNT(*) AS n FROM installs WHERE kind = 'phone'"),
      pcs: await count("SELECT COUNT(*) AS n FROM installs WHERE kind = 'pc'"),
      active7: await count('SELECT COUNT(*) AS n FROM installs WHERE last_seen >= ?', now - 7 * DAY_MS),
      active30: await count('SELECT COUNT(*) AS n FROM installs WHERE last_seen >= ?', since30)
    }
  };
}

/** Highest version of each app kind that beta testers (and admins) are running. */
async function betaVersions(db: Db): Promise<{ pc: string; ios: string }> {
  const rows = await db.all<{ kind: string; app_version: string }>(
    'SELECT i.kind, i.app_version FROM installs i LEFT JOIN install_extra e ON e.install_id = i.id WHERE i.admin = 1 OR e.beta = 1'
  );
  const max = (kind: string) => rows.filter((r) => r.kind === kind).reduce((m, r) => (!m || compareVersions(r.app_version, m) > 0 ? r.app_version : m), '');
  return { pc: max('pc'), ios: max('phone') };
}

async function maxVersion(db: Db, kind: string): Promise<string> {
  const rows = await db.all<{ app_version: string }>('SELECT DISTINCT app_version FROM installs WHERE kind = ?', kind);
  return rows.reduce((m, r) => (!m || compareVersions(r.app_version, m) > 0 ? r.app_version : m), '');
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
    case 'GET /':
    case 'GET /health':
      // open the server address in a browser to see which version is deployed
      return json({ ok: true, service: 'FRISTY Remote owner service', version: SERVER_VERSION });

    case 'POST /v1/checkin': {
      const p = CheckinSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid check-in');
      const c = p.data;
      const now = deps.now();
      const existed = await deps.db.first<{ id: string }>('SELECT id FROM installs WHERE id = ?', c.installId);
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
      const inst = await deps.db.first<{ blocked: number; admin: number; first_seen: number; invited: number | null; beta: number | null; message: string | null; message_at: number | null }>(
        `SELECT i.blocked, i.admin, i.first_seen, e.invited, e.beta, e.message, e.message_at
         FROM installs i LEFT JOIN install_extra e ON e.install_id = i.id WHERE i.id = ?`,
        c.installId
      );
      const cfg = await getConfig(deps.db);
      const admin = inst?.admin === 1;

      // Invite codes: only installs that joined after "invite required" was switched on need one.
      let invited = !cfg.inviteRequired || admin || inst?.invited === 1 || (inst?.first_seen ?? now) < cfg.inviteSince;
      let inviteError: string | null = null;
      if (!invited && c.invite) {
        const code = InviteCode.safeParse(c.invite);
        if (!(await allowAttempt(deps, `invite:${deps.clientKey}`, INVITE_MAX_ATTEMPTS, LOGIN_WINDOW_MS, c.installId))) inviteError = 'too many attempts, try again later';
        else if (!code.success) inviteError = 'wrong invite code';
        else {
          const inv = await deps.db.first<{ max_uses: number; uses: number }>('SELECT max_uses, uses FROM invites WHERE code = ?', code.data);
          if (!inv || inv.uses >= inv.max_uses) inviteError = 'wrong invite code';
          else {
            await deps.db.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', code.data);
            await ensureExtra(deps.db, c.installId);
            await deps.db.run('UPDATE install_extra SET invited = 1 WHERE install_id = ?', c.installId);
            await audit(deps, c.installId, 'invite.used', c.installId, code.data);
            invited = true;
          }
        }
      }

      if (!existed && cfg.notifyTopic && deps.notify) {
        const flag = deps.country ?? '';
        deps.notify(
          cfg.notifyTopic,
          'FRISTY Remote',
          `${invited ? 'New user joined' : 'New user is waiting for an invite'}: ${c.kind === 'pc' ? '💻 PC' : '📱 phone'} ${flag}`.trim()
        );
      }

      const m = cfg.maintenance;
      const inMaintenance = !!m && now >= m.start && now < m.end;
      const blocked = inst?.blocked === 1 && !admin;
      const reason = blocked ? 'blocked' : !invited ? 'invite' : inMaintenance && !admin ? 'maintenance' : cfg.locked && !admin ? 'locked' : null;
      const beta = admin || inst?.beta === 1;
      return json({
        locked: reason !== null,
        reason,
        message: reason === 'locked' ? cfg.lockMessage : reason === 'maintenance' ? (m?.message ?? '') : '',
        announcement: invited ? cfg.announcement : '',
        updateAvailable: !!cfg.minVersion && compareVersions(c.appVersion, cfg.minVersion) < 0,
        admin,
        // upcoming or running maintenance window, for the "will be locked at …" banner
        maintenance: m && now < m.end && now > m.start - 7 * DAY_MS ? m : null,
        personal: invited && inst?.message ? { text: inst.message, at: inst.message_at ?? 0 } : null,
        beta,
        // newest version this install may update to ('' = any)
        stableVersion: cfg.betaChannel && !beta ? (c.kind === 'pc' ? cfg.stablePc : cfg.stableIos) : '',
        inviteError
      });
    }

    case 'POST /v1/me/export': {
      const p = MeSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid request');
      if (!(await allowAttempt(deps, `me:${deps.clientKey}`, 20, LOGIN_WINDOW_MS))) return fail(429, 'too many requests, try again later');
      return json(await exportInstall(deps.db, p.data.installId));
    }

    case 'POST /v1/me/delete': {
      const p = MeSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid request');
      if (!(await allowAttempt(deps, `me:${deps.clientKey}`, 20, LOGIN_WINDOW_MS))) return fail(429, 'too many requests, try again later');
      const inst = await deps.db.first<{ admin: number }>('SELECT admin FROM installs WHERE id = ?', p.data.installId);
      await deleteInstall(deps.db, p.data.installId);
      if (inst) await audit(deps, 'user', 'data.deleted', '', inst.admin ? 'admin install' : '');
      return json({ ok: true, deleted: !!inst });
    }

    case 'POST /v1/report': {
      const p = ReportSchema.safeParse(body);
      if (!p.success) return fail(400, 'please choose a category and describe the problem (5–1000 characters)');
      if (!(await allowAttempt(deps, `report:${deps.clientKey}`, 5, LOGIN_WINDOW_MS))) return fail(429, 'too many reports, try again later');
      await deps.db.run(
        'INSERT INTO abuse_reports (ts, install_id, category, message, contact) VALUES (?, ?, ?, ?, ?)',
        deps.now(),
        p.data.installId ?? null,
        p.data.category,
        p.data.message,
        p.data.contact ?? ''
      );
      const cfg = await getConfig(deps.db);
      if (cfg.notifyTopic && deps.notify) deps.notify(cfg.notifyTopic, 'FRISTY Remote', `New report: ${p.data.category}`);
      return json({ ok: true });
    }

    case 'POST /v1/admin/login': {
      if (!deps.adminCode) return fail(503, 'admin code not configured');
      const p = LoginSchema.safeParse(body);
      if (!p.success) return fail(400, 'invalid request');
      if (
        !(await allowAttempt(deps, `login:${deps.clientKey}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, p.data.installId)) ||
        !(await allowAttempt(deps, `login-install:${p.data.installId}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, p.data.installId))
      ) {
        const rows = await deps.db.all<{ window_start: number }>('SELECT window_start FROM attempts WHERE key IN (?, ?)', `login:${deps.clientKey}`, `login-install:${p.data.installId}`);
        const until = Math.max(0, ...rows.map((r) => r.window_start + LOGIN_WINDOW_MS));
        const minutes = Math.max(1, Math.ceil((until - deps.now()) / 60_000));
        return json({ error: `too many attempts – try again in ${minutes} min, or ask the owner to remove the limit`, retryAfterMinutes: minutes }, 429);
      }
      const ok = safeEqual(await sha256Hex(p.data.code), await sha256Hex(deps.adminCode));
      if (!ok) {
        await audit(deps, p.data.installId, 'login.failed');
        return fail(403, 'wrong code');
      }
      const inst = await deps.db.first<{ id: string }>('SELECT id FROM installs WHERE id = ?', p.data.installId);
      if (!inst) return fail(404, 'check in first');
      await deps.db.run('UPDATE installs SET admin = 1, blocked = 0 WHERE id = ?', p.data.installId);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      await deps.db.run('INSERT INTO admin_tokens (token_hash, install_id, created_at) VALUES (?, ?, ?)', await sha256Hex(token), p.data.installId, deps.now());
      await audit(deps, p.data.installId, 'login');
      return json({ token });
    }
  }

  // Everything below requires an admin token.
  if (url.pathname.startsWith('/v1/admin/')) {
    const adminId = await adminFromToken(req, deps);
    if (!adminId) return fail(401, 'not an admin');

    switch (route) {
      case 'GET /v1/admin/overview': {
        const cfg = await getConfig(deps.db);
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
          invited: number | null;
          beta: number | null;
          message: string | null;
        }>('SELECT i.*, e.invited, e.beta, e.message FROM installs i LEFT JOIN install_extra e ON e.install_id = i.id ORDER BY i.last_seen DESC LIMIT 500');
        const invites = await deps.db.all<{ code: string; note: string; max_uses: number; uses: number; created_at: number }>('SELECT * FROM invites ORDER BY created_at DESC LIMIT 100');
        const now = deps.now();
        return json({
          config: cfg,
          you: adminId,
          betaVersions: await betaVersions(deps.db),
          invites: invites.map((i) => ({ code: i.code, note: i.note, maxUses: i.max_uses, uses: i.uses, createdAt: i.created_at })),
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
            admin: i.admin === 1,
            pending: cfg.inviteRequired && i.admin !== 1 && i.invited !== 1 && i.first_seen >= cfg.inviteSince,
            beta: i.beta === 1,
            message: i.message ?? ''
          }))
        });
      }

      case 'GET /v1/admin/stats': {
        const days = Math.min(STATS_DAYS_MAX, Math.max(7, Number(url.searchParams.get('days')) || 30));
        return json(await stats(deps, days));
      }

      case 'GET /v1/admin/limits': {
        // keys are hashes; never shown, only used to lift a limit
        const limits = await activeLimits(deps);
        return json({ limits: await Promise.all(limits.map(async ({ keys, ...l }) => ({ ...l, id: (await sha256Hex(keys.join(','))).slice(0, 16) }))) });
      }

      case 'POST /v1/admin/limits/reset': {
        const p = z.object({ installId: InstallId.optional(), id: z.string().regex(/^[a-f0-9]{16}$/).optional() }).strict().safeParse(body);
        if (!p.success || (!p.data.installId && !p.data.id)) return fail(400, 'invalid request');
        const limits = await activeLimits(deps);
        const ids = await Promise.all(limits.map(async (l) => (await sha256Hex(l.keys.join(','))).slice(0, 16)));
        const match = limits.filter((l, i) => (p.data.installId ? l.installId === p.data.installId : ids[i] === p.data.id));
        const keys = new Set(match.flatMap((l) => l.keys));
        if (p.data.installId) {
          keys.add(`login-install:${p.data.installId}`);
          for (const l of await deps.db.all<{ key: string }>('SELECT key FROM attempt_installs WHERE install_id = ?', p.data.installId)) keys.add(l.key);
        }
        for (const k of keys) {
          await deps.db.run('DELETE FROM attempts WHERE key = ?', k);
          await deps.db.run('DELETE FROM attempt_installs WHERE key = ?', k);
        }
        await audit(deps, adminId, 'limits.reset', p.data.installId ?? '');
        return json({ ok: true, cleared: keys.size });
      }

      case 'GET /v1/admin/reports': {
        const rows = await deps.db.all<{ id: number; ts: number; install_id: string | null; category: string; message: string; contact: string; status: string; name: string | null }>(
          'SELECT r.*, i.name FROM abuse_reports r LEFT JOIN installs i ON i.id = r.install_id ORDER BY r.status = \'open\' DESC, r.id DESC LIMIT 200'
        );
        return json({ reports: rows.map((r) => ({ id: r.id, ts: r.ts, installId: r.install_id, name: r.name, category: r.category, message: r.message, contact: r.contact, status: r.status })) });
      }

      case 'POST /v1/admin/reports/resolve': {
        const p = z.object({ id: z.number().int().positive() }).strict().safeParse(body);
        if (!p.success) return fail(400, 'invalid request');
        await deps.db.run("UPDATE abuse_reports SET status = 'resolved', resolved_at = ? WHERE id = ?", deps.now(), p.data.id);
        await audit(deps, adminId, 'report.resolved', '', String(p.data.id));
        return json({ ok: true });
      }

      case 'GET /v1/admin/log': {
        const rows = await deps.db.all<{ id: number; ts: number; actor: string; action: string; target: string; detail: string; actor_name: string | null; target_name: string | null }>(
          `SELECT l.*, a.name AS actor_name, t.name AS target_name FROM admin_log l
           LEFT JOIN installs a ON a.id = l.actor LEFT JOIN installs t ON t.id = l.target
           ORDER BY l.id DESC LIMIT 150`
        );
        return json({
          entries: rows.map((r) => ({ id: r.id, ts: r.ts, actor: r.actor_name ?? r.actor.slice(0, 12), action: r.action, target: r.target ? (r.target_name ?? r.target.slice(0, 12)) : '', detail: r.detail }))
        });
      }

      case 'POST /v1/admin/config': {
        const p = ConfigSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid config');
        const c = p.data;
        const before = await getConfig(deps.db);
        if (c.locked !== undefined && c.locked !== before.locked) {
          await setConfig(deps.db, 'locked', c.locked ? '1' : '0');
          await audit(deps, adminId, c.locked ? 'lock' : 'unlock');
        }
        if (c.lockMessage !== undefined && c.lockMessage !== before.lockMessage) {
          await setConfig(deps.db, 'lockMessage', c.lockMessage);
          await audit(deps, adminId, 'lock.message', '', c.lockMessage);
        }
        if (c.announcement !== undefined && c.announcement !== before.announcement) {
          await setConfig(deps.db, 'announcement', c.announcement);
          await audit(deps, adminId, c.announcement ? 'announcement' : 'announcement.clear', '', c.announcement);
        }
        if (c.minVersion !== undefined && c.minVersion !== before.minVersion) {
          await setConfig(deps.db, 'minVersion', c.minVersion);
          await audit(deps, adminId, 'minVersion', '', c.minVersion);
        }
        if (c.inviteRequired !== undefined && c.inviteRequired !== before.inviteRequired) {
          await setConfig(deps.db, 'inviteRequired', c.inviteRequired ? '1' : '0');
          // everyone who already uses the app keeps using it
          if (c.inviteRequired) await setConfig(deps.db, 'inviteSince', String(deps.now()));
          await audit(deps, adminId, c.inviteRequired ? 'invites.on' : 'invites.off');
        }
        if (c.maintenance !== undefined) {
          await setConfig(deps.db, 'maintenance', JSON.stringify(c.maintenance));
          await audit(deps, adminId, c.maintenance ? 'maintenance' : 'maintenance.clear', '', c.maintenance ? `${c.maintenance.start}-${c.maintenance.end}` : '');
        }
        if (c.notifyTopic !== undefined && c.notifyTopic !== before.notifyTopic) {
          await setConfig(deps.db, 'notifyTopic', c.notifyTopic);
          await audit(deps, adminId, c.notifyTopic ? 'notify.on' : 'notify.off');
        }
        if (c.betaChannel !== undefined && c.betaChannel !== before.betaChannel) {
          await setConfig(deps.db, 'betaChannel', c.betaChannel ? '1' : '0');
          if (c.betaChannel) {
            // freeze everyone else on the newest version already in use
            await setConfig(deps.db, 'stablePc', await maxVersion(deps.db, 'pc'));
            await setConfig(deps.db, 'stableIos', await maxVersion(deps.db, 'phone'));
          }
          await audit(deps, adminId, c.betaChannel ? 'beta.on' : 'beta.off');
        }
        const after = await getConfig(deps.db);
        const visible = (x: AppConfig) =>
          JSON.stringify([x.locked, x.lockMessage, x.announcement, x.minVersion, x.inviteRequired, x.maintenance, x.betaChannel, x.stablePc, x.stableIos]);
        if (visible(before) !== visible(after)) deps.changed?.();
        return json({ config: after });
      }

      case 'POST /v1/admin/release': {
        const v = await betaVersions(deps.db);
        const cfg = await getConfig(deps.db);
        const pc = v.pc && (!cfg.stablePc || compareVersions(v.pc, cfg.stablePc) > 0) ? v.pc : cfg.stablePc;
        const ios = v.ios && (!cfg.stableIos || compareVersions(v.ios, cfg.stableIos) > 0) ? v.ios : cfg.stableIos;
        await setConfig(deps.db, 'stablePc', pc);
        await setConfig(deps.db, 'stableIos', ios);
        await audit(deps, adminId, 'release', '', `PC ${pc || '-'} · iPhone ${ios || '-'}`);
        deps.changed?.();
        return json({ config: await getConfig(deps.db) });
      }

      case 'POST /v1/admin/install': {
        const p = InstallUpdateSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid request');
        const d = p.data;
        if (d.installId === adminId && (d.blocked || d.admin === false || d.remove)) return fail(400, 'you cannot block, demote or remove yourself');
        const exists = await deps.db.first<{ id: string }>('SELECT id FROM installs WHERE id = ?', d.installId);
        if (!exists) return fail(404, 'unknown install');
        const name = await installName(deps.db, d.installId);
        if (d.remove) {
          // removes the entry and its history; an app that is still in use simply checks in again
          await audit(deps, adminId, 'remove', '', name);
          await deps.db.run('DELETE FROM admin_tokens WHERE install_id = ?', d.installId);
          await deps.db.run('DELETE FROM daily_activity WHERE install_id = ?', d.installId);
          await deps.db.run('DELETE FROM install_extra WHERE install_id = ?', d.installId);
          await deps.db.run('DELETE FROM installs WHERE id = ?', d.installId);
          deps.changed?.(d.installId);
          return json({ ok: true });
        }
        if (d.blocked !== undefined) {
          await deps.db.run('UPDATE installs SET blocked = ? WHERE id = ?', d.blocked ? 1 : 0, d.installId);
          await audit(deps, adminId, d.blocked ? 'block' : 'unblock', d.installId);
        }
        if (d.admin === false) {
          await deps.db.run('UPDATE installs SET admin = 0 WHERE id = ?', d.installId);
          await deps.db.run('DELETE FROM admin_tokens WHERE install_id = ?', d.installId);
          await audit(deps, adminId, 'demote', d.installId);
        }
        if (d.approve || d.beta !== undefined || d.message !== undefined) await ensureExtra(deps.db, d.installId);
        if (d.approve) {
          await deps.db.run('UPDATE install_extra SET invited = 1 WHERE install_id = ?', d.installId);
          await audit(deps, adminId, 'approve', d.installId);
        }
        if (d.beta !== undefined) {
          await deps.db.run('UPDATE install_extra SET beta = ? WHERE install_id = ?', d.beta ? 1 : 0, d.installId);
          await audit(deps, adminId, d.beta ? 'beta.add' : 'beta.remove', d.installId);
        }
        if (d.message !== undefined) {
          await deps.db.run('UPDATE install_extra SET message = ?, message_at = ? WHERE install_id = ?', d.message, deps.now(), d.installId);
          await audit(deps, adminId, d.message ? 'message' : 'message.clear', d.installId, d.message);
        }
        deps.changed?.(d.installId);
        return json({ ok: true });
      }

      case 'POST /v1/admin/invite': {
        const p = InviteCreateSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid request');
        const code = newInviteCode();
        await deps.db.run('INSERT INTO invites (code, note, max_uses, uses, created_at) VALUES (?, ?, ?, 0, ?)', code, p.data.note ?? '', p.data.maxUses, deps.now());
        await audit(deps, adminId, 'invite.create', '', `${code} ×${p.data.maxUses}${p.data.note ? ` (${p.data.note})` : ''}`);
        return json({ code });
      }

      case 'POST /v1/admin/invite/delete': {
        const p = InviteDeleteSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid request');
        await deps.db.run('DELETE FROM invites WHERE code = ?', p.data.code);
        await audit(deps, adminId, 'invite.delete', '', p.data.code);
        return json({ ok: true });
      }

      case 'POST /v1/admin/notify-test': {
        const cfg = await getConfig(deps.db);
        if (!cfg.notifyTopic || !deps.notify) return fail(400, 'notifications are not set up');
        deps.notify(cfg.notifyTopic, 'FRISTY Remote', '✅ Notifications work');
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
