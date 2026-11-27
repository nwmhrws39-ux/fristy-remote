-- FRISTY Remote owner service (Cloudflare D1). Idempotent.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'phone' | 'pc'
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  country TEXT,                  -- 2-letter country from Cloudflare, never an IP address
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  admin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_tokens (token_hash TEXT PRIMARY KEY, install_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL);
-- one row per install per active day (UTC), for the admin statistics; no IPs
CREATE TABLE IF NOT EXISTS daily_activity (day TEXT NOT NULL, install_id TEXT NOT NULL, kind TEXT NOT NULL, app_version TEXT NOT NULL, PRIMARY KEY (day, install_id));
-- per-install extras managed by the admin (invite approval, beta tester, personal message)
CREATE TABLE IF NOT EXISTS install_extra (install_id TEXT PRIMARY KEY, invited INTEGER NOT NULL DEFAULT 0, beta INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', message_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '');
-- which install made rate-limited attempts (so the owner can see and lift a limit)
CREATE TABLE IF NOT EXISTS attempt_installs (key TEXT NOT NULL, install_id TEXT NOT NULL, PRIMARY KEY (key, install_id));
