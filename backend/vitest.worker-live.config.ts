import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/worker.live-expiry.integration.test.ts"],
    testTimeout: 390_000,
    hookTimeout: 30_000
  }
});
