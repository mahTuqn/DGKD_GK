import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "reports/generated/playwright", open: "never" }], ["json", { outputFile: "reports/generated/playwright-results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "npm run dev --workspace backend", url: "http://127.0.0.1:4000/api/health", reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: "npm run dev --workspace frontend", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: "npm run preview --workspace frontend -- --port 5174", url: "http://127.0.0.1:5174", reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
});
