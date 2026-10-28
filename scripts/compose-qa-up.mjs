import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedArgs = process.argv.slice(2);
const build = requestedArgs.includes("--build");
const unsupportedArgs = requestedArgs.filter((argument) => argument !== "--build");

if (unsupportedArgs.length > 0) {
  console.error(`Unsupported argument(s): ${unsupportedArgs.join(" ")}. Only --build is supported.`);
  process.exit(2);
}

function readPort(name, fallback) {
  const rawValue = process.env[name] ?? fallback;
  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return String(port);
}

let postgresPort;
let webPort;
try {
  postgresPort = readPort("QA_POSTGRES_HOST_PORT", "5435");
  webPort = readPort("QA_WEB_HOST_PORT", "8081");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const env = {
  ...process.env,
  POSTGRES_HOST_BIND: "127.0.0.1",
  POSTGRES_HOST_PORT: postgresPort,
  WEB_HOST_BIND: "127.0.0.1",
  WEB_HOST_PORT: webPort,
  CORS_ORIGIN: process.env.QA_CORS_ORIGIN
    ?? `http://localhost:${webPort},http://127.0.0.1:${webPort},http://localhost:5173,http://127.0.0.1:5173`,
};

const args = [
  "compose",
  "--project-directory",
  projectRoot,
  "--project-name",
  "cinema-qa",
  "up",
  "--detach",
  build ? "--build" : "--no-build",
  "--wait",
  "--wait-timeout",
  "120",
];

const result = spawnSync("docker", args, {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`Could not start the cinema-qa Compose project: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
