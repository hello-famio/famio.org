import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    // Tests that need the Workers runtime (crypto.subtle, D1, etc).
    // Unit tests run via vitest.unit.config.ts. Integration tests via vitest.integration.config.ts.
    include: ["test/workers/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
