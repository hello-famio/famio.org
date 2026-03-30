# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Famio.org is a static HTML landing page for Famio — a family email forwarding service. It is hosted on GitHub Pages at `famio.org` (configured via `CNAME`).

The static landing page (`index.html`) has no build process. The Worker backend lives in `src/` and uses `wrangler` + `bun`.

## Development

Open `index.html` directly in a browser to preview. No build or install step needed.

To deploy: push to the `main` branch. GitHub Pages publishes automatically.

## Architecture

Everything lives in `index.html`:
- **CSS** — embedded in `<style>` tag, ~425 lines. Responsive with a single breakpoint at `768px`.
- **JavaScript** — inline `<script>` tag, ~20 lines. Handles Mailchimp form submission via hidden iframe and shows a thank-you message.
- **Mailchimp integration** — form POSTs to `https://famio.us18.list-manage.com/subscribe/post` with hidden iframe to avoid page reload.

**Sections in order:** Header → Hero → Features (3 cards) → How It Works (3 steps with email visualization) → CTA with signup form → Footer.

**Design system:** Pink (`#ff6b9d`), Teal (`#4ecdc4`), Yellow (`#ffe66d`). System font stack. Box-shadows for depth. CSS Grid with `auto-fit` columns for responsive layouts.

## Worker Backend

The V1 backend is a Cloudflare Worker in `src/index.ts`. Deps managed with `bun`.

- `bun install` — install dependencies
- `bun run dev` — local dev via `wrangler dev`
- `bun run deploy` — deploy to Cloudflare Workers
- `wrangler d1 execute famio --file=src/db/schema.sql` — apply D1 schema

Before deploying: set secrets via `wrangler secret put PURELYMAIL_API_KEY` and `wrangler secret put PURELYMAIL_ACCOUNT_TOKEN`. Replace the `database_id` placeholder in `wrangler.toml` after running `wrangler d1 create famio`.

## Testing

- Framework: Vitest + @cloudflare/vitest-pool-workers
- Run: `bun test`
- Test files: `test/**/*.test.ts`
- 100% test coverage is the goal. When writing new routes, write corresponding tests. When fixing a bug, write a regression test. Never commit code that makes existing tests fail.
