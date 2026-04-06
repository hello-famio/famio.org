/**
 * Integration tests against https://famio-worker-staging.bevn.workers.dev
 *
 * Run with: bun run test:staging
 *
 * Uses the fixed devtokens from seed.sql for flows that require pre-existing
 * tokens (confirm, unsubscribe). Resets devtokens in beforeAll so tests are
 * re-runnable. All signup tests use unique names to avoid collisions.
 */

import { execSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "https://famio-worker-staging.bevn.workers.dev";
const MAGIC = "devtoken_magic";
const CONFIRM = "devtoken_confirm";
const UNSUB = "devtoken_unsub";

// Unique suffix per test run so signup tests don't conflict across runs
const RUN = Date.now().toString(36);

function uid(prefix: string): string {
  return `${prefix}-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

// ─── Reset devtokens so confirm/unsub tests are re-runnable ──────────────────

beforeAll(() => {
  execSync(
    `bunx wrangler d1 execute famio --remote --command "UPDATE tokens SET used = 0 WHERE token LIKE 'devtoken_%'"`,
    { stdio: "pipe" }
  );
  // Also ensure seed member rows exist for the devtoken flows
  execSync(
    `bunx wrangler d1 execute famio --remote --file=src/db/seed.sql`,
    { stdio: "pipe" }
  );
});

// ─── POST /signup ─────────────────────────────────────────────────────────────

describe("POST /signup", () => {
  it("201 creates a new family address", async () => {
    const name = uid("fam");
    const r = await api("POST", "/signup", {
      body: { name, owner_email: `owner-${RUN}@example.com`, members: [] },
    });
    expect(r.status).toBe(201);
    const body = await r.json() as { ok: boolean; address: string };
    expect(body.ok).toBe(true);
    expect(body.address).toBe(`${name}@famio.org`);
  });

  it("201 with initial members", async () => {
    const name = uid("fam");
    const r = await api("POST", "/signup", {
      body: {
        name,
        owner_email: `owner2-${RUN}@example.com`,
        members: [`m1-${RUN}@example.com`, `m2-${RUN}@example.com`],
      },
    });
    expect(r.status).toBe(201);
  });

  it("400 name too short", async () => {
    const r = await api("POST", "/signup", {
      body: { name: "ab", owner_email: "x@example.com" },
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/3/);
  });

  it("400 name with uppercase", async () => {
    const r = await api("POST", "/signup", {
      body: { name: "MyFamily", owner_email: "x@example.com" },
    });
    expect(r.status).toBe(400);
  });

  it("400 name with spaces", async () => {
    const r = await api("POST", "/signup", {
      body: { name: "my family", owner_email: "x@example.com" },
    });
    expect(r.status).toBe(400);
  });

  it("400 reserved name 'admin'", async () => {
    const r = await api("POST", "/signup", {
      body: { name: "admin", owner_email: "x@example.com" },
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/reserved/);
  });

  it("400 missing owner email", async () => {
    const r = await api("POST", "/signup", {
      body: { name: uid("fam") },
    });
    expect(r.status).toBe(400);
  });

  it("400 invalid owner email", async () => {
    const r = await api("POST", "/signup", {
      body: { name: uid("fam"), owner_email: "notanemail" },
    });
    expect(r.status).toBe(400);
  });

  it("400 over 6 members total", async () => {
    const r = await api("POST", "/signup", {
      body: {
        name: uid("fam"),
        owner_email: `bigowner-${RUN}@example.com`,
        members: Array.from({ length: 6 }, (_, i) => `m${i}-${RUN}@example.com`),
      },
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/6/);
  });

  it("409 name already taken", async () => {
    const name = uid("dup");
    const ownerEmail = `dupowner-${RUN}@example.com`;
    await api("POST", "/signup", { body: { name, owner_email: ownerEmail } });
    const r2 = await api("POST", "/signup", {
      body: { name, owner_email: `other-${RUN}@example.com` },
    });
    expect(r2.status).toBe(409);
    const body = await r2.json() as { error: string };
    expect(body.error).toMatch(/already taken/);
  });

  it("409 owner already has an address", async () => {
    const ownerEmail = `twiceowner-${RUN}@example.com`;
    await api("POST", "/signup", { body: { name: uid("fam"), owner_email: ownerEmail } });
    const r2 = await api("POST", "/signup", {
      body: { name: uid("fam2"), owner_email: ownerEmail },
    });
    expect(r2.status).toBe(409);
    const body = await r2.json() as { error: string };
    expect(body.error).toMatch(/already have/);
  });
});

// ─── GET /manage ──────────────────────────────────────────────────────────────

describe("GET /manage", () => {
  it("200 returns HTML roster page", async () => {
    const r = await fetch(`${BASE}/manage?token=${MAGIC}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    const text = await r.text();
    expect(text).toMatch(/testfamily/);
    expect(text).toMatch(/owner@example\.com/);
  });

  it("401 with bad token", async () => {
    const r = await fetch(`${BASE}/manage?token=badtoken`);
    expect(r.status).toBe(401);
  });

  it("401 with no token", async () => {
    const r = await fetch(`${BASE}/manage`);
    expect(r.status).toBe(401);
  });
});

