import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TC-SEC-02: scan the frozen repository history with the same Gitleaks release used by CI.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const reportDirectory = path.join(projectRoot, "reports", "generated");
fs.mkdirSync(reportDirectory, { recursive: true });
const mountPath = projectRoot.replaceAll("\\", "/");
const image = "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:b109bc5f8f76a38196a3e413704fc5b9e3c32360bce4e4b603bd6f45b3721dbb";
const args = [
  "run", "--rm", "--network", "none",
  "--volume", `${mountPath}:/path`,
  "--workdir", "/path",
  image,
  "git", "--redact", "--no-banner", "--report-format=json",
  "--report-path=/path/reports/generated/final-gitleaks.json", ".",
];

const result = spawnSync("docker", args, { stdio: "inherit", windowsHide: true });
if (result.error) {
  console.error(`Could not run the pinned Gitleaks container: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
