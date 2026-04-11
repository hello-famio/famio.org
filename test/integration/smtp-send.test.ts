/**
 * Integration tests for POST /internal/smtp-send
 *
 * Run against staging with: bun run test:staging
 *
 * Creates fresh family addresses for tests that need valid credentials,
 * so this suite is safe to run repeatedly without cleanup.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "https://famio-worker-staging.bevn.workers.dev";
const RUN = Date.now().toString(36);
const RELAY_SECRET = process.env.SMTP_RELAY_SECRET ?? "dev-secret";

function uid(prefix: string): string {
  return `${prefix}-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

// Creates a fresh address and returns credentials
async function createAddressWithCredentials(): Promise<{
  name: string;
  smtpPassword: string;
  magicToken: string;
}> {
  const name = uid("smtp");
  const ownerEmail = `${name}@example.com`;
  const r = await api("POST", "/signup", {
    body: { name, owner_email: ownerEmail },
  });
  expect(r.status).toBe(201);
  const body = await r.json() as { smtp_password: string };

  // Fetch magic token from D1
  const row = execSync(
    `bunx wrangler d1 execute famio-staging --remote --command "SELECT token FROM tokens WHERE address_id = (SELECT id FROM addresses WHERE name = '${name}') AND type = 'magic_link' LIMIT 1" --json`,
    { stdio: "pipe" }
  ).toString();
  const magicToken = JSON.parse(row)[0].results[0].token as string;

  return { name, smtpPassword: body.smtp_password, magicToken };
}

function rawMessageB64(subject = "Test"): string {
  const raw = [
    `Date: Fri, 11 Apr 2026 10:00:00 +0000`,
    `From: smiths@famio.org`,
    `To: recipient@example.com`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Hello family, this is a test email.`,
  ].join("\r\n");
  return btoa(raw);
}

function rawMessageFromFixture(filename: string): string {
  const content = readFileSync(join(__dirname, "../fixtures/emails", filename));
  return content.toString("base64");
}

// ─── Secret validation ────────────────────────────────────────────────────────

describe("POST /internal/smtp-send — secret validation", () => {
  it("403 when X-Relay-Secret header is missing", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      body: { username: "smiths@famio.org", password: "pw", raw_message_b64: rawMessageB64(), envelope_to: ["r@example.com"] },
    });
    expect(r.status).toBe(403);
  });

  it("403 when X-Relay-Secret is wrong", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": "wrong-secret" },
      body: { username: "smiths@famio.org", password: "pw", raw_message_b64: rawMessageB64(), envelope_to: ["r@example.com"] },
    });
    expect(r.status).toBe(403);
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe("POST /internal/smtp-send — input validation", () => {
  it("400 when body is not JSON", async () => {
    const r = await fetch(`${BASE}/internal/smtp-send`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Relay-Secret": RELAY_SECRET },
      body: "not json",
    });
    expect(r.status).toBe(400);
  });

  it("400 when required fields are missing", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: { username: "smiths@famio.org" }, // missing password, raw_message_b64, envelope_to
    });
    expect(r.status).toBe(400);
  });

  it("400 when envelope_to is empty array", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: { username: "smiths@famio.org", password: "pw", raw_message_b64: rawMessageB64(), envelope_to: [] },
    });
    expect(r.status).toBe(400);
  });
});

// ─── Credential validation ────────────────────────────────────────────────────

describe("POST /internal/smtp-send — credential validation", () => {
  it("401 when family address does not exist", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: {
        username: "doesnotexist@famio.org",
        password: "anypassword",
        raw_message_b64: rawMessageB64(),
        envelope_to: ["r@example.com"],
      },
    });
    expect(r.status).toBe(401);
  });

  it("401 when password is wrong", async () => {
    const { name } = await createAddressWithCredentials();
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: {
        username: `${name}@famio.org`,
        password: "definitely-wrong-password",
        raw_message_b64: rawMessageB64(),
        envelope_to: ["r@example.com"],
      },
    });
    expect(r.status).toBe(401);
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("POST /internal/smtp-send — happy path", () => {
  let creds: Awaited<ReturnType<typeof createAddressWithCredentials>>;

  beforeAll(async () => {
    creds = await createAddressWithCredentials();
  });

  it("200 with valid credentials and text email", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: {
        username: `${creds.name}@famio.org`,
        password: creds.smtpPassword,
        raw_message_b64: rawMessageFromFixture("text-only.eml"),
        envelope_from: `${creds.name}@famio.org`,
        envelope_to: ["recipient@example.com"],
      },
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("200 with multipart email", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: {
        username: `${creds.name}@famio.org`,
        password: creds.smtpPassword,
        raw_message_b64: rawMessageFromFixture("multipart.eml"),
        envelope_from: `${creds.name}@famio.org`,
        envelope_to: ["recipient@example.com"],
      },
    });
    expect(r.status).toBe(200);
  });

  it("200 with email containing an attachment", async () => {
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: {
        username: `${creds.name}@famio.org`,
        password: creds.smtpPassword,
        raw_message_b64: rawMessageFromFixture("with-attachment.eml"),
        envelope_from: `${creds.name}@famio.org`,
        envelope_to: ["recipient@example.com"],
      },
    });
    expect(r.status).toBe(200);
  });
});

// ─── POST /manage/smtp-password ───────────────────────────────────────────────

describe("POST /manage/smtp-password", () => {
  it("200 returns new plaintext password", async () => {
    const { magicToken } = await createAddressWithCredentials();
    const r = await api("POST", "/manage/smtp-password", { token: magicToken });
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; smtp_password: string };
    expect(body.ok).toBe(true);
    expect(typeof body.smtp_password).toBe("string");
    expect(body.smtp_password.length).toBeGreaterThan(0);
  });

  it("old password is rejected after regeneration", async () => {
    const { name, smtpPassword, magicToken } = await createAddressWithCredentials();

    // Regenerate
    await api("POST", "/manage/smtp-password", { token: magicToken });

    // Old password should now fail
    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: {
        username: `${name}@famio.org`,
        password: smtpPassword,
        raw_message_b64: rawMessageB64(),
        envelope_to: ["r@example.com"],
      },
    });
    expect(r.status).toBe(401);
  });

  it("new password works after regeneration", async () => {
    const { name, magicToken } = await createAddressWithCredentials();

    const regenR = await api("POST", "/manage/smtp-password", { token: magicToken });
    const { smtp_password: newPw } = await regenR.json() as { smtp_password: string };

    const r = await api("POST", "/internal/smtp-send", {
      headers: { "X-Relay-Secret": RELAY_SECRET },
      body: {
        username: `${name}@famio.org`,
        password: newPw,
        raw_message_b64: rawMessageB64(),
        envelope_from: `${name}@famio.org`,
        envelope_to: ["r@example.com"],
      },
    });
    expect(r.status).toBe(200);
  });

  it("401 with bad magic token", async () => {
    const r = await api("POST", "/manage/smtp-password", { token: "badtoken" });
    expect(r.status).toBe(401);
  });
});

// ─── POST /signup returns smtp_password ───────────────────────────────────────

describe("POST /signup — smtp_password in response", () => {
  it("201 response includes smtp_password field", async () => {
    const name = uid("swpw");
    const r = await api("POST", "/signup", {
      body: { name, owner_email: `${name}@example.com` },
    });
    expect(r.status).toBe(201);
    const body = await r.json() as { ok: boolean; address: string; smtp_password: string };
    expect(typeof body.smtp_password).toBe("string");
    expect(body.smtp_password.length).toBe(32);
  });
});
