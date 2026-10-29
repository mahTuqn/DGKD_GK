import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/worker.process.integration.test.ts", "tests/worker.live-expiry.integration.test.ts", "tests/api-process-race.integration.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts"],
      exclude: ["src/domain/**/*.d.ts"],
      reportsDirectory: "../reports/generated/coverage",
      reporter: ["text", "json", "lcov", "html"],
      thresholds: {
        lines: 90,
        branches: 80
      }
    }
  }
});
