# Famio

Family email broadcast service. One address (e.g. `smiths@famio.org`) forwards to up to 6 confirmed family members.

## How it works

1. Owner creates a family address and invites members.
2. Each member clicks a confirmation link to opt in.
3. Any email sent to `smiths@famio.org` is forwarded to all confirmed members.
4. Owner manages the roster via a magic link (no password).

## Project structure

```
famio.org/
├── index.html          Landing page (GitHub Pages)
├── src/
│   ├── index.ts        Worker router + all route handlers
│   ├── templates.ts    Server-rendered HTML pages
│   ├── services/
│   │   ├── email.ts    Email service interface + stub
│   │   └── purelymail.ts  PurelyMail routing interface + stub
│   └── db/
│       ├── schema.sql  D1 table definitions
│       └── seed.sql    Local dev test data
├── test/               Vitest tests (add here)
├── wrangler.toml       Cloudflare Worker config
├── vitest.config.ts    Test runner config
└── TODOS.md            Deferred implementation items
```

## Prerequisites

- [Bun](https://bun.sh) `1.3+`
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed via bun — no global install needed)
- **macOS 13.5+ or Linux** for `wrangler dev` local mode (Workers runtime requirement)
- A Cloudflare account with Workers and D1 enabled

> **macOS 12 users:** The local Workers runtime requires macOS 13.5+. Use `bun run dev:remote` instead — it runs your code in Cloudflare's infrastructure while serving locally. You'll need a Cloudflare account and a D1 database created first (see [Remote dev workflow](#remote-dev-workflow-macos-12)).

## Quick start (macOS 13.5+ / Linux)

```bash
# 1. Install dependencies
bun install

# 2. Copy environment config
cp .dev.vars.example .dev.vars

# 3. Set up local database
bun run db:setup

# 4. Start the Worker locally
bun run dev
```

The Worker is now running at **http://localhost:8787**.

## Remote dev workflow (macOS 12)

You need a Cloudflare account. Run once to authenticate and create the D1 database:

```bash
# Authenticate with Cloudflare (one-time)
bunx wrangler login

# Create the database and copy the ID into wrangler.toml [[d1_databases]] database_id
bunx wrangler d1 create famio

# Apply schema and seed data to the remote database
bun run db:setup:remote

# Run the Worker (code executes in Cloudflare, served via localhost tunnel)
bun run dev:remote
```

The Worker is now running at **http://localhost:8787** (proxied through Cloudflare).

> Note: `dev:remote` uses your real D1 database. Run `bun run db:seed:remote` once to load the dev tokens. Don't use the seed data in production — run `bun run db:reset:remote` to wipe it before going live.

## Local dev URLs

The seed data creates a `testfamily@famio.org` address with fixed tokens. Use these to manually test every flow without sending real emails.

| Page | URL |
|------|-----|
| Manage roster (owner) | http://localhost:8787/manage?token=devtoken_magic |
| Confirm opt-in (pending member) | http://localhost:8787/confirm?token=devtoken_confirm |
| Unsubscribe (confirmed member) | http://localhost:8787/unsubscribe?token=devtoken_unsub |

When the Worker handles requests that would send email, it prints the links to the terminal instead:

```
[EMAIL] Magic link → owner@example.com
  Address : testfamily@famio.org
  Link    : http://localhost:8787/manage?token=<token>

[EMAIL] Confirmation → pending@example.com
  Address : testfamily@famio.org
  Link    : http://localhost:8787/confirm?token=<token>

[PURELYMAIL] Create route
  Address : testfamily@famio.org
  Members : (none yet)
```

Click the links in your terminal to navigate to them.

## API routes

All mutation endpoints authenticate via `Authorization: Bearer <token>` header. GET pages use `?token=` query param.

### `POST /signup`

Create a new family address.

```bash
curl -X POST http://localhost:8787/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "smiths",
    "owner_email": "dad@example.com",
    "members": ["mum@example.com", "teen@example.com"]
  }'
```

**Response `201`:**
```json
{ "ok": true, "address": "smiths@famio.org" }
```

Check the terminal for the magic link and confirmation links.

**Errors:**
- `400` — invalid name (reserved, wrong format, >30 chars)
- `409` — name already taken, or owner already has an address

### `GET /manage?token=`

Roster management page (HTML). Use the magic link from your email or from the terminal during local dev.

```bash
open "http://localhost:8787/manage?token=devtoken_magic"
```

### `POST /manage/members`

Add a member to the roster. They'll receive a confirmation email (printed to terminal locally).

```bash
curl -X POST http://localhost:8787/manage/members \
  -H "Authorization: Bearer devtoken_magic" \
  -H "Content-Type: application/json" \
  -d '{"email": "grandma@example.com"}'
```

**Response `200`:** `{ "ok": true }`

**Errors:**
- `400` — invalid email, or already at 6-member limit
- `401` — bad/expired token
- `409` — already a member

### `DELETE /manage/members/:email`

Remove a member. Owner cannot remove themselves.

```bash
curl -X DELETE \
  "http://localhost:8787/manage/members/grandma%40example.com" \
  -H "Authorization: Bearer devtoken_magic"
```

**Response `200`:** `{ "ok": true }`

### `POST /manage/magic-link`

Send a new manage link to the owner's email (prints to terminal locally).

```bash
curl -X POST http://localhost:8787/manage/magic-link \
  -H "Authorization: Bearer devtoken_magic"
```

**Response `200`:** `{ "ok": true }`

### `GET /confirm?token=`

Member opts in. Marks them as confirmed in D1 and adds them to the PurelyMail route.

```bash
open "http://localhost:8787/confirm?token=devtoken_confirm"
```

### `GET /unsubscribe?token=`

Shows the unsubscribe confirmation page.

```bash
open "http://localhost:8787/unsubscribe?token=devtoken_unsub"
```

### `POST /unsubscribe?token=`

Removes the member. The unsubscribe page submits this form automatically.

## Database scripts

```bash
# Apply schema to local D1
bun run db:migrate

# Load seed data (fixed dev tokens)
bun run db:seed

# Both at once (first-time setup)
bun run db:setup

# Wipe and start fresh
bun run db:reset

# Inspect local tables
bun run db:dump

# Run an arbitrary query
bun run db:query -- "SELECT * FROM members WHERE confirmed = 1"
```

## Resetting seed tokens

If you use a seed token (e.g. `devtoken_confirm`) and it gets marked as `used`, reset it:

```bash
bun run db:query -- "UPDATE tokens SET used = 0 WHERE token LIKE 'devtoken_%'"
```

Or run `bun run db:reset` to wipe and re-seed completely.

## Testing

```bash
bun test          # run once
bun run test:watch  # watch mode
```

Test files go in `test/`. The framework is Vitest + `@cloudflare/vitest-pool-workers` — tests run inside a real Workers runtime, so D1 bindings work without mocking.

See the [test plan](~/.gstack/projects/hello-famio-famio.org/bevan-main-eng-review-test-plan-20260330-165302.md) for the full list of 32 paths to cover.

## Deployment

### First deploy

```bash
# 1. Create a D1 database in Cloudflare
wrangler d1 create famio
# Copy the database_id from the output into wrangler.toml

# 2. Apply schema to production
wrangler d1 execute famio --file=src/db/schema.sql

# 3. Set secrets
wrangler secret put PURELYMAIL_API_KEY
wrangler secret put PURELYMAIL_ACCOUNT_TOKEN

# 4. Deploy
bun run deploy
```

### Subsequent deploys

```bash
bun run deploy
```

### GitHub Pages (landing page)

The `index.html` landing page deploys automatically on push to `main` via the `CNAME` file. Cloudflare routes `/signup`, `/manage`, `/confirm`, and `/unsubscribe` to the Worker; everything else falls through to GitHub Pages.

## Open items (TODOS.md)

1. **V1.5 MIME reconstruction** — `postal-mime` parses but doesn't reassemble multipart emails. Need a MIME builder for footer injection.
2. **V1.5 Reply-To decision** — Should replies go back to the sender or to the group address?
3. **V1 pre-launch gate** — Manually verify PurelyMail delivers to Outlook and iCloud before going live. See `TODOS.md` for repro steps.

## What's stubbed

Both service interfaces have stub implementations that log to the terminal:

| Service | File | Replaces |
|---------|------|---------|
| Email (magic links, confirmations) | `src/services/email.ts` | PurelyMail SMTP / Resend API |
| Mail routing (forwarding rules) | `src/services/purelymail.ts` | PurelyMail REST API |

When V1.5 starts, create real implementations of `EmailService` and `MailRoutingService` and swap them in `src/index.ts` where `stubEmailService()` and `stubMailRoutingService()` are called.
