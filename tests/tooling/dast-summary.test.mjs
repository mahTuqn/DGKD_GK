import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../../scripts/summarize-dast.mjs", import.meta.url));
function summarize(fixtures, expectedExitCode = 0) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cinema-dast-summary-"));
  try {
    for (const [kind, value] of Object.entries(fixtures)) {
      writeFileSync(path.join(directory, `${kind}-20261029160000-1234abcd.json`), JSON.stringify(value));
    }
    const summaryPath = path.join(directory, "summary.md");
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, DAST_REPORT_DIRECTORY: directory, GITHUB_STEP_SUMMARY: summaryPath },
    });
    assert.equal(result.status, expectedExitCode, result.stderr);
    return { markdown: readFileSync(summaryPath, "utf8"), output: result.stdout + result.stderr, exitCode: result.status };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const report = (alerts = []) => ({ site: [{ alerts }] });

test("reports rule identity and aggregates records independently of instances", () => {
  const { markdown } = summarize({
    "unauthenticated-api": report(),
    "authenticated-api": report([
      { pluginid: "10001", riskcode: "1", instances: [{}, {}] },
      { pluginid: "10001", riskcode: "1", instances: [{}] },
      { pluginid: "10001", riskcode: "0", instances: [] },
    ]),
    preview: report(),
  });
  assert.match(markdown, /\| authenticated-api \| 10001 \| Low \| 2 \| 3 \|/);
  assert.match(markdown, /\| authenticated-api \| 10001 \| Informational \| 1 \| 0 \|/);
  assert.match(markdown, /\*\*3\/3 reports\*\*/);
});

test("does not expose arbitrary report fields or malicious plugin identifiers", () => {
  const secret = "DO_NOT_PUBLISH_TOKEN";
  const { markdown, output } = summarize({
    "authenticated-api": report([{ pluginid: `10001 | ${secret}`, riskcode: "1", name: secret,
      riskdesc: `Low (${secret})`, instances: [{ uri: secret, evidence: secret, attack: secret }] }]),
  }, 1);
  assert.match(markdown, /\| authenticated-api \| Unknown \| Low \| 1 \| 1 \|/);
  assert.ok(!markdown.includes(secret));
  assert.ok(!output.includes(secret));
  assert.match(markdown, /missing or invalid/);
});

test("missing reports fail the current-run summary gate while valid reports remain parsed", () => {
  const { markdown, exitCode, output } = summarize({
    "unauthenticated-api": report(),
    "authenticated-api": report(),
  }, 1);
  assert.equal(exitCode, 1);
  assert.match(markdown, /\| preview \|.*\| missing \|/);
  assert.match(markdown, /\| unauthenticated-api \| 0 \| 0 \| 0 \| 0 \| 0 \| parsed \|/);
  assert.match(markdown, /\| authenticated-api \| 0 \| 0 \| 0 \| 0 \| 0 \| parsed \|/);
  assert.match(markdown, /\*\*2\/3 reports\*\*/);
  assert.match(output, /DAST summary gate failed/);
});

test("an invalid report fails the gate when all three current-run reports are present", () => {
  const { markdown, exitCode, output } = summarize({
    "unauthenticated-api": report(),
    "authenticated-api": { alerts: [] },
    preview: report(),
  }, 1);
  assert.equal(exitCode, 1);
  assert.match(markdown, /\| unauthenticated-api \| 0 \| 0 \| 0 \| 0 \| 0 \| parsed \|/);
  assert.match(markdown, /\| authenticated-api \|.*\| invalid \|/);
  assert.match(markdown, /\| preview \| 0 \| 0 \| 0 \| 0 \| 0 \| parsed \|/);
  assert.match(markdown, /\*\*2\/3 reports\*\*/);
  assert.match(output, /DAST summary gate failed/);
});
