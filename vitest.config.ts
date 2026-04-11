import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    // Only include tests that need the Workers runtime (crypto.subtle etc.).
    // Integration tests (staging) and unit tests run via vitest.integration.config.ts.
    include: ["test/workers/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
