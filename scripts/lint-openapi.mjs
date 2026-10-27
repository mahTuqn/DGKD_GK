import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// TC-CONTRACT-01: validate the checked-in OpenAPI document using the repository's lint policy.
const cli = fileURLToPath(new URL("../node_modules/@redocly/cli/bin/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, "lint", "docs/openapi.yaml", "--config", "redocly.yaml"], {
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`Could not run Redocly CLI: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
