-- Famio D1 Schema
-- Apply with: wrangler d1 execute famio --file=src/db/schema.sql

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- e.g. "smiths" (the part before @famio.org)
  owner_email TEXT NOT NULL UNIQUE,     -- 1 address per owner
  tier TEXT NOT NULL DEFAULT 'free',    -- free | no_footer | custom_domain
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  smtp_password_hash TEXT               -- pbkdf2:sha256:<iter>:<salt_b64>:<hash_b64>
);

-- Migration for existing installs (safe to re-run — D1 ignores duplicate column errors):
-- wrangler d1 execute famio --remote --command "ALTER TABLE addresses ADD COLUMN smtp_password_hash TEXT"

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  address_id TEXT NOT NULL REFERENCES addresses(id),
  email TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER,
  added_at INTEGER NOT NULL,
  UNIQUE(address_id, email)
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  address_id TEXT NOT NULL REFERENCES addresses(id),
  type TEXT NOT NULL DEFAULT 'magic_link',  -- magic_link | confirm | unsubscribe
  member_email TEXT,                        -- non-null for confirm/unsubscribe tokens
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bounces (
  id TEXT PRIMARY KEY,
  address_id TEXT NOT NULL REFERENCES addresses(id),
  member_email TEXT NOT NULL,
  bounced_at INTEGER NOT NULL,
  bounce_type TEXT                          -- hard | soft
);
