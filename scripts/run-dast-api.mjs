import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const composeFile = path.join(projectRoot, "docker-compose.yml");
const securityDirectory = path.join(projectRoot, "tests", "non-functional", "security");
const reportDirectory = path.join(projectRoot, "reports", "generated", "dast");
const image = process.env.ZAP_IMAGE || "ghcr.io/zaproxy/zaproxy:2.17.0@sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238";
const adminEmail = process.env.DAST_ADMIN_EMAIL || "admin@cinema.local";
const adminPassword = process.env.DAST_ADMIN_PASSWORD || "CinemaAdmin123!";
const timeoutMs = Number(process.env.DAST_COMMAND_TIMEOUT_MS || 1_500_000);
const runSuffix = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;

if (!existsSync(composeFile)) throw new Error(`Compose file not found: ${composeFile}`);
if (!Number.isFinite(timeoutMs) || timeoutMs < 60_000) throw new Error("DAST_COMMAND_TIMEOUT_MS must be at least 60000.");
if (!image.includes("/") || /\s/.test(image) || !/@sha256:[a-f0-9]{64}$/.test(image)) {
  throw new Error("ZAP_IMAGE must be pinned to an explicit SHA-256 digest, for example ghcr.io/zaproxy/zaproxy:2.17.0@sha256:<64-hex-digest>.");
}

const scenarios = [
  {
    key: "unauth",
    planName: "zap-api-unauthenticated.yaml",
    sourceReportName: "unauthenticated-api-zap.json",
    reportName: `unauthenticated-api-${runSuffix}.json`,
  },
  {
    key: "auth",
    planName: "zap-api-authenticated.yaml",
    sourceReportName: "authenticated-api-zap.json",
    reportName: `authenticated-api-${runSuffix}.json`,
  },
  {
    key: "preview",
    planName: "zap-preview.yaml",
    sourceReportName: "preview-zap.json",
    reportName: `preview-${runSuffix}.json`,
    startServices: ["postgres", "web"],
  },
];

const createdProjects = new Set();
const projectComposeEnvs = new Map();
const zapContainerNames = new Set();
const temporaryPlans = new Set();
let activeToken = "";
let failed = false;

function redact(value) {
  let safe = String(value ?? "");
  if (activeToken) {
    safe = safe.replaceAll(activeToken, "[REDACTED_DAST_TOKEN]");
    safe = safe.replaceAll(`Bearer ${activeToken}`, "Bearer [REDACTED_DAST_TOKEN]");
  }
  return safe;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: options.env || process.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? timeoutMs,
    windowsHide: true,
  });

  if (options.captureOnly) return result;

  const stdout = redact(result.stdout);
  const stderr = redact(result.stderr);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error) throw new Error(`${command} failed: ${redact(result.error.message)}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}${stderr ? `\n${stderr.trim()}` : ""}`);
  }
  return result;
}

function composeArgs(projectName, args) {
  return ["compose", "--project-name", projectName, "--file", composeFile, ...args];
}

function validateProjectName(projectName) {
  const expected = new RegExp(`^cinema-dast-${runSuffix}-(unauth|auth|preview)$`);
  if (!expected.test(projectName)) throw new Error(`Refusing to operate on non-owned Compose project name: ${projectName}`);
}

function createUniquePlan(scenario) {
  const sourcePlan = path.join(securityDirectory, scenario.planName);
  const contents = readFileSync(sourcePlan, "utf8");
  const lines = contents.split(/\r?\n/);
  const reportLineIndex = lines.findIndex((line) => line.trim() === `reportFile: ${scenario.sourceReportName}`);
  if (reportLineIndex < 0) throw new Error(`Expected reportFile entry was not found in ${scenario.planName}.`);

  const planStem = scenario.planName.replace(/\.yaml$/i, "");
  const planPath = path.join(securityDirectory, `.${planStem}-${runSuffix}.yaml`);
  const reportPath = path.join(reportDirectory, scenario.reportName);
  if (existsSync(planPath)) throw new Error(`Refusing to overwrite existing temporary plan: ${planPath}`);
  if (existsSync(reportPath)) throw new Error(`Refusing to overwrite an existing DAST report: ${reportPath}`);
  lines[reportLineIndex] = lines[reportLineIndex].replace(scenario.sourceReportName, scenario.reportName);
  const uniquePlan = lines.join("\n") + (contents.endsWith("\n") ? "\n" : "");
  writeFileSync(planPath, uniquePlan, { encoding: "utf8", flag: "wx" });
  temporaryPlans.add(planPath);
  return planPath;
}

