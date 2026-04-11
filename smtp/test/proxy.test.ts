/**
 * SMTP proxy unit tests.
 *
 * Spins up the proxy on a random port and a mock HTTP server standing in for
 * the Worker /internal/smtp-send endpoint. Uses nodemailer as the SMTP client.
 *
 * Run with: bun test  (from the smtp/ directory)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SMTPServer } from "smtp-server";
import nodemailer from "nodemailer";
import * as http from "http";
import * as net from "net";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

interface MockWorkerOpts {
  status: number;
  body: Record<string, unknown>;
}

function startMockWorker(
  port: number,
  getResponse: () => MockWorkerOpts
): { server: http.Server; requests: Array<Record<string, unknown>>; close: () => Promise<void> } {
  const requests: Array<Record<string, unknown>> = [];

  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: JSON.parse(data),
        });
      } catch {
        requests.push({ method: req.method, url: req.url, rawBody: data });
      }
      const { status, body } = getResponse();
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });

  server.listen(port);

  return {
    server,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function startProxy(
  smtpPort: number,
  workerUrl: string,
  relaySecret: string
): { server: SMTPServer; close: () => Promise<void> } {
  // Inline the proxy server so tests don't import from src/index.ts
  // (which would start listening immediately on import).
  const proxy = new SMTPServer({
    secure: false,
    authMethods: ["PLAIN", "LOGIN"],
    allowInsecureAuth: true, // no TLS in tests
    onAuth(auth, _session, callback) {
      (_session as any).smtpUsername = auth.username ?? "";
      (_session as any).smtpPassword = auth.password ?? "";
      callback(null, { user: auth.username });
    },
    async onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", async () => {
        const raw = Buffer.concat(chunks);
        const s = session as any;
        try {
          const res = await fetch(workerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Relay-Secret": relaySecret },
            body: JSON.stringify({
              username: s.smtpUsername,
              password: s.smtpPassword,
              raw_message_b64: raw.toString("base64"),
              envelope_from: (session.envelope.mailFrom as any)?.address ?? "",
              envelope_to: session.envelope.rcptTo.map((r: any) => r.address),
            }),
          });
          if (res.ok) {
            callback();
          } else {
            const body = await res.json() as any;
            const err = Object.assign(new Error(body.error ?? "fail"), {
              responseCode: res.status === 401 ? 535 : 451,
            });
            callback(err);
          }
        } catch {
          callback(Object.assign(new Error("relay error"), { responseCode: 451 }));
        }
      });
    },
  });

  proxy.listen(smtpPort);
  return {
    server: proxy,
    close: () => new Promise((resolve) => proxy.close(resolve as () => void)),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SMTP proxy", () => {
  let smtpPort: number;
  let workerPort: number;
  let proxy: ReturnType<typeof startProxy>;
  let workerRequests: Array<Record<string, unknown>>;
  let mockWorkerResponse: MockWorkerOpts;
  let mockWorker: ReturnType<typeof startMockWorker>;

  const RELAY_SECRET = "test-secret-123";

  beforeAll(async () => {
    [smtpPort, workerPort] = await Promise.all([freePort(), freePort()]);
    mockWorker = startMockWorker(workerPort, () => mockWorkerResponse);
    workerRequests = mockWorker.requests;
    proxy = startProxy(
      smtpPort,
      `http://localhost:${workerPort}`,
      RELAY_SECRET
    );
    // Give servers a tick to start
    await new Promise((r) => setTimeout(r, 50));
  });

  afterAll(async () => {
    await Promise.all([proxy.close(), mockWorker.close()]);
  });

  beforeEach(() => {
    workerRequests.length = 0;
    mockWorkerResponse = { status: 200, body: { ok: true } };
  });

  function smtpClient(user = "smiths@famio.org", pass = "correctpass") {
    return nodemailer.createTransport({
      host: "localhost",
      port: smtpPort,
      secure: false,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
  }

  it("rejects verify() when auth credentials are not provided", async () => {
    const t = nodemailer.createTransport({
      host: "localhost",
      port: smtpPort,
      secure: false,
      // no auth — verify() should reject because server requires AUTH
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 3000,
    });
    await expect(t.verify()).rejects.toThrow();
  });

  it("forwards credentials to Worker in X-Relay-Secret header", async () => {
    const t = smtpClient("smiths@famio.org", "mypassword");
    await t.sendMail({ from: "smiths@famio.org", to: "r@example.com", subject: "test", text: "hi" });
    expect(workerRequests).toHaveLength(1);
    const req = workerRequests[0] as any;
    expect(req.headers["x-relay-secret"]).toBe(RELAY_SECRET);
  });

  it("sends username and password to Worker", async () => {
    const t = smtpClient("smiths@famio.org", "secret123");
    await t.sendMail({ from: "smiths@famio.org", to: "r@example.com", subject: "test", text: "hi" });
    const body = (workerRequests[0] as any).body;
    expect(body.username).toBe("smiths@famio.org");
    expect(body.password).toBe("secret123");
  });

  it("sends raw_message_b64 as base64 string", async () => {
    const t = smtpClient();
    await t.sendMail({ from: "smiths@famio.org", to: "r@example.com", subject: "test", text: "hello" });
    const body = (workerRequests[0] as any).body;
    expect(typeof body.raw_message_b64).toBe("string");
    expect(body.raw_message_b64.length).toBeGreaterThan(0);
    // Should decode to something containing the subject
    const decoded = Buffer.from(body.raw_message_b64, "base64").toString();
    expect(decoded).toContain("test");
  });

  it("forwards envelope_to from SMTP RCPT TO", async () => {
    const t = smtpClient();
    await t.sendMail({
      from: "smiths@famio.org",
      to: ["alice@example.com", "bob@example.com"],
      subject: "test",
      text: "hi",
    });
    const body = (workerRequests[0] as any).body;
    expect(body.envelope_to).toContain("alice@example.com");
    expect(body.envelope_to).toContain("bob@example.com");
  });

  it("returns SMTP 250 when Worker responds 200", async () => {
    mockWorkerResponse = { status: 200, body: { ok: true } };
    const t = smtpClient();
    // sendMail resolves (no throw) on SMTP 250
    await expect(
      t.sendMail({ from: "smiths@famio.org", to: "r@example.com", subject: "ok", text: "ok" })
    ).resolves.toBeDefined();
  });

  it("returns SMTP 535 (auth failure) when Worker responds 401", async () => {
    mockWorkerResponse = { status: 401, body: { error: "Invalid credentials." } };
    const t = smtpClient("bad@famio.org", "wrongpass");
    await expect(
      t.sendMail({ from: "bad@famio.org", to: "r@example.com", subject: "fail", text: "fail" })
    ).rejects.toThrow();
  });

  it("returns SMTP 451 (transient failure) when Worker responds 500", async () => {
    mockWorkerResponse = { status: 500, body: { error: "Internal error" } };
    const t = smtpClient();
    await expect(
      t.sendMail({ from: "smiths@famio.org", to: "r@example.com", subject: "err", text: "err" })
    ).rejects.toThrow();
  });

  it("returns SMTP 451 when Worker is unreachable", async () => {
    // Temporarily point proxy at a port with nothing listening
    const deadPort = await freePort();
    const deadProxy = startProxy(await freePort(), `http://localhost:${deadPort}`, RELAY_SECRET);
    await new Promise((r) => setTimeout(r, 30));

    const t = nodemailer.createTransport({
      host: "localhost",
      port: (deadProxy.server as any)._server?.address()?.port ?? smtpPort,
      secure: false,
      auth: { user: "a@famio.org", pass: "p" },
      tls: { rejectUnauthorized: false },
    });

    await deadProxy.close();
  });
});
