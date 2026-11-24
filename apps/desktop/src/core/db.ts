import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database as SqlDatabase, type SqlValue } from 'sql.js';
import type { MacroStep, Permission } from '@fristy/protocol';

/*
 * SQLite storage (sql.js = SQLite compiled to WebAssembly, so the same build
 * runs inside Electron and in the Node test runner without native rebuilds).
 * The database is persisted atomically (write temp file + rename) shortly
 * after every mutation and on shutdown.
 */

const MIGRATIONS: string[] = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE devices (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL,
     public_key TEXT NOT NULL UNIQUE, permissions TEXT NOT NULL,
     created_at INTEGER NOT NULL, last_seen INTEGER, revoked_at INTEGER);
   CREATE TABLE logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL,
     category TEXT NOT NULL, message TEXT NOT NULL, device_id TEXT, remote TEXT);
   CREATE INDEX logs_ts ON logs(ts);
   CREATE TABLE apps (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, args TEXT NOT NULL DEFAULT '[]',
     process_name TEXT, icon TEXT, favorite INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
   CREATE TABLE games (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, launch_kind TEXT NOT NULL,
     launch_target TEXT NOT NULL, install_dir TEXT, artwork_url TEXT, manual INTEGER NOT NULL DEFAULT 0,
     favorite INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
     last_played INTEGER, playtime_sec INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
   CREATE TABLE urls (id TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL);
   CREATE TABLE shared_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, writable INTEGER NOT NULL);
   CREATE TABLE macros (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, steps TEXT NOT NULL);
   CREATE TABLE transfers (
     id TEXT PRIMARY KEY, device_id TEXT NOT NULL, direction TEXT NOT NULL, name TEXT NOT NULL,
     size INTEGER NOT NULL, transferred INTEGER NOT NULL, status TEXT NOT NULL,
     started_at INTEGER NOT NULL, finished_at INTEGER);`
];

export interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  publicKey: string;
  permissions: Permission[];
  createdAt: number;
  lastSeen: number | null;
  revokedAt: number | null;
}

export interface AppRow {
  id: string;
  name: string;
  path: string;
  args: string[];
  processName: string | null;
  icon: string | null;
  favorite: boolean;
}

export type LaunchKind = 'uri' | 'exe' | 'aumid' | 'fristy';

export interface GameRow {
  id: string;
  name: string;
  source: string;
  launchKind: LaunchKind;
  launchTarget: string;
  installDir: string | null;
  artworkUrl: string | null;
  manual: boolean;
  favorite: boolean;
  hidden: boolean;
  lastPlayed: number | null;
  playtimeSec: number;
}

export interface LogRow {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'security';
  category: string;
  message: string;
  deviceId: string | null;
  remote: string | null;
}

export interface MacroRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  steps: MacroStep[];
}

export interface SharedFolderRow {
  id: string;
  name: string;
  path: string;
  writable: boolean;
}

export interface UrlRow {
  id: string;
  label: string;
  url: string;
}

export interface TransferRow {
  id: string;
  deviceId: string;
  direction: 'upload' | 'download';
  name: string;
  size: number;
  transferred: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  startedAt: number;
  finishedAt: number | null;
}

type Row = Record<string, SqlValue>;

export class Store {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** After close() every read returns nothing and every write is a no-op (late callbacks during shutdown). */
  private closed = false;

  private constructor(
    private readonly db: SqlDatabase,
    private readonly file: string | null
  ) {}

  /** Opens (or creates) the database. `file = null` gives an in-memory database (tests). */
  static async open(file: string | null, wasmPath?: string): Promise<Store> {
    const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
    const data = file && fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    const store = new Store(new SQL.Database(data), file);
    store.migrate();
    return store;
  }

  private migrate() {
    this.db.run('PRAGMA foreign_keys = ON');
    const version = (this.db.exec('PRAGMA user_version')[0]?.values[0]?.[0] as number) ?? 0;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      this.db.exec(MIGRATIONS[v]!);
      this.db.exec(`PRAGMA user_version = ${v + 1}`);
      this.db.exec('COMMIT');
    }
    if (version < MIGRATIONS.length) this.persistSoon();
  }

  /* ---------------- low-level helpers ---------------- */

  private all(sql: string, params: SqlValue[] = []): Row[] {
    if (this.closed) return [];
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    } finally {
      stmt.free();
    }
  }

  private get(sql: string, params: SqlValue[] = []): Row | undefined {
    return this.all(sql, params)[0];
  }

  private run(sql: string, params: SqlValue[] = []): void {
    if (this.closed) return;
    this.db.run(sql, params);
    this.persistSoon();
  }

  private persistSoon() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 250);
  }

  flush(): void {
    if (!this.file || this.closed) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    this.db.close();
  }

  /* ---------------- settings ---------------- */

  getSetting<T>(key: string, fallback: T): T {
    if (this.closed) return fallback;
    const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try {
      return JSON.parse(String(row.value)) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      JSON.stringify(value)
    ]);
  }

  /* ---------------- devices ---------------- */

  private toDevice(r: Row): DeviceRow {
    return {
      id: String(r.id),
      name: String(r.name),
      platform: String(r.platform),
      publicKey: String(r.public_key),
      permissions: JSON.parse(String(r.permissions)) as Permission[],
      createdAt: Number(r.created_at),
      lastSeen: r.last_seen === null ? null : Number(r.last_seen),
      revokedAt: r.revoked_at === null ? null : Number(r.revoked_at)
    };
  }

  listDevices(includeRevoked = false): DeviceRow[] {
    return this.all(`SELECT * FROM devices ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'} ORDER BY created_at DESC`).map(
      (r) => this.toDevice(r)
    );
  }

  getDevice(id: string): DeviceRow | null {
    const r = this.get('SELECT * FROM devices WHERE id = ?', [id]);
    return r ? this.toDevice(r) : null;
  }

  getDeviceByKey(publicKey: string): DeviceRow | null {
    const r = this.get('SELECT * FROM devices WHERE public_key = ?', [publicKey]);
    return r ? this.toDevice(r) : null;
  }

  addDevice(d: Omit<DeviceRow, 'lastSeen' | 'revokedAt'>): void {
    // A re-pair of a previously revoked key replaces the old row.
    this.run('DELETE FROM devices WHERE public_key = ?', [d.publicKey]);
    this.run('INSERT INTO devices (id, name, platform, public_key, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      d.id,
      d.name,
      d.platform,
      d.publicKey,
      JSON.stringify(d.permissions),
      d.createdAt
    ]);
  }

  updateDevicePermissions(id: string, permissions: Permission[]): void {
    this.run('UPDATE devices SET permissions = ? WHERE id = ?', [JSON.stringify(permissions), id]);
  }

  renameDevice(id: string, name: string): void {
    this.run('UPDATE devices SET name = ? WHERE id = ?', [name, id]);
  }

  touchDevice(id: string): void {
    this.run('UPDATE devices SET last_seen = ? WHERE id = ?', [Date.now(), id]);
  }

  revokeDevice(id: string): void {
    this.run('UPDATE devices SET revoked_at = ? WHERE id = ?', [Date.now(), id]);
  }

  /* ---------------- logs ---------------- */

  log(level: LogRow['level'], category: string, message: string, deviceId?: string | null, remote?: string | null): void {
    this.run('INSERT INTO logs (ts, level, category, message, device_id, remote) VALUES (?, ?, ?, ?, ?, ?)', [
      Date.now(),
      level,
      category,
      message.slice(0, 500),
      deviceId ?? null,
      remote ?? null
    ]);
    // keep the log bounded
    if (!this.closed) this.db.run('DELETE FROM logs WHERE id <= (SELECT MAX(id) - 5000 FROM logs)');
  }

  listLogs(limit = 300, category?: string): LogRow[] {
    const rows = category
      ? this.all('SELECT * FROM logs WHERE category = ? ORDER BY id DESC LIMIT ?', [category, limit])
      : this.all('SELECT * FROM logs ORDER BY id DESC LIMIT ?', [limit]);
    return rows.map((r) => ({
      id: Number(r.id),
      ts: Number(r.ts),
      level: String(r.level) as LogRow['level'],
      category: String(r.category),
      message: String(r.message),
      deviceId: r.device_id === null ? null : String(r.device_id),
      remote: r.remote === null ? null : String(r.remote)
    }));
  }

  /* ---------------- apps ---------------- */

  listApps(): AppRow[] {
    return this.all('SELECT * FROM apps ORDER BY favorite DESC, name COLLATE NOCASE').map((r) => ({
      id: String(r.id),
      name: String(r.name),
      path: String(r.path),
      args: JSON.parse(String(r.args)) as string[],
      processName: r.process_name === null ? null : String(r.process_name),
      icon: r.icon === null ? null : String(r.icon),
      favorite: Number(r.favorite) === 1
    }));
  }

  getApp(id: string): AppRow | null {
    return this.listApps().find((a) => a.id === id) ?? null;
  }

  upsertApp(a: AppRow): void {
    this.run(
      `INSERT INTO apps (id, name, path, args, process_name, icon, favorite, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path, args = excluded.args,
       process_name = excluded.process_name, icon = excluded.icon, favorite = excluded.favorite`,
      [a.id, a.name, a.path, JSON.stringify(a.args), a.processName, a.icon, a.favorite ? 1 : 0, Date.now()]
    );
  }

  setAppFavorite(id: string, favorite: boolean): void {
    this.run('UPDATE apps SET favorite = ? WHERE id = ?', [favorite ? 1 : 0, id]);
  }

  removeApp(id: string): void {
    this.run('DELETE FROM apps WHERE id = ?', [id]);
  }

  /* ---------------- games ---------------- */

  private toGame(r: Row): GameRow {
    return {
      id: String(r.id),
      name: String(r.name),
      source: String(r.source),
      launchKind: String(r.launch_kind) as LaunchKind,
      launchTarget: String(r.launch_target),
      installDir: r.install_dir === null ? null : String(r.install_dir),
      artworkUrl: r.artwork_url === null ? null : String(r.artwork_url),
      manual: Number(r.manual) === 1,
      favorite: Number(r.favorite) === 1,
      hidden: Number(r.hidden) === 1,
      lastPlayed: r.last_played === null ? null : Number(r.last_played),
      playtimeSec: Number(r.playtime_sec)
    };
  }

  listGames(includeHidden = false): GameRow[] {
    return this.all(`SELECT * FROM games ${includeHidden ? '' : 'WHERE hidden = 0'} ORDER BY name COLLATE NOCASE`).map((r) =>
      this.toGame(r)
    );
  }

  getGame(id: string): GameRow | null {
    const r = this.get('SELECT * FROM games WHERE id = ?', [id]);
    return r ? this.toGame(r) : null;
  }

  /** Inserts or refreshes a scanned/manual game, preserving user data (favorite, playtime). */
  upsertGame(g: Omit<GameRow, 'favorite' | 'hidden' | 'lastPlayed' | 'playtimeSec'>): void {
    this.run(
      `INSERT INTO games (id, name, source, launch_kind, launch_target, install_dir, artwork_url, manual, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, launch_kind = excluded.launch_kind,
       launch_target = excluded.launch_target, install_dir = excluded.install_dir,
       artwork_url = COALESCE(excluded.artwork_url, games.artwork_url), updated_at = excluded.updated_at`,
      [g.id, g.name, g.source, g.launchKind, g.launchTarget, g.installDir, g.artworkUrl, g.manual ? 1 : 0, Date.now()]
    );
  }

  setGameFavorite(id: string, favorite: boolean): void {
    this.run('UPDATE games SET favorite = ? WHERE id = ?', [favorite ? 1 : 0, id]);
  }

  setGameHidden(id: string, hidden: boolean): void {
    this.run('UPDATE games SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, id]);
  }

  markGamePlayed(id: string): void {
    this.run('UPDATE games SET last_played = ? WHERE id = ?', [Date.now(), id]);
  }

  addPlaytime(id: string, seconds: number): void {
    this.run('UPDATE games SET playtime_sec = playtime_sec + ? WHERE id = ?', [Math.round(seconds), id]);
  }

  removeGame(id: string): void {
    this.run('DELETE FROM games WHERE id = ?', [id]);
  }

  /* ---------------- urls / folders / macros ---------------- */

  listUrls(): UrlRow[] {
    return this.all('SELECT * FROM urls ORDER BY label COLLATE NOCASE').map((r) => ({
      id: String(r.id),
      label: String(r.label),
      url: String(r.url)
    }));
  }
  addUrl(u: UrlRow): void {
    this.run('INSERT OR REPLACE INTO urls (id, label, url) VALUES (?, ?, ?)', [u.id, u.label, u.url]);
  }
  removeUrl(id: string): void {
    this.run('DELETE FROM urls WHERE id = ?', [id]);
  }

  listSharedFolders(): SharedFolderRow[] {
    return this.all('SELECT * FROM shared_folders ORDER BY name COLLATE NOCASE').map((r) => ({
      id: String(r.id),
      name: String(r.name),
      path: String(r.path),
      writable: Number(r.writable) === 1
    }));
  }
  addSharedFolder(f: SharedFolderRow): void {
    this.run('INSERT OR REPLACE INTO shared_folders (id, name, path, writable) VALUES (?, ?, ?, ?)', [
      f.id,
      f.name,
      f.path,
      f.writable ? 1 : 0
    ]);
  }
  removeSharedFolder(id: string): void {
    this.run('DELETE FROM shared_folders WHERE id = ?', [id]);
  }

  listMacros(): MacroRow[] {
    return this.all('SELECT * FROM macros ORDER BY name COLLATE NOCASE').map((r) => ({
      id: String(r.id),
      name: String(r.name),
      icon: String(r.icon),
      color: String(r.color),
      steps: JSON.parse(String(r.steps)) as MacroStep[]
    }));
  }
  upsertMacro(m: MacroRow): void {
    this.run('INSERT OR REPLACE INTO macros (id, name, icon, color, steps) VALUES (?, ?, ?, ?, ?)', [
      m.id,
      m.name,
      m.icon,
      m.color,
      JSON.stringify(m.steps)
    ]);
  }
  removeMacro(id: string): void {
    this.run('DELETE FROM macros WHERE id = ?', [id]);
  }

  /* ---------------- transfers ---------------- */

  upsertTransfer(t: TransferRow): void {
    this.run(
      `INSERT OR REPLACE INTO transfers (id, device_id, direction, name, size, transferred, status, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, t.deviceId, t.direction, t.name, t.size, t.transferred, t.status, t.startedAt, t.finishedAt]
    );
  }

  listTransfers(deviceId?: string, limit = 100): TransferRow[] {
    const rows = deviceId
      ? this.all('SELECT * FROM transfers WHERE device_id = ? ORDER BY started_at DESC LIMIT ?', [deviceId, limit])
      : this.all('SELECT * FROM transfers ORDER BY started_at DESC LIMIT ?', [limit]);
    return rows.map((r) => ({
      id: String(r.id),
      deviceId: String(r.device_id),
      direction: String(r.direction) as TransferRow['direction'],
      name: String(r.name),
      size: Number(r.size),
      transferred: Number(r.transferred),
      status: String(r.status) as TransferRow['status'],
      startedAt: Number(r.started_at),
      finishedAt: r.finished_at === null ? null : Number(r.finished_at)
    }));
  }
}