function dockerPath(localPath) {
  // Docker Desktop accepts drive-letter paths with forward slashes. Passing
  // this as one argv item also keeps spaces in the checkout path intact.
  return path.resolve(localPath).replaceAll("\\", "/");
}

function assertNoPriorProjectResources(projectName) {
  validateProjectName(projectName);
  const containers = run("docker", ["ps", "--all", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`], { captureOnly: true });
  const volumes = run("docker", ["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`], { captureOnly: true });
  const networks = run("docker", ["network", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`], { captureOnly: true });
  for (const result of [containers, volumes, networks]) {
    if (result.error) throw new Error(`Docker resource preflight failed: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Docker resource preflight failed: ${redact(result.stderr)}`);
    if (result.stdout.trim()) throw new Error(`Generated project ${projectName} already has resources; refusing to reuse or remove them.`);
  }
}

function assertServicesAreScoped(projectName, includeWeb) {
  const result = run("docker", composeArgs(projectName, ["ps", "--services", "--all"]), {
    env: projectComposeEnvs.get(projectName) || process.env,
    captureOnly: true,
  });
  if (result.error) throw new Error(`Could not inspect services for ${projectName}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Could not inspect services for ${projectName}: ${redact(result.stderr)}`);
  const services = result.stdout.split(/\r?\n/).map((service) => service.trim()).filter(Boolean);
  const forbidden = services.filter((service) => service === "worker" || (!includeWeb && service === "web"));
  if (forbidden.length) throw new Error(`Unexpected services started in DAST project ${projectName}: ${forbidden.join(", ")}`);
  const allowed = new Set(["postgres", "migrate", "api", ...(includeWeb ? ["web"] : [])]);
  const unexpected = services.filter((service) => !allowed.has(service));
  if (unexpected.length) throw new Error(`Unexpected services started in DAST project ${projectName}: ${unexpected.join(", ")}`);
  const missing = [...allowed].filter((service) => !services.includes(service));
  if (missing.length) throw new Error(`Expected services are missing from DAST project ${projectName}: ${missing.join(", ")}`);
}

function apiCommand(projectName, code, options = {}) {
  const args = composeArgs(projectName, [
    "exec", "--no-TTY", "--interactive",
    "api", "node", "-e", code,
  ]);
  return run("docker", args, {
    env: options.env || projectComposeEnvs.get(projectName) || process.env,
    input: options.input,
    captureOnly: true,
    timeoutMs: 60_000,
  });
}

function obtainAdminToken(projectName) {
  const code = [
    "(async () => {",
    "  const credentials = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));",
    "  const login = await fetch('http://127.0.0.1:4000/api/auth/login', {",
    "    method: 'POST',",
    "    headers: { 'content-type': 'application/json' },",
    "    body: JSON.stringify(credentials),",
    "  });",
    "  if (!login.ok) throw new Error('ADMIN_LOGIN_HTTP_' + login.status);",
    "  const body = await login.json();",
    "  if (body.user?.role !== 'ADMIN' || typeof body.token !== 'string' || body.token.split('.').length !== 3) {",
    "    throw new Error('SEEDED_ACCOUNT_IS_NOT_AN_ADMIN');",
    "  }",
    "  const probe = await fetch('http://127.0.0.1:4000/api/admin/summary', {",
    "    headers: { authorization: 'Bearer ' + body.token },",
    "  });",
    "  if (probe.status !== 200) throw new Error('ADMIN_PREFLIGHT_HTTP_' + probe.status);",
    "  process.stdout.write(body.token);",
    "})().catch((error) => {",
    "  console.error(error.message.startsWith('ADMIN_') || error.message === 'SEEDED_ACCOUNT_IS_NOT_AN_ADMIN' ? error.message : 'ADMIN_PREFLIGHT_FAILED');",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");

  const result = apiCommand(projectName, code, {
    input: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Seeded Admin login/preflight failed: ${redact(result.stderr || result.error?.message)}`);
  }
  const token = String(result.stdout || "").trim();
  if (!token || token.split(".").length !== 3) throw new Error("Seeded Admin login did not return a JWT.");
  return token;
}

function sanitizeAndPreserveReport(scenario, token = "") {
  const reportPath = path.join(reportDirectory, scenario.reportName);
  if (!existsSync(reportPath)) throw new Error(`ZAP did not create the expected report: ${reportPath}`);
  let report = readFileSync(reportPath, "utf8");
  if (token) {
    report = report.replaceAll(token, "[REDACTED_DAST_TOKEN]");
    report = report.replaceAll(`Bearer ${token}`, "Bearer [REDACTED_DAST_TOKEN]");
  }
  writeFileSync(reportPath, report, { encoding: "utf8" });
  return reportPath;
}

