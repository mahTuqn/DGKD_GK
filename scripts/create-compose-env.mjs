import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  throw new Error("Refusing to overwrite an existing .env file. Keep its current secrets or remove it yourself before regenerating.");
}

const projectName = (process.env.COMPOSE_PROJECT_NAME || path.basename(process.cwd())).toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[^a-z0-9]+/, "");
const volumeName = `${projectName}_cinema_postgres_data`;
const volumeCheck = spawnSync("docker", ["volume", "inspect", "--format", "{{.Name}}", volumeName], {
  encoding: "utf8",
  windowsHide: true,
});
if (volumeCheck.error) {
  throw new Error(`Could not verify that Docker volume ${volumeName} is absent. Start Docker Desktop and retry.`);
}
if (!volumeCheck.error && volumeCheck.status === 0 && volumeCheck.stdout.trim() === volumeName) {
  throw new Error(`A PostgreSQL volume already exists for Compose project ${projectName}. Restore its original POSTGRES_PASSWORD or rotate the database role before creating .env.`);
}
if (volumeCheck.status !== 1 || !/no such volume/i.test(String(volumeCheck.stderr || ""))) {
  throw new Error(`Could not verify that Docker volume ${volumeName} is absent. Start Docker Desktop and retry.`);
}

const entries = [
  ["POSTGRES_PASSWORD", randomBytes(32).toString("hex")],
  ["JWT_SECRET", randomBytes(32).toString("hex")],
  ["MOCK_PAYMENT_SECRET", randomBytes(32).toString("hex")],
  ["POSTGRES_HOST_BIND", "127.0.0.1"],
  ["POSTGRES_HOST_PORT", "5434"],
  ["WEB_HOST_BIND", "127.0.0.1"],
  ["WEB_HOST_PORT", "8080"],
];

writeFileSync(envPath, `${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});

console.log("Created ignored .env with independent random database, JWT, and mock-payment secrets. Secret values were not printed.");
