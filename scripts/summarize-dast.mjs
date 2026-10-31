import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const reportDirectory = path.resolve(process.env.DAST_REPORT_DIRECTORY || "reports/generated/dast");
const reportPattern = /^(unauthenticated-api|authenticated-api|preview)-(\d{14}-[a-f0-9]{8})\.json$/;
const reportKinds = ["unauthenticated-api", "authenticated-api", "preview"];
const severityNames = ["High", "Medium", "Low", "Informational", "Unknown"];
const severityByCode = new Map([["3", "High"], ["2", "Medium"], ["1", "Low"], ["0", "Informational"]]);

function emptyCounts() {
  return Object.fromEntries(severityNames.map((severity) => [severity, 0]));
}

function classify(alert) {
  const description = String(alert?.riskdesc ?? "").trim();
  const fromDescription = severityNames.find((severity) => new RegExp(`^${severity}(?:\\s|$)`, "i").test(description));
  return fromDescription || severityByCode.get(String(alert?.riskcode ?? "")) || "Unknown";
}

function appendSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, `${markdown}\n`, { encoding: "utf8" });
  } catch (error) {
    console.warn(`Could not append the DAST summary to GitHub Actions: ${error instanceof Error ? error.message : "unknown file error"}`);
  }
}

const reports = reportKinds.map((kind) => ({
  kind,
  alertCounts: emptyCounts(),
  instanceCounts: emptyCounts(),
  rules: new Map(),
  status: "missing",
}));
const errors = [];
let files = [];
try {
  const manifest = JSON.parse(readFileSync(path.join(reportDirectory, "current-run.json"), "utf8"));
  const runSuffix = String(manifest?.runSuffix ?? "");
  if (!/^\d{14}-[a-f0-9]{8}$/.test(runSuffix)) throw new Error("current-run manifest is invalid");
  files = readdirSync(reportDirectory).filter((file) => {
    const match = reportPattern.exec(file);
    return match?.[2] === runSuffix;
  });
} catch (error) {
  errors.push("current-run manifest unavailable or invalid");
}

for (const file of files) {
  const kind = reportPattern.exec(file)?.[1];
  const report = reports.find((item) => item.kind === kind);
  if (!report) continue;
  try {
    const document = JSON.parse(readFileSync(path.join(reportDirectory, file), "utf8"));
    if (!Array.isArray(document.site) || document.site.length === 0) throw new Error("ZAP report has no scanned sites");
    const alerts = document.site.flatMap((site) => Array.isArray(site.alerts) ? site.alerts : []);
    for (const alert of alerts) {
      const severity = classify(alert);
      report.alertCounts[severity] += 1;
      report.instanceCounts[severity] += Array.isArray(alert.instances) ? alert.instances.length : 0;
      // Only allow a numeric rule identifier into the public summary. Alert
      // names and other free-form report fields can contain request data.
      const candidate = String(alert.pluginid ?? "");
      const pluginId = /^\d{1,10}$/.test(candidate) ? candidate : "Unknown";
      const key = `${pluginId}:${severity}`;
      const rule = report.rules.get(key) || { pluginId, severity, records: 0, instances: 0 };
      rule.records += 1;
      rule.instances += Array.isArray(alert.instances) ? alert.instances.length : 0;
      report.rules.set(key, rule);
    }
    report.status = "parsed";
  } catch {
    report.status = "invalid";
    errors.push(`${kind}: report missing required JSON structure`);
  }
}

const alertTotals = emptyCounts();
const instanceTotals = emptyCounts();
for (const report of reports) {
  if (report.status !== "parsed") continue;
  for (const severity of severityNames) {
    alertTotals[severity] += report.alertCounts[severity];
    instanceTotals[severity] += report.instanceCounts[severity];
  }
}

const header = "| Scan | High | Medium | Low | Informational | Unknown | Status |";
const separator = "|---|---:|---:|---:|---:|---:|---|";
function rowsFor(countsKey, totals, unit) {
  const rows = reports.map((report) => `| ${report.kind} | ${report[countsKey].High} | ${report[countsKey].Medium} | ${report[countsKey].Low} | ${report[countsKey].Informational} | ${report[countsKey].Unknown} | ${report.status} |`);
  rows.push(`| **Parsed total (${unit})** | **${totals.High}** | **${totals.Medium}** | **${totals.Low}** | **${totals.Informational}** | **${totals.Unknown}** | **${reports.filter((report) => report.status === "parsed").length}/${reports.length} reports** |`);
  return rows;
}
const incomplete = reports.some((report) => report.status !== "parsed");
const ruleRows = reports.flatMap((report) => [...report.rules.values()]
  .sort((a, b) => a.pluginId.localeCompare(b.pluginId, "en", { numeric: true }) || a.severity.localeCompare(b.severity))
  .map((rule) => `| ${report.kind} | ${rule.pluginId} | ${rule.severity} | ${rule.records} | ${rule.instances} |`));
const note = incomplete
  ? "At least one current-run report is missing or invalid; missing/invalid reports are not counted as zero findings. Review the scan and artifact before interpreting the totals."
  : "Alert counts are ZAP alert records; instance counts are the entries attached to those alerts. Both cover parsed reports from the current run only. Alert names, request URLs, and payloads are intentionally omitted from this summary.";
const markdown = [
  "### DAST severity summary",
  "",
  "#### Alert records",
  "",
  header,
  separator,
  ...rowsFor("alertCounts", alertTotals, "alert records"),
  "",
  "#### Alert instances",
  "",
  header,
  separator,
  ...rowsFor("instanceCounts", instanceTotals, "instances"),
  "",
  "#### Rule identifiers for triage",
  "",
  "| Scan | ZAP plugin ID | Severity | Alert records | Instances |",
  "|---|---:|---|---:|---:|",
  ...ruleRows,
  "",
  "Only numeric plugin IDs are exposed. Rule IDs identify scan rules; they do not establish exploitability or replace reviewing the report instances. Unknown IDs require artifact review.",
  "",
  note,
].join("\n");

console.log("DAST severity summary (alert records and instances; no alert names, URLs, or payloads):");
for (const report of reports) {
  console.log(`- ${report.kind}: ${report.status}`);
  console.log(`  alert records: ${severityNames.map((severity) => `${severity} ${report.alertCounts[severity]}`).join(", ")}`);
  console.log(`  instances: ${severityNames.map((severity) => `${severity} ${report.instanceCounts[severity]}`).join(", ")}`);
}
console.log(`- Parsed alert-record total: ${severityNames.map((severity) => `${severity} ${alertTotals[severity]}`).join(", ")}`);
console.log(`- Parsed instance total: ${severityNames.map((severity) => `${severity} ${instanceTotals[severity]}`).join(", ")}`);
if (errors.length) for (const error of errors) console.warn(`DAST summary note: ${error}`);
appendSummary(markdown);
if (incomplete) {
  console.error("DAST summary gate failed: all three current-run reports must be present and valid JSON before the scan can pass.");
  process.exitCode = 1;
}