function createProjectName(scenario) {
  const projectName = `cinema-dast-${runSuffix}-${scenario.key}`;
  validateProjectName(projectName);
  return projectName;
}

function findAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a local DAST PostgreSQL port.")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function startProject(projectName, composeEnv, scenario) {
  assertNoPriorProjectResources(projectName);
  // From this point, this script owns the generated, previously empty project.
  createdProjects.add(projectName);
  projectComposeEnvs.set(projectName, composeEnv);
  const startServices = scenario.startServices || ["postgres", "api"];
  run("docker", composeArgs(projectName, ["up", "--detach", "--wait", "--wait-timeout", "180", ...startServices]), { env: composeEnv });
  run("docker", composeArgs(projectName, ["--profile", "seed", "run", "--rm", "seed"]), { env: composeEnv });
  assertServicesAreScoped(projectName, scenario.key === "preview");
}

function scan(projectName, scenario, planPath, token = "") {
  const containerName = `${projectName}-zap`;
  if (!/^cinema-dast-[0-9]{14}-[a-f0-9]{8}-(unauth|auth|preview)-zap$/.test(containerName)) {
    throw new Error(`Refusing to create unexpected ZAP container name: ${containerName}`);
  }
  const existing = run("docker", ["container", "inspect", containerName], { captureOnly: true, timeoutMs: 30_000 });
  if (existing.error) throw new Error(`Could not check ZAP container name: ${existing.error.message}`);
  if (existing.status === 0) throw new Error(`ZAP container name ${containerName} already exists; refusing to reuse or remove it.`);
  if (!/no such object|no such container/i.test(String(existing.stderr || ""))) {
    throw new Error(`Could not verify ZAP container name availability: ${redact(existing.stderr)}`);
  }
  zapContainerNames.add(containerName);

  const env = { ...process.env };
  delete env.ZAP_AUTH_HEADER_VALUE;
  delete env.ZAP_AUTH_HEADER;
  delete env.ZAP_AUTH_HEADER_SITE;
  const args = [
    "run", "--rm", "--name", containerName,
    "--label", `com.cinema.dast.run=${runSuffix}`,
    "--network", `${projectName}_default`,
    // Expose only the OpenAPI spec and scan plans read-only; keep report
    // output in its dedicated writable directory instead of mounting source.
    "--volume", `${dockerPath(securityDirectory)}:/zap/wrk/tests/non-functional/security:ro`,
    "--volume", `${dockerPath(path.join(projectRoot, "docs"))}:/zap/wrk/docs:ro`,
    "--volume", `${dockerPath(reportDirectory)}:/zap/wrk/reports/generated/dast:rw`,
    "--env", "ZAP_RUN_SUFFIX",
  ];
  env.ZAP_RUN_SUFFIX = runSuffix;

  if (token) {
    env.ZAP_AUTH_HEADER_VALUE = `Bearer ${token}`;
    env.ZAP_AUTH_HEADER = "Authorization";
    // ZAP compares this value against the hostname (api), not hostname:port.
    env.ZAP_AUTH_HEADER_SITE = "api";
    args.push("--env", "ZAP_AUTH_HEADER_VALUE", "--env", "ZAP_AUTH_HEADER", "--env", "ZAP_AUTH_HEADER_SITE");
  }

  args.push(image, "zap.sh", "-cmd", "-autorun", `/zap/wrk/${path.relative(projectRoot, planPath).replaceAll("\\", "/")}`);
  let scanError;
  try {
    run("docker", args, { env, timeoutMs });
  } catch (error) {
    scanError = error;
  }
  if (existsSync(path.join(reportDirectory, scenario.reportName))) sanitizeAndPreserveReport(scenario, token);
  if (scanError) throw scanError;
  return sanitizeAndPreserveReport(scenario, token);
}

function cleanupZapContainer(containerName) {
  if (!/^cinema-dast-[0-9]{14}-[a-f0-9]{8}-(unauth|auth|preview)-zap$/.test(containerName)) {
    throw new Error(`Refusing to remove unexpected ZAP container name: ${containerName}`);
  }
  const result = run("docker", ["rm", "--force", containerName], { captureOnly: true, timeoutMs: 30_000 });
  if (result.error) throw new Error(`Could not inspect temporary ZAP container: ${result.error.message}`);
  if (result.status !== 0 && !/no such container/i.test(String(result.stderr || ""))) {
    throw new Error(`Could not remove temporary ZAP container: ${redact(result.stderr)}`);
  }
}

