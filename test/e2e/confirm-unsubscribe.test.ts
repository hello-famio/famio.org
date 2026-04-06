/**
 * E2E tests for the confirm opt-in and unsubscribe flows.
 *
 * These tests consume devtoken_confirm and devtoken_unsub exactly once each.
 * globalSetup resets them before every run so the suite is re-runnable.
 */

import { test, expect } from "@playwright/test";

// ─── Confirm flow ─────────────────────────────────────────────────────────────

test("confirm page shows success after clicking a valid token", async ({ page }) => {
  await page.goto("/confirm?token=devtoken_confirm");

  await expect(page.locator(".status-title")).toContainText("confirmed");
  await expect(page.locator(".status-body")).toContainText("pending@example.com");
  await expect(page.locator(".status-body")).toContainText("testfamily@famio.org");
});

test("confirmed member now appears as confirmed on manage page", async ({ page }) => {
  // Confirm first (devtoken was reset by globalSetup, so this is idempotent per run
  // — if previous test already confirmed it, member is confirmed; the page reflects that)
  await page.goto("/confirm?token=devtoken_confirm");

  await page.goto("/manage?token=devtoken_magic");
  const row = page.locator(".member-row").filter({ hasText: "pending@example.com" });
  // After confirmation the badge should be confirmed (or the member may not exist if
  // a previous run removed them — the seed reset in globalSetup re-adds them as pending,
  // so after our confirm test above they'll be confirmed)
  await expect(row.locator(".member-badge--confirmed")).toBeVisible();
});

test("confirm page shows failure for an already-used token", async ({ page }) => {
  // devtoken_confirm was just consumed by the test above — using it again should fail
  await page.goto("/confirm?token=devtoken_confirm");
  await expect(page.locator(".status-title")).toContainText("failed");
  await expect(page.locator(".status-body")).toContainText("already been used");
});

test("confirm page shows failure for a bad token", async ({ page }) => {
  await page.goto("/confirm?token=notavalidtoken");
  await expect(page.locator(".status-title")).toContainText("failed");
  await expect(page.locator(".status-body")).toContainText("Invalid");
});

// ─── Unsubscribe flow ─────────────────────────────────────────────────────────

test("unsubscribe page renders with member email and family name", async ({ page }) => {
  await page.goto("/unsubscribe?token=devtoken_unsub");

  await expect(page.locator(".status-title")).toContainText("Leave testfamily");
  await expect(page.locator(".status-body")).toContainText("alice@example.com");
  await expect(page.locator(".status-body")).toContainText("testfamily@famio.org");
});

test("unsubscribe removes the member and shows success page", async ({ page }) => {
  await page.goto("/unsubscribe?token=devtoken_unsub");

  await page.locator("button[type='submit'].btn-danger").click();

  await expect(page.locator(".status-title")).toContainText("removed");
  await expect(page.locator(".status-body")).toContainText("alice@example.com");
  await expect(page.locator(".status-body")).toContainText("testfamily@famio.org");
});

test("alice no longer appears on manage page after unsubscribing", async ({ page }) => {
  // Unsubscribe happened in the previous test (token consumed)
  await page.goto("/manage?token=devtoken_magic");
  await expect(page.locator(".member-row").filter({ hasText: "alice@example.com" })).toHaveCount(0);
});

test("used unsubscribe token returns 401", async ({ page }) => {
  // devtoken_unsub was consumed above
  await page.goto("/unsubscribe?token=devtoken_unsub");
  await expect(page.locator(".status-badge")).toContainText("401");
});

test("invalid unsubscribe token returns 401", async ({ page }) => {
  await page.goto("/unsubscribe?token=badtoken");
  await expect(page.locator(".status-badge")).toContainText("401");
});
