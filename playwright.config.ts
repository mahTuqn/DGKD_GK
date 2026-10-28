import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

function localBrowserTestDatabaseUrl() {
  const configured = process.env.DATABASE_URL_TEST?.trim();
  if (!configured) {
    throw new Error("Local Playwright runs require DATABASE_URL_TEST pointing to a dedicated test database; existing development databases are not used for browser tests.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(configured);
  } catch {
    throw new Error("DATABASE_URL_TEST must be a valid PostgreSQL URL for local Playwright runs.");
  }

  if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL_TEST must use the postgres or postgresql protocol for local Playwright runs.");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  const hasTestMarker = /(^|[_-])(test|testing|qa|e2e)([_-]|$)/i.test(databaseName);
  if (databaseName.toLowerCase() === "cinema" || !hasTestMarker) {
    throw new Error("Local Playwright runs refuse DATABASE_URL_TEST unless its database name clearly identifies a test-only database (for example, cinema_test or cinema_qa).");
  }

  return configured;
}

let browserApiDatabaseUrl: string | undefined;
if (isGitHubActions) {
  browserApiDatabaseUrl = process.env.DATABASE_URL_TEST;
  if (!browserApiDatabaseUrl) {
    throw new Error("GitHub Actions Playwright runs require DATABASE_URL_TEST to point at the isolated ephemeral service database.");
  }
} else {
  if (externalBaseUrl) {
    throw new Error("Local Playwright runs refuse an external E2E_BASE_URL because its database cannot be verified; run against the isolated local API with DATABASE_URL_TEST.");
  }
  browserApiDatabaseUrl = localBrowserTestDatabaseUrl();
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "reports/generated/playwright", open: "never" }], ["json", { outputFile: "reports/generated/playwright-results.json" }]],
  use: {
    baseURL: externalBaseUrl || "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalBaseUrl ? undefined : [
    {
      command: "npm run dev --workspace backend",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: browserApiDatabaseUrl,
        DATABASE_URL_TEST: browserApiDatabaseUrl,
        E2E_REGISTRATION_RATE_LIMIT: "100"
      }
    },
    { command: "npm run dev --workspace frontend", url: "http://127.0.0.1:5173", reuseExistingServer: false, timeout: 60_000 },
    { command: "npm run preview --workspace frontend -- --port 5174", url: "http://127.0.0.1:5174", reuseExistingServer: false, timeout: 60_000 },
  ],
});
