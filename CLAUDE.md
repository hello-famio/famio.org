# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Famio is a family email forwarding service. One `name@famio.org` address fans out to up to 6 confirmed members. Members opt in via a confirmation email before receiving any forwarded mail.

The repo contains:
- **`index.html`** — static landing page, hosted on GitHub Pages at `famio.org`
- **`src/`** — Cloudflare Worker (HTTP API, D1 database, email + routing integrations)
- **`smtp/`** — SMTP proxy running on a GCP VM (accepts authenticated SMTP, forwards to Worker)
- **`infra/`** — Terraform config for GCP VM and firewall rules

## Architecture

```
Gmail/Outlook (send as name@famio.org)
  │  smtp.famio.org:587
  ▼
GCP VM — stunnel (TLS) → Docker container (plain SMTP :2525)
  │  POST /internal/smtp-send
  ▼
Cloudflare Worker (src/index.ts)
  │  D1 — credential validation, roster lookup
  │  Resend API — outbound delivery with footer injection
  ▼
Family members' inboxes
```

Inbound forwarding (emails sent *to* `name@famio.org`) is handled by PurelyMail routing rules, which the Worker manages via REST API.

## Landing Page

`index.html` has no build process. Open directly in a browser to preview.

**Design system:** Pink (`#ff6b9d`), Teal (`#4ecdc4`), Yellow (`#ffe66d`). System font stack. CSS Grid with `auto-fit` for responsive layouts.

**Sections:** Header → Hero → Features → How It Works → CTA/signup form → FAQ → Footer.

The signup form POSTs to the Worker `POST /signup` and shows a success card on 201.

## Worker (`src/`)

- `bun install` — install dependencies
- `bun run dev` — local dev via `wrangler dev`
- `bun run deploy` — deploy to production (`wrangler deploy --env ''`)
- `bun run deploy:staging` — deploy to staging Worker (`famio-worker-staging`)
- `bun run logs:staging` — tail staging Worker logs

**Routes:**
- `POST /signup` — create family address (owner auto-confirmed, members get confirmation email)
- `GET /manage` — HTML roster page (magic link auth)
- `POST /manage/members` — add member
- `DELETE /manage/members/:email` — remove member
- `POST /manage/magic-link` — resend magic link
- `POST /manage/smtp-password` — regenerate SMTP password
- `DELETE /manage/address` — delete address and cascade
- `GET /confirm` — member opt-in
- `GET|POST /unsubscribe` — member self-removal
- `POST /internal/smtp-send` — relay secret protected, called by SMTP proxy
- `GET /internal/stats` — relay secret protected, returns address/member counts

**D1 schema** (`src/db/schema.sql`): 4 tables — `addresses`, `members`, `tokens`, `bounces`.

**Secrets** (set via `wrangler secret put`):
- `PURELYMAIL_API_KEY` — inbound routing via PurelyMail
- `RESEND_API_KEY` — outbound email delivery
- `SMTP_RELAY_SECRET` — shared secret between SMTP proxy and Worker

**Email footer:** Free tier outbound emails include `"Sent via name@famio.org · Get your own family address at famio.org"`. Skipped for `no_footer` tier.

## SMTP Proxy (`smtp/`)

Thin Node.js SMTP server. Accepts authenticated connections on port 2525 (stunnel handles TLS on 587). On DATA, POSTs the raw message + credentials to `POST /internal/smtp-send` on the Worker.

- `bun install` — install dependencies
- `bun run test` — run proxy unit tests
- `bun scripts/canary.ts --host smtp.famio.org --port 587 --user ... --pass ... --to ...` — manual health check

Docker image published to `ghcr.io/hello-famio/famio.org/famio-smtp:latest` on every push to main.

## Infrastructure (`infra/`)

Terraform manages a GCP `e2-micro` VM. The VM runs:
- **stunnel** — terminates TLS on port 587, forwards plain SMTP to Docker container on `127.0.0.1:2525`
- **famio-smtp** (systemd service) — pulls and runs the Docker container

After provisioning a new VM, SSH in and run `certbot certonly --standalone -d smtp.famio.org`, then `systemctl start stunnel4 famio-smtp`.

## Testing

- `bun run test:unit` — unit tests (Vitest, node env) — runs in CI on every push
- `bun run test:staging` — integration tests against `famio-worker-staging.bevn.workers.dev` — run manually
- `bun run test` — Workers pool tests (requires macOS 13.5+)

**Test files:**
- `test/unit/` — pure logic tests (footer injection etc.)
- `test/integration/staging.test.ts` — full API integration tests against staging
- `test/integration/smtp-send.test.ts` — SMTP send flow against staging
- `smtp/test/` — SMTP proxy unit tests

**Rules:** 100% test coverage is the goal. New routes need tests. Bug fixes need regression tests. Never commit code that makes existing tests fail.

**Staging DB:** `beforeAll` in staging tests resets `testfamily` to clean seed state by deleting and re-seeding from `src/db/seed.sql`. Fixed devtokens (`devtoken_magic`, `devtoken_confirm`, `devtoken_unsub`) are used for flows that require pre-existing tokens.

## CI/CD

- **CI** (`.github/workflows/ci.yml`) — runs on PR and push to main: unit tests, SMTP proxy tests, Terraform plan (PR only)
- **Deploy** (`.github/workflows/deploy.yml`) — runs on push to main: deploys Worker, builds and pushes Docker image, redeploys GCP VM, runs Terraform apply
- **Canary** (`.github/workflows/canary.yml`) — runs hourly: sends test email via SMTP relay and fetches D1 stats, alerts on failure

## Administration

No admin UI. Query production D1 directly:

```bash
# List all active addresses
bunx wrangler d1 execute famio --remote --command "SELECT name, owner_email, tier, created_at FROM addresses WHERE active = 1 ORDER BY created_at DESC"

# Delete an address and cascade
bunx wrangler d1 execute famio --remote --command "DELETE FROM tokens WHERE address_id = (SELECT id FROM addresses WHERE name = 'NAME'); DELETE FROM members WHERE address_id = (SELECT id FROM addresses WHERE name = 'NAME'); DELETE FROM addresses WHERE name = 'NAME'"
```

### Resending a magic link

Use `scripts/resend-magic-link.sh` to recover manage access for an address owner. It reuses any existing valid token, or expires old ones and mints a fresh one.

```bash
# Show the manage URL (no email sent)
./scripts/resend-magic-link.sh <familyname>

# Show the manage URL and email it to the owner
./scripts/resend-magic-link.sh <familyname> --send
```

The script also prints address info, members, and recent tokens for debugging.
