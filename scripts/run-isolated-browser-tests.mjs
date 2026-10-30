import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this helper through `npm run test:browser:isolated` so it can invoke the configured npm installation.");
  process.exit(2);
}

const suffix = randomBytes(6).toString("hex");
const containerName = `cinema-browser-e2e-${suffix}`;
const databaseName = `cinema_e2e_test_${suffix}`;
const databasePassword = randomBytes(32).toString("hex");
const allowedProjects = new Set(["chromium-desktop", "chromium-mobile"]);
const playwrightArgs = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index] ?? "";
  const project = argument === "--project" ? process.argv[++index] : argument.startsWith("--project=") ? argument.slice("--project=".length) : undefined;
  if (project !== undefined) {
    if (!allowedProjects.has(project)) {
      console.error("Only --project=chromium-desktop and --project=chromium-mobile are supported; the isolated runner owns the config, workers, URLs, and database.");
      process.exit(2);
    }
    playwrightArgs.push(`--project=${project}`);
    continue;
  }

  const grep = argument === "--grep"
    ? process.argv[++index]?.trim()
    : argument.startsWith("--grep=")
      ? argument.slice("--grep=".length).trim()
      : undefined;
  if (grep !== undefined) {
    if (!grep || grep.length > 200 || playwrightArgs.includes("--grep")) {
      console.error("Pass one non-empty --grep pattern of at most 200 characters to select isolated browser tests.");
      process.exit(2);
    }
    playwrightArgs.push("--grep", grep);
    continue;
  }

  if (argument === "--grep") {
    console.error("Pass a non-empty test pattern after --grep.");
    process.exit(2);
  }

  console.error("Only --project=chromium-desktop, --project=chromium-mobile, and one --grep pattern are supported; the isolated runner owns the config, workers, URLs, and database.");
  process.exit(2);
}
const childEnv = {
  ...process.env,
  DATABASE_URL: `postgresql://cinema:${databasePassword}@127.0.0.1:__PORT__/${databaseName}?schema=public`,
  DATABASE_URL_TEST: `postgresql://cinema:${databasePassword}@127.0.0.1:__PORT__/${databaseName}?schema=public`,
  NODE_ENV: "test",
};

// This helper must start the API and browser against its own disposable services.
for (const variable of [
  "E2E_BASE_URL",
  "E2E_API_URL",
  "E2E_COMPOSE_SMOKE",
  "GITHUB_ACTIONS",
  "DATABASE_URL_API_PROCESS_TEST",
  "DATABASE_URL_WORKER_PROCESS_TEST",
  "PLAYWRIGHT_CROSS_BROWSER_SMOKE",
]) {
  delete childEnv[variable];
}

let containerId;
let containerStartAttempted = false;
let activeChild;
let interrupted = false;

function interrupt() {
  interrupted = true;
  activeChild?.kill("SIGINT");
}

process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

function run(command, args, { env = childEnv, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", (error) => {
      activeChild = undefined;
      reject(new Error(`Could not start ${command}: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      activeChild = undefined;
      resolve({ code: code ?? (signal ? 128 : 1), stdout, stderr });
    });
  });
}

async function runChecked(command, args, options) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const details = options?.capture ? `${result.stderr}${result.stdout}`.trim() : "";
    throw new Error(`${command} exited with status ${result.code}${details ? `: ${details}` : ""}`);
  }
  return result;
}

async function runNpm(args) {
  return runChecked(process.execPath, [npmCli, ...args]);
}

async function waitForPostgres() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !interrupted) {
    const result = await run("docker", ["exec", containerId, "pg_isready", "-U", "cinema", "-d", databaseName], { capture: true });
    if (result.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (interrupted) throw new Error("Interrupted while waiting for the disposable PostgreSQL container.");
  throw new Error("Disposable PostgreSQL did not become ready within 60 seconds.");
}

async function main() {
  let success = false;
  let cleanupSucceeded = true;
  try {
    const nameCheck = await run("docker", ["container", "inspect", containerName, "--format", "{{.Id}}"], { capture: true });
    if (nameCheck.code === 0) throw new Error("Generated a Docker container name that is already in use; rerun to get a new random name.");
    if (!/no such (?:object|container)/i.test(nameCheck.stderr)) {
      throw new Error("Could not verify that the generated disposable container name is unused; refusing to start.");
    }

    console.log(`Starting a disposable PostgreSQL container for ${databaseName}.`);
    containerStartAttempted = true;
    const started = await runChecked("docker", [
      "run", "--detach",
      "--name", containerName,
      "--label", `com.cinemabooking.qa.runner=${suffix}`,
      "--env", "POSTGRES_USER=cinema",
      "--env", `POSTGRES_PASSWORD=${databasePassword}`,
      "--env", `POSTGRES_DB=${databaseName}`,
      "--publish", "127.0.0.1::5432",
      "postgres:17-alpine",
    ], { capture: true });
    containerId = started.stdout.trim();
    if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
      throw new Error("Docker did not return the expected ID for the new disposable container.");
    }

    const mapping = await runChecked("docker", ["port", containerId, "5432/tcp"], { capture: true });
    const portMatch = mapping.stdout.trim().match(/^127\.0\.0\.1:(\d+)$/m);
    if (!portMatch) throw new Error("Docker did not bind the disposable database to an IPv4 loopback port.");
    const port = Number(portMatch[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Docker returned an invalid database port.");

    const databaseUrl = `postgresql://cinema:${databasePassword}@127.0.0.1:${port}/${databaseName}?schema=public`;
    childEnv.DATABASE_URL = databaseUrl;
    childEnv.DATABASE_URL_TEST = databaseUrl;
    await waitForPostgres();

    console.log("Applying migrations to the disposable database.");
    await runNpm(["run", "db:deploy"]);
    console.log("Seeding only the disposable database.");
    await runNpm(["run", "db:seed"]);
    console.log("Building the current backend and frontend sources.");
    await runNpm(["run", "build"]);
    console.log("Running Playwright against its local API and browser servers.");
    await runNpm(["run", "test:browser", "--", "--workers=1", ...playwrightArgs]);
    success = true;
  } finally {
    if (!containerId && containerStartAttempted) {
      const inspect = await run("docker", [
        "container", "inspect", containerName,
        "--format", "{{index .Config.Labels \"com.cinemabooking.qa.runner\"}}|{{.Id}}",
      ], { capture: true });
      if (inspect.code === 0) {
        const [label, inspectedId] = inspect.stdout.trim().split("|");
        if (label === suffix && /^[a-f0-9]{12,64}$/i.test(inspectedId ?? "")) {
          containerId = inspectedId;
        } else {
          cleanupSucceeded = false;
          console.error("A container has the generated name but not the runner ownership label; it was left untouched.");
        }
      } else if (!/no such (?:object|container)/i.test(inspect.stderr)) {
        cleanupSucceeded = false;
        console.error("Could not verify cleanup of the attempted disposable database container.");
      }
    }
    if (containerId) {
      console.log("Removing the disposable browser-test container and its anonymous database volume.");
      const removed = await run("docker", ["rm", "--force", "--volumes", containerId], { capture: true });
      if (removed.code !== 0) {
        cleanupSucceeded = false;
        console.error(`Cleanup failed for the temporary container ${containerId}: ${removed.stderr.trim() || `docker exited ${removed.code}`}`);
        process.exitCode = 1;
      }
    }
    if (interrupted) process.exitCode = 130;
  }
  if (success && cleanupSucceeded) console.log("Isolated browser E2E run completed; its database container was removed.");
}

main().catch((error) => {
  console.error(`Isolated browser E2E failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
