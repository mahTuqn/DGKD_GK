import { appendFileSync, existsSync, readFileSync } from "node:fs";

const reportPath = "reports/generated/mutation/mutation.json";
const logPath = "backend/stryker.log";
const counts = new Map();
let report = null;

if (existsSync(reportPath)) {
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
    for (const file of Object.values(report.files ?? {})) {
      for (const mutant of Object.values(file.mutants ?? {})) {
        const status = String(mutant.status ?? "Unknown");
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
    }
  } catch {
    report = null;
  }
}

const killed = counts.get("Killed") ?? 0;
const scoredStatuses = ["Killed", "Survived", "Timeout", "RuntimeError", "CompileError"];
const scoredMutants = scoredStatuses.reduce((total, status) => total + (counts.get(status) ?? 0), 0);
const score = scoredMutants ? `${((killed / scoredMutants) * 100).toFixed(2)}%` : "unavailable";
const threshold = report?.thresholds?.break ?? report?.config?.thresholds?.break ?? "unknown";
const statusSummary = [...counts.entries()].map(([status, count]) => `${status.toLowerCase()}=${count}`).join(", ") || "no mutant statuses";

let errorDetails = "no Stryker error log";
if (existsSync(logPath)) {
  const errorLines = readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => /\b(error|fatal|unhandled)\b/i.test(line))
    .slice(-2)
    .map((line) => line
      .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[redacted]@")
      .replace(/(password|secret|token)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]")
      .slice(0, 220));
  errorDetails = errorLines.join(" | ") || "Stryker error log exists; no error-level line was recorded";
}

const message = report
  ? `Mutation report present: score=${score}; breakThreshold=${threshold}; ${statusSummary}. ${errorDetails}`
  : `Mutation report missing or unreadable; breakThreshold=${threshold}. ${errorDetails}`;
const summary = `### Mutation diagnostics\n\n${message}\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);

const workflowMessage = message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
console.log(`::notice title=Mutation diagnostics::${workflowMessage}`);