function cleanupProject(projectName) {
  validateProjectName(projectName);
  const cleanupArgs = ["down", ...(process.env.DAST_KEEP_VOLUMES === "1" ? [] : ["--volumes"]), "--remove-orphans"];
  if (process.env.DAST_KEEP_VOLUMES === "1") {
    console.log(`Preserving run-owned volumes for ${projectName} because DAST_KEEP_VOLUMES=1.`);
  }
  run("docker", composeArgs(projectName, cleanupArgs), {
    env: projectComposeEnvs.get(projectName) || process.env,
    timeoutMs: 120_000,
  });
}

try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 30_000 });
  mkdirSync(reportDirectory, { recursive: true });
  // The ZAP image runs as UID 1000 while hosted runner workspaces belong to
  // the runner user. Grant write access only to this ignored report directory.
  if (process.platform !== "win32") chmodSync(reportDirectory, 0o777);

  for (const scenario of scenarios) {
    const projectName = createProjectName(scenario);
    const planPath = createUniquePlan(scenario);
    const postgresHostPort = await findAvailableLoopbackPort();
    const composeEnv = {
      ...process.env,
      POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
      JWT_SECRET: randomBytes(32).toString("hex"),
      MOCK_PAYMENT_SECRET: randomBytes(32).toString("hex"),
      TRUST_PROXY_HOPS: "1",
      POSTGRES_HOST_BIND: "127.0.0.1",
      POSTGRES_HOST_PORT: String(postgresHostPort),
    };
    if (scenario.key === "preview") {
      composeEnv.WEB_HOST_BIND = "127.0.0.1";
      composeEnv.WEB_HOST_PORT = String(await findAvailableLoopbackPort());
    }
    let token = "";
    try {
      console.log(`Starting isolated ${scenario.key} DAST project ${projectName}.`);
      startProject(projectName, composeEnv, scenario);

      if (scenario.key === "unauth") {
        const result = apiCommand(projectName, [
          "fetch('http://127.0.0.1:4000/api/auth/me')",
          "  .then((response) => {",
          "    if (response.status !== 401) { console.error('UNAUTH_CONTROL_STATUS_' + response.status); process.exitCode = 1; }",
          "  })",
          "  .catch(() => { console.error('UNAUTH_CONTROL_REQUEST_FAILED'); process.exitCode = 1; });",
        ].join("\n"), { env: composeEnv });
        if (result.error || result.status !== 0) {
          throw new Error(`Unauthenticated control must return HTTP 401: ${redact(result.stderr || result.error?.message)}`);
        }
      } else if (scenario.key === "auth") {
        token = obtainAdminToken(projectName);
        activeToken = token;
      }

      const reportPath = scan(projectName, scenario, planPath, token);
      console.log(`Preserved sanitized report: ${path.relative(projectRoot, reportPath)}`);
      token = "";
      activeToken = "";
    } catch (error) {
      failed = true;
      console.error(redact(error instanceof Error ? error.message : error));
    } finally {
      activeToken = token;
      for (const containerName of [...zapContainerNames]) {
        if (containerName.startsWith(projectName)) {
          try {
            cleanupZapContainer(containerName);
          } catch (error) {
            failed = true;
            console.error(redact(error instanceof Error ? error.message : error));
          }
          zapContainerNames.delete(containerName);
        }
      }
      if (createdProjects.has(projectName)) {
        let cleaned = false;
        try {
          cleanupProject(projectName);
          cleaned = true;
        } catch (error) {
          failed = true;
          console.error(redact(error instanceof Error ? error.message : error));
        }
        if (cleaned) {
          createdProjects.delete(projectName);
          projectComposeEnvs.delete(projectName);
        }
      }
      if (temporaryPlans.has(planPath)) {
        rmSync(planPath, { force: true });
        temporaryPlans.delete(planPath);
      }
      token = "";
      activeToken = "";
    }
    if (failed) break;
  }
} catch (error) {
  failed = true;
  console.error(redact(error instanceof Error ? error.message : error));
} finally {
  activeToken = "";
  for (const projectName of [...createdProjects]) {
    try {
      cleanupProject(projectName);
      createdProjects.delete(projectName);
      projectComposeEnvs.delete(projectName);
    } catch (error) {
      failed = true;
      console.error(redact(error instanceof Error ? error.message : error));
    }
  }
  for (const planPath of temporaryPlans) rmSync(planPath, { force: true });
}

if (failed) process.exitCode = 1;
else console.log(`All three isolated DAST scans completed. Run suffix: ${runSuffix}`);
