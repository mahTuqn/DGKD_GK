import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const advisoryUrl = "https://github.com/advisories/GHSA-g3hv-75wg-m249";
const expectedVersions = {
  "node_modules/minimatch": "10.2.6",
  "node_modules/@stryker-mutator/core": "10.1.1",
  "node_modules/@stryker-mutator/vitest-runner": "10.1.1",
};

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(command, ["audit", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  windowsHide: true,
});

if (result.error) {
  console.error(`Could not run npm audit: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("npm audit did not return valid JSON.");
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

if (result.signal !== null || report.error !== undefined || report.errors !== undefined) {
  console.error("npm audit returned an execution or registry error; failing the dependency gate.");
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

if (
  !report.vulnerabilities ||
  typeof report.vulnerabilities !== "object" ||
  Array.isArray(report.vulnerabilities) ||
  typeof report.metadata?.vulnerabilities?.total !== "number"
) {
  console.error("npm audit returned an incomplete report; failing the dependency gate.");
  if (result.stdout) console.error(result.stdout);
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities;
if (
  result.status === 0 &&
  report.metadata.vulnerabilities.total === 0 &&
  Object.keys(vulnerabilities).length === 0
) {
  console.log("npm audit passed: no dependency advisories.");
  process.exit(0);
}

const expectedNames = [
  "@stryker-mutator/core",
  "@stryker-mutator/vitest-runner",
  "minimatch",
];
const exactNames = (value, expected) =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((entry, index) => entry === expected[index]);
const knownFinding = (finding) =>
  finding?.name === "minimatch" &&
  finding?.url === advisoryUrl &&
  finding?.severity === "moderate" &&
  finding?.range === "<11.0.1";

let lock;
try {
  lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
} catch (error) {
  console.error(`Could not read package-lock.json: ${error.message}`);
  process.exit(1);
}

const lockedPackages = lock.packages ?? {};
const exactLockedDevDependencies = Object.entries(expectedVersions).every(([path, version]) => {
  const dependency = lockedPackages[path];
  return dependency?.version === version && dependency.dev === true;
});

const minimatch = vulnerabilities.minimatch;
const core = vulnerabilities["@stryker-mutator/core"];
const runner = vulnerabilities["@stryker-mutator/vitest-runner"];
const exactAdvisoryOnly =
  Object.keys(vulnerabilities).sort().join("|") === expectedNames.join("|") &&
  report.metadata?.vulnerabilities?.total === 3 &&
  report.metadata?.vulnerabilities?.moderate === 3 &&
  report.metadata?.vulnerabilities?.low === 0 &&
  report.metadata?.vulnerabilities?.high === 0 &&
  report.metadata?.vulnerabilities?.critical === 0 &&
  minimatch?.severity === "moderate" &&
  minimatch?.isDirect === false &&
  exactNames(minimatch.nodes, ["node_modules/minimatch"]) &&
  exactNames(minimatch.effects, ["@stryker-mutator/core"]) &&
  minimatch.via.length === 1 &&
  knownFinding(minimatch.via[0]) &&
  core?.severity === "moderate" &&
  core?.isDirect === true &&
  exactNames(core.nodes, ["node_modules/@stryker-mutator/core"]) &&
  exactNames(core.effects, ["@stryker-mutator/vitest-runner"]) &&
  exactNames(core.via, ["minimatch"]) &&
  runner?.severity === "moderate" &&
  runner?.isDirect === true &&
  exactNames(runner.nodes, ["node_modules/@stryker-mutator/vitest-runner"]) &&
  exactNames(runner.effects, []) &&
  exactNames(runner.via, ["@stryker-mutator/core"]);

if (
  result.status === 1 &&
  result.signal === null &&
  result.error === undefined &&
  report.error === undefined &&
  report.errors === undefined &&
  exactAdvisoryOnly &&
  exactLockedDevDependencies
) {
  console.warn(
    "npm audit: allowing the one reviewed moderate dev-only advisory GHSA-g3hv-75wg-m249 " +
      "for minimatch@10.2.6, pulled by Stryker 10.1.1. The pinned Stryker range has no upstream fix yet; " +
      "all other audit findings still fail this gate.",
  );
  process.exit(0);
}

console.error("npm audit found an unreviewed advisory or the known advisory changed; failing the dependency gate.");
if (result.stdout) console.error(result.stdout);
if (result.stderr) console.error(result.stderr);
process.exit(result.status || 1);
