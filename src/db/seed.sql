-- Local dev seed data. Run with: bun run db:seed
-- Uses fixed tokens so you can bookmark the local URLs.
--
-- Manage page:  http://localhost:8787/manage?token=devtoken_magic
-- Confirm page: http://localhost:8787/confirm?token=devtoken_confirm
-- Unsub page:   http://localhost:8787/unsubscribe?token=devtoken_unsub

-- Family address
INSERT OR IGNORE INTO addresses (id, name, owner_email, tier, created_at, active)
VALUES (
  'addr_testfamily',
  'testfamily',
  'owner@example.com',
  'free',
  1748000000,
  1
);

-- Members: owner (confirmed), member1 (confirmed), member2 (pending)
INSERT OR IGNORE INTO members (id, address_id, email, confirmed, confirmed_at, added_at)
VALUES
  ('mem_owner',   'addr_testfamily', 'owner@example.com',   1, 1748000100, 1748000000),
  ('mem_alice',   'addr_testfamily', 'alice@example.com',   1, 1748000200, 1748000000),
  ('mem_pending', 'addr_testfamily', 'pending@example.com', 0, NULL,       1748000000);

-- Magic link token (owner manages roster)
INSERT OR IGNORE INTO tokens (token, address_id, type, member_email, expires_at, used)
VALUES ('devtoken_magic', 'addr_testfamily', 'magic_link', NULL, 9999999999, 0);

-- Confirm token (pending@example.com opts in)
INSERT OR IGNORE INTO tokens (token, address_id, type, member_email, expires_at, used)
VALUES ('devtoken_confirm', 'addr_testfamily', 'confirm', 'pending@example.com', 9999999999, 0);

-- Unsubscribe token (alice@example.com self-removes)
INSERT OR IGNORE INTO tokens (token, address_id, type, member_email, expires_at, used)
VALUES ('devtoken_unsub', 'addr_testfamily', 'unsubscribe', 'alice@example.com', 9999999999, 0);
