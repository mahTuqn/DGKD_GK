import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const clientImage = "postgres:17";
const testId = "TC-OPS-02";
const sourceUrl = process.env.RESTORE_TEST_SOURCE_URL;
const targetUrl = process.env.RESTORE_TEST_TARGET_URL;

assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "This destructive-target smoke test is restricted to a disposable GitHub Actions PostgreSQL service.",
);
assert.equal(process.env.CI, "true", "CI must be enabled for the restore smoke test.");
assert(sourceUrl, "RESTORE_TEST_SOURCE_URL is required.");
assert(targetUrl, "RESTORE_TEST_TARGET_URL is required.");

function parseConnection(label, rawUrl) {
  const url = new URL(rawUrl);
  assert(
    url.protocol === "postgresql:" || url.protocol === "postgres:",
    `${label} must use a PostgreSQL URL.`,
  );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  assert(
    ["localhost", "127.0.0.1", "::1"].includes(host),
    `${label} must use a loopback host; remote databases are refused.`,
  );

  const database = decodeURIComponent(url.pathname.slice(1));
  assert(database, `${label} must include a database name.`);

  return {
    host,
    port: url.port || "5432",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

const source = parseConnection("RESTORE_TEST_SOURCE_URL", sourceUrl);
const target = parseConnection("RESTORE_TEST_TARGET_URL", targetUrl);
assert.equal(source.database, "cinema", "The source must be the disposable CI seed database.");
assert.match(
  target.database,
  /^cinema_restore_target_\d+_\d+$/,
  "The target must be a run-specific disposable database.",
);
assert.equal(target.database === source.database, false, "Source and target must be different databases.");
assert.equal(target.host, source.host, "Source and target must use the same local PostgreSQL service.");
assert.equal(target.port, source.port, "Source and target must use the same local PostgreSQL service.");
assert.equal(target.username, source.username, "Source and target must use the same CI role.");
assert.equal(target.password, source.password, "Source and target must use the same CI role.");

const tempDirectory = mkdtempSync(join(tmpdir(), "cinema-backup-restore-"));
const dumpPath = join(tempDirectory, "cinema.dump");
const containerDumpPath = "/backup/cinema.dump";
const childEnv = { ...process.env, PGPASSWORD: source.password };
let targetCreated = false;
let failure;

function runPgTool(tool, args, { input, allowFailure = false } = {}) {
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "host",
      "--env",
      "PGPASSWORD",
      "--volume",
      `${tempDirectory}:/backup`,
      clientImage,
      tool,
      "--no-password",
      "--host",
      source.host,
      "--port",
      source.port,
      "--username",
      source.username,
      ...args,
    ],
    { env: childEnv, encoding: "utf8", input, maxBuffer: 8 * 1024 * 1024 },
  );

  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`
      .replaceAll(source.password, "[REDACTED]")
      .trim();
    throw new Error(`${tool} exited with status ${result.status}: ${detail}`);
  }
  return result;
}

function psql(connection, sql) {
  return runPgTool(
    "psql",
    [
      "--no-psqlrc",
      "--quiet",
      "--no-align",
      "--tuples-only",
      "--dbname",
      connection.database,
      "--command",
      sql,
    ],
  ).stdout.trim();
}

function relationCounts(connection) {
  const sql = [
    "\\set ON_ERROR_STOP on",
    "\\pset format unaligned",
    "\\pset tuples_only on",
    "\\pset fieldsep '|'",
    "SELECT format(",
    "  'SELECT %L, count(*)::text FROM %I.%I',",
    "  format('%I.%I', schemaname, tablename), schemaname, tablename",
    ")",
    "FROM pg_catalog.pg_tables",
    "WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
    "ORDER BY schemaname, tablename;",
    "\\gexec",
  ].join("\n");
  const output = runPgTool(
    "psql",
    ["--no-psqlrc", "--quiet", "--dbname", connection.database, "--file", "-"],
    { input: sql },
  ).stdout;

  const counts = new Map();
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const separator = line.lastIndexOf("|");
    assert(separator > 0, `Unexpected relation-count output: ${line}`);
    counts.set(line.slice(0, separator), BigInt(line.slice(separator + 1)));
  }
  return counts;
}

function totalRows(counts) {
  return [...counts.values()].reduce((sum, count) => sum + count, 0n);
}

function countsForComparison(counts) {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => [name, count.toString()]);
}

try {
  const existingTarget = psql(
    source,
    `SELECT count(*) FROM pg_catalog.pg_database WHERE datname = '${target.database}';`,
  );
  assert.equal(existingTarget, "0", "Refusing to overwrite an existing restore target database.");

  const sourceEncoding = psql(source, "SHOW server_encoding;");
  assert.equal(sourceEncoding, "UTF8", "The source database must be UTF8.");
  const sourceCounts = relationCounts(source);
  assert(sourceCounts.size > 0, "The seeded source database has no user tables.");
  assert(totalRows(sourceCounts) > 0n, "The seeded source database has no rows to restore.");

  runPgTool("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    source.database,
    "--file",
    containerDumpPath,
  ]);
  assert(statSync(dumpPath).size > 0, "pg_dump created an empty archive.");

  runPgTool("createdb", [
    "--maintenance-db",
    source.database,
    "--template",
    "template0",
    "--encoding",
    "UTF8",
    target.database,
  ]);
  targetCreated = true;

  runPgTool("pg_restore", [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    target.database,
    containerDumpPath,
  ]);

  const targetEncoding = psql(target, "SHOW server_encoding;");
  assert.equal(targetEncoding, "UTF8", "The restored target database must be UTF8.");
  const targetCounts = relationCounts(target);
  assert.deepEqual(
    countsForComparison(targetCounts),
    countsForComparison(sourceCounts),
    "Restored user-table row counts must match the source database.",
  );

  console.log(
    `${testId} backup/restore smoke passed: ${sourceCounts.size} user tables, ${totalRows(sourceCounts)} rows, UTF8 source/target.`,
  );
} catch (error) {
  failure = error;
} finally {
  if (targetCreated) {
    try {
      runPgTool("dropdb", ["--if-exists", "--force", "--maintenance-db", source.database, target.database]);
    } catch (error) {
      failure ??= error;
    }
  }
  rmSync(tempDirectory, { recursive: true, force: true });
}

if (failure) {
  console.error(failure.stack ?? failure.message ?? failure);
  process.exitCode = 1;
}
