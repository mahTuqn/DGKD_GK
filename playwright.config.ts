import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const crossBrowserSmoke = process.env.PLAYWRIGHT_CROSS_BROWSER_SMOKE === "true";
const configuredFrontendPort = process.env.E2E_FRONTEND_PORT ?? process.env.VITE_PORT;
const frontendPort = Number(configuredFrontendPort ?? (isGitHubActions ? 5173 : 5175));
const previewPort = Number(process.env.E2E_PREVIEW_PORT ?? 5174);
const apiPort = 4000;

if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65_535) {
  throw new Error("E2E_FRONTEND_PORT or VITE_PORT must be a valid TCP port.");
}
if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65_535) {
  throw new Error("E2E_PREVIEW_PORT must be a valid TCP port.");
}
if (previewPort === apiPort || previewPort === frontendPort) {
  throw new Error("E2E_PREVIEW_PORT must differ from the API port (4000) and E2E_FRONTEND_PORT/VITE_PORT.");
}

const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const previewOrigin = `http://127.0.0.1:${previewPort}`;
const corsOrigins = [...new Set([5173, previewPort, frontendPort].flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]))].join(",");

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
if (externalBaseUrl && isGitHubActions) {
  // The isolated Compose smoke targets its own disposable API/database and
  // does not start Playwright's local API server.
  browserApiDatabaseUrl = undefined;
} else if (isGitHubActions) {
  browserApiDatabaseUrl = process.env.DATABASE_URL_TEST;
  if (!browserApiDatabaseUrl) {
    throw new Error("GitHub Actions Playwright runs require DATABASE_URL_TEST to point at the isolated ephemeral service database.");
  }
} else {
  if (externalBaseUrl) throw new Error("Local Playwright runs refuse an external E2E_BASE_URL because its database cannot be verified; run against the isolated local API with DATABASE_URL_TEST.");
  browserApiDatabaseUrl = localBrowserTestDatabaseUrl();
}

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: process.env.E2E_COMPOSE_SMOKE === "true" ? [] : ["**/compose-stack.spec.ts"],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "reports/generated/playwright", open: "never" }], ["json", { outputFile: "reports/generated/playwright-results.json" }]],
  use: {
    baseURL: externalBaseUrl || (isGitHubActions ? previewOrigin : frontendOrigin),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: crossBrowserSmoke
    ? [
        { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
      ]
    : [
        { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
        { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
      ],
  webServer: externalBaseUrl ? undefined : [
    {
      command: isGitHubActions ? "npm start --workspace backend" : "npm run dev --workspace backend",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: browserApiDatabaseUrl,
        DATABASE_URL_TEST: browserApiDatabaseUrl,
        CORS_ORIGIN: corsOrigins,
        E2E_REGISTRATION_RATE_LIMIT: "100"
      }
    },
    {
      command: "npm run dev --workspace frontend",
      url: frontendOrigin,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_FRONTEND_PORT: String(frontendPort), VITE_PORT: String(frontendPort) },
    },
    { command: `npm run preview --workspace frontend -- --port ${previewPort}`, url: `http://127.0.0.1:${previewPort}`, reuseExistingServer: false, timeout: 60_000 },
  ],
});
