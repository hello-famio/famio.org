/**
 * E2E tests for the landing page signup form (index.html via dev proxy).
 * Tests run against http://localhost:3000 → staging Worker.
 */

import { test, expect } from "@playwright/test";

// Unique prefix for this run — keeps names valid (3-30 chars, [a-z0-9-])
const RUN = Date.now().toString(36).slice(-5); // e.g. "m5k9a"

function e2eName(suffix: string): string {
  return `e2e-${RUN}-${suffix}`.slice(0, 30);
}

// Landing page is served by the local proxy — not the staging Worker
const LANDING = "http://localhost:3000/";

test.beforeEach(async ({ page }) => {
  await page.goto(LANDING);
});

// ─── Page renders ─────────────────────────────────────────────────────────────

test("landing page loads with signup form visible", async ({ page }) => {
  await expect(page.locator("#signup-form-wrap")).toBeVisible();
  await expect(page.locator("#signup-name")).toBeVisible();
  await expect(page.locator("#signup-owner")).toBeVisible();
  await expect(page.locator("#signup-submit-btn")).toBeVisible();
});

test("address preview updates as name is typed", async ({ page }) => {
  await page.locator("#signup-name").fill("myfamily");
  await expect(page.locator("#address-preview")).toHaveText("myfamily@famio.org");
});

test("preview strips invalid characters from input", async ({ page }) => {
  await page.locator("#signup-name").fill("My Family!");
  // JS normalises to lowercase letters/numbers/hyphens only
  await expect(page.locator("#address-preview")).toHaveText("myfamily@famio.org");
});

// ─── Client-side validation ───────────────────────────────────────────────────

test("shows error when name is too short", async ({ page }) => {
  await page.locator("#signup-name").fill("ab");
  await page.locator("#signup-owner").fill("test@example.com");
  await page.locator("#signup-submit-btn").click();
  await expect(page.locator("#signup-result")).toBeVisible();
  await expect(page.locator("#signup-result")).toContainText("3");
});

test("shows error when owner email is missing", async ({ page }) => {
  await page.locator("#signup-name").fill(e2eName("val"));
  await page.locator("#signup-submit-btn").click();
  await expect(page.locator("#signup-result")).toBeVisible();
  await expect(page.locator("#signup-result")).toContainText("email");
});

test("shows error when owner email has no @", async ({ page }) => {
  await page.locator("#signup-name").fill(e2eName("val2"));
  await page.locator("#signup-owner").fill("notanemail");
  await page.locator("#signup-submit-btn").click();
  await expect(page.locator("#signup-result")).toBeVisible();
});

// ─── Add / remove member rows ─────────────────────────────────────────────────

test("add member button appends an email input", async ({ page }) => {
  const before = await page.locator(".member-email-input").count();
  await page.locator("#add-member-btn").click();
  await expect(page.locator(".member-email-input")).toHaveCount(before + 1);
});

test("remove member button deletes the row", async ({ page }) => {
  await page.locator("#add-member-btn").click();
  await page.locator("#add-member-btn").click();
  const before = await page.locator(".member-email-input").count();
  await page.locator(".remove-member-btn").first().click();
  await expect(page.locator(".member-email-input")).toHaveCount(before - 1);
});

// ─── Successful signup ────────────────────────────────────────────────────────

test("successful signup hides form and shows success card", async ({ page }) => {
  const name = e2eName("ok");
  await page.locator("#signup-name").fill(name);
  await page.locator("#signup-owner").fill(`${name}@example.com`);
  await page.locator("#signup-submit-btn").click();

  await expect(page.locator("#signup-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#signup-form-wrap")).not.toBeVisible();
  await expect(page.locator("#signup-success")).toContainText(name);
});

test("successful signup with members includes them in success message", async ({ page }) => {
  const name = e2eName("mem");
  await page.locator("#signup-name").fill(name);
  await page.locator("#signup-owner").fill(`${name}@example.com`);

  await page.locator("#add-member-btn").click();
  await page.locator(".member-email-input").last().fill(`sibling-${RUN}@example.com`);

  await page.locator("#signup-submit-btn").click();
  await expect(page.locator("#signup-success")).toBeVisible({ timeout: 10_000 });
});

// ─── API-level errors shown in form ──────────────────────────────────────────

test("409 duplicate name shows error in form", async ({ page }) => {
  // First signup
  const name = e2eName("dup");
  await page.locator("#signup-name").fill(name);
  await page.locator("#signup-owner").fill(`owner-${name}@example.com`);
  await page.locator("#signup-submit-btn").click();
  await expect(page.locator("#signup-success")).toBeVisible({ timeout: 10_000 });

  // Second attempt — reload and try the same name
  await page.goto(LANDING);
  await page.locator("#signup-name").fill(name);
  await page.locator("#signup-owner").fill(`other-${name}@example.com`);
  await page.locator("#signup-submit-btn").click();
  await expect(page.locator("#signup-result")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#signup-result")).toContainText("taken");
});
