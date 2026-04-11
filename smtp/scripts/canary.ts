/**
 * SMTP canary — verifies the relay is reachable and accepts authenticated sends.
 *
 * Usage:
 *   bun scripts/canary.ts --host smtp.famio.org --port 587 \
 *     --user smiths@famio.org --pass <password> --to monitor@example.com
 *
 * Exits 0 on success, 1 on any SMTP failure (GitHub Actions marks run as failed).
 */

import nodemailer from "nodemailer";

function arg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error(`Missing required argument: ${flag}`);
    process.exit(1);
  }
  return process.argv[idx + 1];
}

const host = arg("--host");
const port = parseInt(arg("--port"));
const user = arg("--user");
const pass = arg("--pass");
const to = arg("--to");

async function main() {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });

  try {
    await transporter.verify();
    console.log(`[CANARY] Connected to ${host}:${port} ✓`);
  } catch (err) {
    console.error("[CANARY] Connection/auth failed:", err);
    process.exit(1);
  }

  try {
    await transporter.sendMail({
      from: user,
      to,
      subject: `[Famio canary] ${new Date().toISOString()}`,
      text: "This is an automated health check from the Famio SMTP canary.",
    });
    console.log(`[CANARY] Email sent to ${to} ✓`);
  } catch (err) {
    console.error("[CANARY] Send failed:", err);
    process.exit(1);
  }

  transporter.close();
  console.log("[CANARY] Done — relay is healthy");
}

main();
