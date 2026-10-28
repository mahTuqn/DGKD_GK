import { defineConfig } from "vitest/config";
import { resolveWorkerSoakDurationMs } from "./tests/worker-process-soak-config.js";

const soakDurationMs = resolveWorkerSoakDurationMs();

export default defineConfig({
  test: {
    include: ["tests/worker.process.integration.test.ts"],
    testTimeout: soakDurationMs + 120_000,
    hookTimeout: 30_000
  }
});
