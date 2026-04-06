import { execSync } from "node:child_process";

export default async function globalTeardown() {
  console.log("\n[e2e] Cleaning up E2E test data from staging...");

  // Remove all addresses (and cascade members/tokens) created by E2E tests.
  // Test addresses use the 'e2e-' prefix — never used in real data.
  execSync(
    `bunx wrangler d1 execute famio --remote --command \
"DELETE FROM tokens WHERE address_id IN (SELECT id FROM addresses WHERE name LIKE 'e2e-%'); \
DELETE FROM members WHERE address_id IN (SELECT id FROM addresses WHERE name LIKE 'e2e-%'); \
DELETE FROM addresses WHERE name LIKE 'e2e-%%'"`,
    { stdio: "pipe" }
  );

  // Also clean up any orphaned tokens from 'smiths' / 'proxytest*' left by earlier manual tests
  execSync(
    `bunx wrangler d1 execute famio --remote --command \
"DELETE FROM tokens WHERE address_id IN (SELECT id FROM addresses WHERE name LIKE 'proxytest%'); \
DELETE FROM members WHERE address_id IN (SELECT id FROM addresses WHERE name LIKE 'proxytest%'); \
DELETE FROM addresses WHERE name LIKE 'proxytest%%'"`,
    { stdio: "pipe" }
  );

  console.log("[e2e] Cleanup complete.");
}
