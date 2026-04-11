import { SMTPServer } from "smtp-server";
import * as fs from "fs";

const PORT = parseInt(process.env.PORT ?? "587");
const SMTP_RELAY_SECRET = process.env.SMTP_RELAY_SECRET ?? "";
const WORKER_URL = process.env.WORKER_INTERNAL_URL ?? "https://famio.org/internal/smtp-send";

if (!SMTP_RELAY_SECRET) throw new Error("SMTP_RELAY_SECRET is required");

// TLS is required in production (Gmail/Outlook won't connect without STARTTLS).
// If cert paths are not set, the server runs in plain mode for local testing only.
const tlsKeyPath = process.env.TLS_KEY;
const tlsCertPath = process.env.TLS_CERT;
const hasTls = !!(tlsKeyPath && tlsCertPath);

const server = new SMTPServer({
  secure: false,         // port 587 uses STARTTLS, not direct TLS (that's 465)
  authMethods: ["PLAIN", "LOGIN"],
  // In plain mode (no TLS certs), allow auth over unencrypted connection for
  // local testing only. Never run with allowInsecureAuth in production.
  allowInsecureAuth: !hasTls,
  ...(hasTls
    ? { key: fs.readFileSync(tlsKeyPath!), cert: fs.readFileSync(tlsCertPath!) }
    : {}),

  onAuth(auth, _session, callback) {
    // Defer actual credential validation to the Worker on DATA — store on session.
    (_session as any).smtpUsername = auth.username ?? "";
    (_session as any).smtpPassword = auth.password ?? "";
    callback(null, { user: auth.username });
  },

  async onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", async () => {
      const raw = Buffer.concat(chunks);
      const s = session as any;
      const username: string = s.smtpUsername ?? "";
      const password: string = s.smtpPassword ?? "";
      const envelopeFrom =
        (session.envelope.mailFrom as { address?: string } | false)
          ? (session.envelope.mailFrom as { address: string }).address
          : username;
      const envelopeTo = (session.envelope.rcptTo as Array<{ address: string }>).map(
        (r) => r.address
      );

      try {
        const res = await fetch(WORKER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Relay-Secret": SMTP_RELAY_SECRET,
          },
          body: JSON.stringify({
            username,
            password,
            raw_message_b64: raw.toString("base64"),
            envelope_from: envelopeFrom,
            envelope_to: envelopeTo,
          }),
        });

        if (res.ok) {
          callback();
        } else {
          const body = (await res.json()) as { error?: string };
          // 401 = bad credentials → permanent SMTP failure (535)
          // anything else → transient failure (451), client may retry
          const responseCode = res.status === 401 ? 535 : 451;
          const err = Object.assign(new Error(body.error ?? "Delivery failed"), {
            responseCode,
          });
          callback(err);
        }
      } catch (err) {
        console.error("[PROXY] Worker call failed:", err);
        callback(Object.assign(new Error("Relay error — please retry"), { responseCode: 451 }));
      }
    });

    stream.on("error", (err: Error) => callback(err));
  },
});

server.on("error", (err: Error) => {
  console.error("[PROXY] Server error:", err.message);
});

server.listen(PORT, () => {
  console.log(`[PROXY] Famio SMTP proxy listening on port ${PORT} (TLS: ${hasTls})`);
});

export { server }; // exported for tests
