-- Resets seed data to a clean state before each E2E test run.
-- Safe to run multiple times.

-- Purge any non-seed members/tokens on testfamily left by previous E2E runs
DELETE FROM members WHERE address_id = 'addr_testfamily' AND id NOT IN ('mem_owner', 'mem_alice', 'mem_pending');
DELETE FROM tokens  WHERE address_id = 'addr_testfamily' AND token NOT LIKE 'devtoken_%';

-- Ensure the seed address exists
INSERT OR IGNORE INTO addresses (id, name, owner_email, tier, created_at, active)
VALUES ('addr_testfamily', 'testfamily', 'owner@example.com', 'free', 1748000000, 1);

-- Restore seed members (owner confirmed, alice confirmed, pending unconfirmed)
INSERT OR IGNORE INTO members (id, address_id, email, confirmed, confirmed_at, added_at)
VALUES ('mem_owner', 'addr_testfamily', 'owner@example.com', 1, 1748000100, 1748000000);

INSERT OR REPLACE INTO members (id, address_id, email, confirmed, confirmed_at, added_at)
VALUES ('mem_alice', 'addr_testfamily', 'alice@example.com', 1, 1748000200, 1748000000);

INSERT OR REPLACE INTO members (id, address_id, email, confirmed, confirmed_at, added_at)
VALUES ('mem_pending', 'addr_testfamily', 'pending@example.com', 0, NULL, 1748000000);

-- Reset devtokens (un-use them and ensure they exist)
INSERT OR REPLACE INTO tokens (token, address_id, type, member_email, expires_at, used)
VALUES ('devtoken_magic', 'addr_testfamily', 'magic_link', NULL, 9999999999, 0);

INSERT OR REPLACE INTO tokens (token, address_id, type, member_email, expires_at, used)
VALUES ('devtoken_confirm', 'addr_testfamily', 'confirm', 'pending@example.com', 9999999999, 0);

INSERT OR REPLACE INTO tokens (token, address_id, type, member_email, expires_at, used)
VALUES ('devtoken_unsub', 'addr_testfamily', 'unsubscribe', 'alice@example.com', 9999999999, 0);
