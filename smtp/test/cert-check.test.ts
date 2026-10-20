/**
 * Canary TLS cert check tests.
 *
 * The STARTTLS test runs against a local SMTPServer, which falls back to
 * smtp-server's bundled self-signed certificate when no key/cert is given.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SMTPServer } from "smtp-server";
import * as net from "net";
import { checkCertExpiry, fetchStartTlsCert } from "../scripts/cert-check";

const NOW = new Date("2026-10-20T00:00:00Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

describe("checkCertExpiry", () => {
  it("passes when the cert has plenty of time left", () => {
    expect(checkCertExpiry(daysFromNow(60), NOW, 14)).toEqual({ ok: true, daysLeft: 60 });
  });

  it("passes at exactly the threshold", () => {
    expect(checkCertExpiry(daysFromNow(14), NOW, 14)).toEqual({ ok: true, daysLeft: 14 });
  });

  it("fails as expiring inside the threshold", () => {
    expect(checkCertExpiry(daysFromNow(13), NOW, 14)).toEqual({ ok: false, daysLeft: 13, reason: "expiring" });
  });

  it("fails as expired once validTo has passed", () => {
    expect(checkCertExpiry(daysFromNow(-102), NOW, 14)).toEqual({ ok: false, daysLeft: -102, reason: "expired" });
  });

  it("treats validTo equal to now as expired", () => {
    expect(checkCertExpiry(NOW, NOW, 14)).toMatchObject({ ok: false, reason: "expired" });
  });
});

describe("fetchStartTlsCert", () => {
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({ authOptional: true, logger: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.server.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reads the certificate presented after STARTTLS", async () => {
    const cert = await fetchStartTlsCert("127.0.0.1", port);
    expect(cert.validTo).toBeInstanceOf(Date);
    expect(Number.isNaN(cert.validTo.getTime())).toBe(false);
    expect(typeof cert.subject).toBe("string");
  });

  it("rejects when STARTTLS is not offered", async () => {
    const plain = new SMTPServer({ authOptional: true, logger: false, disabledCommands: ["STARTTLS"] });
    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve));
    const plainPort = (plain.server.address() as net.AddressInfo).port;
    try {
      await expect(fetchStartTlsCert("127.0.0.1", plainPort)).rejects.toThrow(/STARTTLS rejected/);
    } finally {
      await new Promise<void>((resolve) => plain.close(() => resolve()));
    }
  });

  it("rejects when nothing is listening", async () => {
    const closed = await new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    await expect(fetchStartTlsCert("127.0.0.1", closed)).rejects.toThrow();
  });
});
