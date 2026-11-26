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
