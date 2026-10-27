import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) errors.push("CSV chứa dấu nháy kép chưa đóng.");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((item) => item.some((value) => value.trim().length));
}

function loadCsv(file) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) { errors.push(`Thiếu tệp ${file}`); return []; }
  const [header = [], ...rows] = parseCsv(fs.readFileSync(fullPath, "utf8"));
  return rows.map((values, index) => {
    if (values.length !== header.length) errors.push(`${file}:${index + 2} có ${values.length} cột, cần ${header.length}.`);
    return Object.fromEntries(header.map((key, column) => [key, values[column] ?? ""]));
  });
}

const cases = loadCsv("docs/04-test-cases.csv");
const requirements = loadCsv("docs/03-rtm.csv");
const caseIds = new Set();
const codeTestIds = new Map();
for (const row of cases) {
  const id = (row["Test ID"] || row["Test Case ID"]);
  if (!id) errors.push("Test catalog có hàng thiếu Test Case ID.");
  else if (caseIds.has(id)) errors.push(`Test Case ID bị trùng: ${id}`);
  else caseIds.add(id);

  let foundTestIdInSource = false;
  for (const source of (row.Source || "").split(";").map((item) => item.trim()).filter(Boolean)) {
    const fullPath = path.join(root, source);
    const sourceCode = /\.(?:ts|tsx|js|mjs|cjs|yaml|yml)$/.test(source);
    if (sourceCode && !fs.existsSync(fullPath)) {
      errors.push(`${id}: không tìm thấy source ${source}`);
    } else if (sourceCode && fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf8");
      const ids = codeTestIds.get(source) ?? new Set();
      for (const match of content.matchAll(/TC-[A-Z0-9]+-\d{2}/g)) ids.add(match[0]);
      codeTestIds.set(source, ids);
      if (id && ids.has(id)) foundTestIdInSource = true;
    }
  }
  if (/^(?:Tự động|Automated)\b/i.test(row.Implementation || "") && id && !foundTestIdInSource) {
    errors.push(`${id}: không tìm thấy test ID trong các source test được khai báo.`);
  }
}

for (const [source, ids] of codeTestIds) {
  for (const id of ids) if (!caseIds.has(id)) errors.push(`${source}: test ID chưa có trong catalog: ${id}`);
}

const requirementIds = new Set();
const requirementCases = new Map();
for (const row of requirements) {
  const id = row["Requirement ID"];
  if (!id) errors.push("RTM có hàng thiếu Requirement ID.");
  else if (requirementIds.has(id)) errors.push(`Requirement ID bị trùng: ${id}`);
  else requirementIds.add(id);

  const refs = (row["Test IDs"] || "").split(";").map((item) => item.trim()).filter(Boolean);
  if (!refs.length) errors.push(`${id || "RTM row"}: chưa liên kết test case.`);
  requirementCases.set(id, new Set(refs));
  for (const ref of refs) if (!caseIds.has(ref)) errors.push(`${id}: tham chiếu test không tồn tại: ${ref}`);
}

for (const row of cases) {
  const id = (row["Test ID"] || row["Test Case ID"]);
  const refs = (row["Requirement ID"] || "").split(";").map((item) => item.trim()).filter(Boolean);
  if (!refs.length) errors.push(`${id || "Test case"}: chưa liên kết yêu cầu.`);
  for (const ref of refs) {
    if (!requirementIds.has(ref)) errors.push(`${id}: Requirement ID không tồn tại trong RTM: ${ref}`);
    else if (!requirementCases.get(ref)?.has(id)) errors.push(`${id}: thiếu liên kết ngược trong RTM cho ${ref}`);
  }
}

if (errors.length) {
  console.error(`Traceability validation failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Traceability OK: ${cases.length} test cases, ${requirements.length} requirements, all sources and links resolved.`);
}
