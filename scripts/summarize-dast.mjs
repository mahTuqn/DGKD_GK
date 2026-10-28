import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const reportDirectory = path.resolve("reports/generated/dast");
const reportPattern = /^(unauthenticated-api|authenticated-api|preview)-\d{14}-[a-f0-9]{8}\.json$/;
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

const reports = reportKinds.map((kind) => ({ kind, counts: emptyCounts(), status: "missing" }));
const errors = [];
let files = [];
try {
  files = readdirSync(reportDirectory).filter((file) => reportPattern.test(file));
} catch (error) {
  errors.push(error instanceof Error ? error.message : "report directory unavailable");
}

for (const file of files) {
  const kind = reportPattern.exec(file)?.[1];
  const report = reports.find((item) => item.kind === kind);
  if (!report) continue;
  try {
    const document = JSON.parse(readFileSync(path.join(reportDirectory, file), "utf8"));
    if (!Array.isArray(document.site)) throw new Error("ZAP report has no site array");
    const alerts = document.site.flatMap((site) => Array.isArray(site.alerts) ? site.alerts : []);
    for (const alert of alerts) report.counts[classify(alert)] += 1;
    report.status = "parsed";
  } catch {
    report.status = "invalid";
    errors.push(`${kind}: report missing required JSON structure`);
  }
}

const totals = emptyCounts();
for (const report of reports) {
  if (report.status === "parsed") for (const severity of severityNames) totals[severity] += report.counts[severity];
}

const header = "| Scan | High | Medium | Low | Informational | Unknown | Status |";
const separator = "|---|---:|---:|---:|---:|---:|---|";
const rows = reports.map((report) => `| ${report.kind} | ${report.counts.High} | ${report.counts.Medium} | ${report.counts.Low} | ${report.counts.Informational} | ${report.counts.Unknown} | ${report.status} |`);
rows.push(`| **Parsed total** | **${totals.High}** | **${totals.Medium}** | **${totals.Low}** | **${totals.Informational}** | **${totals.Unknown}** | **${reports.filter((report) => report.status === "parsed").length}/${reports.length} reports** |`);
const incomplete = reports.some((report) => report.status !== "parsed");
const note = incomplete
  ? "At least one current-run report is missing or invalid; missing/invalid reports are not counted as zero findings. Review the scan and artifact before interpreting the totals."
  : "Counts are ZAP alert instances from the current run only. Alert names, request URLs, and payloads are intentionally omitted from this summary.";
const markdown = [`### DAST severity summary`, "", header, separator, ...rows, "", note].join("\n");

console.log("DAST severity summary (alert counts only; no alert names, URLs, or payloads):");
for (const report of reports) {
  console.log(`- ${report.kind}: ${severityNames.map((severity) => `${severity} ${report.counts[severity]}`).join(", ")} (${report.status})`);
}
console.log(`- Parsed total: ${severityNames.map((severity) => `${severity} ${totals[severity]}`).join(", ")}`);
if (errors.length) for (const error of errors) console.warn(`DAST summary note: ${error}`);
appendSummary(markdown);
