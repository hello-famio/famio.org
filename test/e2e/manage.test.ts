/**
 * E2E tests for the manage roster page (/manage?token=devtoken_magic).
 * Uses the seed address 'testfamily' with fixed devtoken_magic.
 */

import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

const MANAGE_URL = "/manage?token=devtoken_magic";
const RUN = Date.now().toString(36).slice(-5);

// Reset seed state — confirm-unsubscribe tests run first and mutate alice + pending
test.beforeAll(() => {
  execSync(
    "bunx wrangler d1 execute famio --remote --file=scripts/e2e-reset.sql",
    { stdio: "pipe" }
  );
});

test.beforeEach(async ({ page }) => {
  await page.goto(MANAGE_URL);
  await expect(page.locator("h1")).toBeVisible();
});

// ─── Page renders ─────────────────────────────────────────────────────────────

test("shows address name in heading", async ({ page }) => {
  await expect(page.locator("h1")).toContainText("testfamily@famio.org");
});

test("shows owner as confirmed member", async ({ page }) => {
  const ownerRow = page.locator(".member-row").filter({ hasText: "owner@example.com" });
  await expect(ownerRow.locator(".member-badge--confirmed")).toBeVisible();
});

test("shows alice as confirmed member", async ({ page }) => {
  const row = page.locator(".member-row").filter({ hasText: "alice@example.com" });
  await expect(row.locator(".member-badge--confirmed")).toBeVisible();
});

test("shows pending@example.com as pending", async ({ page }) => {
  const row = page.locator(".member-row").filter({ hasText: "pending@example.com" });
  await expect(row.locator(".member-badge--pending")).toBeVisible();
});

test("owner row shows 'Owner' label instead of remove button", async ({ page }) => {
  const ownerRow = page.locator(".member-row").filter({ hasText: "owner@example.com" });
  await expect(ownerRow.locator(".remove-btn")).toHaveCount(0);
  await expect(ownerRow).toContainText("Owner");
});

test("shows confirmed count badge", async ({ page }) => {
  await expect(page.locator(".card-title-count")).toContainText("of 6 confirmed");
});

// ─── Add member ───────────────────────────────────────────────────────────────

test("adds a new member and shows them in the list", async ({ page }) => {
  const email = `e2e-add-${RUN}@example.com`;
  await page.locator("#add-email").fill(email);
  await page.locator("#add-member-form button[type='submit']").click();

  // Page reloads after success
  await page.waitForURL(MANAGE_URL);
  await expect(page.locator(".member-row").filter({ hasText: email })).toBeVisible();
  await expect(
    page.locator(".member-row").filter({ hasText: email }).locator(".member-badge--pending")
  ).toBeVisible();
});

test("shows error flash when adding duplicate member", async ({ page }) => {
  // owner@example.com is already a member
  await page.locator("#add-email").fill("owner@example.com");
  await page.locator("#add-member-form button[type='submit']").click();

  await expect(page.locator("#flash")).toBeVisible();
  await expect(page.locator("#flash")).toContainText("already a member");
});

test("shows error flash for invalid email", async ({ page }) => {
  await page.locator("#add-email").fill("notanemail");
  await page.locator("#add-member-form button[type='submit']").click();

  await expect(page.locator("#flash")).toBeVisible();
  await expect(page.locator("#flash")).toContainText("valid email");
});

// ─── Remove member ────────────────────────────────────────────────────────────

test("removes a non-owner member after confirm dialog", async ({ page }) => {
  // Add a member to remove
  const email = `e2e-rm-${RUN}@example.com`;
  await page.locator("#add-email").fill(email);
  await page.locator("#add-member-form button[type='submit']").click();
  await page.waitForURL(MANAGE_URL);

  // Accept the browser confirm() dialog automatically
  page.on("dialog", (dialog) => dialog.accept());

  const row = page.locator(".member-row").filter({ hasText: email });
  await row.locator(".remove-btn").click();

  // Page reloads; row should be gone
  await page.waitForURL(MANAGE_URL);
  await expect(page.locator(".member-row").filter({ hasText: email })).toHaveCount(0);
});

// ─── Resend magic link ────────────────────────────────────────────────────────

test("resend link button shows success flash", async ({ page }) => {
  await page.locator("#resend-link-btn").click();
  await expect(page.locator("#flash")).toBeVisible();
  await expect(page.locator("#flash")).toContainText("sent");
});

// ─── Delete address ───────────────────────────────────────────────────────────

test("delete address button opens confirm dialog", async ({ page }) => {
  await page.locator("#delete-address-btn").click();
  await expect(page.locator("#delete-dialog")).toBeVisible();
  await expect(page.locator("#delete-dialog")).toContainText("This cannot be undone");
});

test("cancel closes the dialog without deleting", async ({ page }) => {
  await page.locator("#delete-address-btn").click();
  await expect(page.locator("#delete-dialog")).toBeVisible();
  await page.locator("#delete-cancel-btn").click();
  await expect(page.locator("#delete-dialog")).not.toBeVisible();
  // Address still exists
  await expect(page.locator("h1")).toContainText("testfamily@famio.org");
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

test("bad token shows 401 error page", async ({ page }) => {
  await page.goto("/manage?token=invalid");
  await expect(page.locator(".status-badge")).toContainText("401");
  await expect(page.locator(".status-title")).toContainText("Link expired");
});

test("no token shows 401 error page", async ({ page }) => {
  await page.goto("/manage");
  await expect(page.locator(".status-badge")).toContainText("401");
});
