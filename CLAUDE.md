# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Famio.org is a static HTML landing page for Famio — a family email forwarding service. It is hosted on GitHub Pages at `famio.org` (configured via `CNAME`).

There is no build process, package manager, or framework. The entire site is a single file: `index.html`.

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