// ─── POST /manage/members ────────────────────────────────────────────────────

describe("POST /manage/members", () => {
  const newEmail = `new-${RUN}@example.com`;

  it("200 adds a new member", async () => {
    const r = await api("POST", "/manage/members", {
      token: MAGIC,
      body: { email: newEmail },
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("409 adding same member twice", async () => {
    const r = await api("POST", "/manage/members", {
      token: MAGIC,
      body: { email: newEmail },
    });
    expect(r.status).toBe(409);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/already a member/);
  });

  it("400 invalid email", async () => {
    const r = await api("POST", "/manage/members", {
      token: MAGIC,
      body: { email: "notanemail" },
    });
    expect(r.status).toBe(400);
  });

  it("401 bad token", async () => {
    const r = await api("POST", "/manage/members", {
      token: "badtoken",
      body: { email: "someone@example.com" },
    });
    expect(r.status).toBe(401);
  });
});

// ─── DELETE /manage/members/:email ───────────────────────────────────────────

describe("DELETE /manage/members/:email", () => {
  it("200 removes a member", async () => {
    // Add then remove
    const email = `del-${RUN}@example.com`;
    await api("POST", "/manage/members", { token: MAGIC, body: { email } });
    const r = await api(
      "DELETE",
      `/manage/members/${encodeURIComponent(email)}`,
      { token: MAGIC }
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("400 cannot remove owner", async () => {
    const r = await api(
      "DELETE",
      `/manage/members/${encodeURIComponent("owner@example.com")}`,
      { token: MAGIC }
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/owner/);
  });

  it("404 member not found", async () => {
    const r = await api(
      "DELETE",
      `/manage/members/${encodeURIComponent("ghost@example.com")}`,
      { token: MAGIC }
    );
    expect(r.status).toBe(404);
  });

  it("401 bad token", async () => {
    const r = await api(
      "DELETE",
      `/manage/members/${encodeURIComponent("someone@example.com")}`,
      { token: "badtoken" }
    );
    expect(r.status).toBe(401);
  });
});

// ─── POST /manage/magic-link ─────────────────────────────────────────────────

describe("POST /manage/magic-link", () => {
  it("200 sends a new magic link", async () => {
    const r = await api("POST", "/manage/magic-link", { token: MAGIC });
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("401 bad token", async () => {
    const r = await api("POST", "/manage/magic-link", { token: "badtoken" });
    expect(r.status).toBe(401);
  });
});

// ─── GET /confirm ─────────────────────────────────────────────────────────────

describe("GET /confirm", () => {
  it("200 shows success page for valid token", async () => {
    const r = await fetch(`${BASE}/confirm?token=${CONFIRM}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toMatch(/confirmed|opted in|welcome/i);
    expect(text).toMatch(/testfamily/);
  });

  it("200 shows error page for bad token", async () => {
    const r = await fetch(`${BASE}/confirm?token=badtoken`);
    expect(r.status).toBe(200); // error rendered as HTML 200
    const text = await r.text();
    expect(text).toMatch(/invalid|expired/i);
  });
});

// ─── GET /unsubscribe ─────────────────────────────────────────────────────────

describe("GET /unsubscribe", () => {
  it("200 shows unsubscribe confirmation page", async () => {
    const r = await fetch(`${BASE}/unsubscribe?token=${UNSUB}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toMatch(/unsubscribe|leave/i);
    expect(text).toMatch(/testfamily/);
  });

  it("401 bad token", async () => {
    const r = await fetch(`${BASE}/unsubscribe?token=badtoken`);
    expect(r.status).toBe(401);
  });
});

// ─── POST /unsubscribe ────────────────────────────────────────────────────────

describe("POST /unsubscribe", () => {
  it("200 removes the member and shows success page", async () => {
    const r = await fetch(`${BASE}/unsubscribe?token=${UNSUB}`, { method: "POST" });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toMatch(/unsubscribed|removed/i);
  });

  it("401 token already used after unsubscribe", async () => {
    // UNSUB token just got consumed above
    const r = await fetch(`${BASE}/unsubscribe?token=${UNSUB}`, { method: "POST" });
    expect(r.status).toBe(401);
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

describe("404 unknown routes", () => {
  it("404 for unknown path", async () => {
    const r = await fetch(`${BASE}/does-not-exist`);
    expect(r.status).toBe(404);
  });
});
