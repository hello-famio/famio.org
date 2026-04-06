import { execSync } from "node:child_process";

export default async function globalSetup() {
  console.log("\n[e2e] Resetting staging seed data...");
  execSync(
    "bunx wrangler d1 execute famio --remote --file=scripts/e2e-reset.sql",
    { stdio: "pipe" }
  );
  console.log("[e2e] Seed reset complete.");
}
