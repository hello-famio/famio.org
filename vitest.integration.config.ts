import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    // Run serially — tests share a live D1 database
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
  },
});
