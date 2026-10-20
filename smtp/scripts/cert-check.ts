/**
 * TLS certificate expiry check for the SMTP relay.
 *
 * Speaks just enough SMTP to issue STARTTLS, then reads the peer certificate.
 * Verification is disabled so an already-expired cert can still be inspected.
 */

import * as net from "net";
import * as tls from "tls";

export interface CertInfo {
  subject: string;
  validTo: Date;
}

export type CertStatus =
  | { ok: true; daysLeft: number }
  | { ok: false; daysLeft: number; reason: "expired" | "expiring" };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function checkCertExpiry(validTo: Date, now: Date, minDays: number): CertStatus {
  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / MS_PER_DAY);
  if (validTo.getTime() <= now.getTime()) return { ok: false, daysLeft, reason: "expired" };
  if (daysLeft < minDays) return { ok: false, daysLeft, reason: "expiring" };
  return { ok: true, daysLeft };
}

export function fetchStartTlsCert(host: string, port: number, timeoutMs = 10_000): Promise<CertInfo> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buffer = "";
    let step: "greeting" | "ehlo" | "starttls" = "greeting";

    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`Timed out talking to ${host}:${port}`)));
    socket.on("error", fail);

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // Wait for the final line of a (possibly multi-line) reply: "NNN text\r\n"
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (!buffer.endsWith("\r\n") || !last || last[3] !== " ") return;
      buffer = "";
      const code = last.slice(0, 3);

      if (step === "greeting") {
        if (code !== "220") return fail(new Error(`Unexpected greeting: ${last}`));
        step = "ehlo";
        socket.write("EHLO famio-canary\r\n");
      } else if (step === "ehlo") {
        if (code !== "250") return fail(new Error(`EHLO rejected: ${last}`));
        step = "starttls";
        socket.write("STARTTLS\r\n");
      } else {
        if (code !== "220") return fail(new Error(`STARTTLS rejected: ${last}`));
        socket.removeAllListeners("data");
        socket.setTimeout(0);
        // SNI must be a hostname, never an IP literal
        const servername = net.isIP(host) ? undefined : host;
        const secure = tls.connect({ socket, servername, rejectUnauthorized: false }, () => {
          const cert = secure.getPeerCertificate();
          secure.end();
          if (!cert || !cert.valid_to) return reject(new Error("Server presented no certificate"));
          const cn = cert.subject?.CN;
          resolve({ subject: (Array.isArray(cn) ? cn[0] : cn) ?? "unknown", validTo: new Date(cert.valid_to) });
        });
        secure.setTimeout(timeoutMs, () => {
          secure.destroy();
          reject(new Error(`TLS handshake with ${host}:${port} timed out`));
        });
        secure.on("error", reject);
      }
    });
  });
}
