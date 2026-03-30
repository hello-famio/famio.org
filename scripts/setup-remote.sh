#!/usr/bin/env bash
# scripts/setup-remote.sh
# One-command remote dev setup: create D1 database, update wrangler.toml, migrate, seed.
# Usage: bun run setup:remote

set -euo pipefail

WRANGLER="bunx wrangler"
TOML="wrangler.toml"
PLACEHOLDER="00000000-0000-0000-0000-000000000000"
DB_NAME="famio"

# ── 1. Check if already configured ───────────────────────────────────────────

CURRENT_ID=$(grep 'database_id' "$TOML" | grep -oE '[0-9a-f-]{36}' | head -1)

if [ "$CURRENT_ID" != "$PLACEHOLDER" ]; then
  echo "✓ Database already configured in wrangler.toml ($CURRENT_ID)"
  echo "  Applying schema + seed data..."
  bun run db:setup:remote
  echo ""
  echo "Ready. Start with: bun run dev:remote"
  exit 0
fi

# ── 2. Check wrangler auth ────────────────────────────────────────────────────

echo "Checking Cloudflare auth..."
if ! $WRANGLER whoami &>/dev/null; then
  echo ""
  echo "Not logged in. Run this first:"
  echo "  bunx wrangler login"
  exit 1
fi

# ── 3. Create D1 database ─────────────────────────────────────────────────────

echo "Creating D1 database '$DB_NAME'..."
CREATE_OUTPUT=$($WRANGLER d1 create "$DB_NAME" 2>&1) || true

UUID=$(echo "$CREATE_OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

# ── 4. If create failed (already exists), get ID from list ───────────────────

if [ -z "$UUID" ]; then
  echo "  Database may already exist — checking list..."
  LIST_OUTPUT=$($WRANGLER d1 list 2>&1)
  UUID=$(echo "$LIST_OUTPUT" | grep "$DB_NAME" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
fi

if [ -z "$UUID" ]; then
  echo ""
  echo "Error: Could not get database_id from Cloudflare."
  echo "Run manually: bunx wrangler d1 create $DB_NAME"
  echo "Then update database_id in wrangler.toml and run: bun run db:setup:remote"
  exit 1
fi

echo "✓ Got database_id: $UUID"

# ── 5. Update wrangler.toml ───────────────────────────────────────────────────

# macOS sed requires '' after -i; Linux sed does not. Handle both.
if sed --version &>/dev/null 2>&1; then
  # GNU sed (Linux)
  sed -i "s/$PLACEHOLDER/$UUID/" "$TOML"
else
  # BSD sed (macOS)
  sed -i '' "s/$PLACEHOLDER/$UUID/" "$TOML"
fi

echo "✓ Updated wrangler.toml"

# ── 6. Apply schema and seed data ─────────────────────────────────────────────

echo "Applying schema..."
bun run db:migrate:remote

echo "Seeding dev data..."
bun run db:seed:remote

# ── 7. Done ───────────────────────────────────────────────────────────────────

echo ""
echo "All done! Your dev URLs (fixed tokens):"
echo "  Manage page : http://localhost:8787/manage?token=devtoken_magic"
echo "  Confirm     : http://localhost:8787/confirm?token=devtoken_confirm"
echo "  Unsubscribe : http://localhost:8787/unsubscribe?token=devtoken_unsub"
echo ""
echo "Start the Worker:"
echo "  bun run dev:remote"
