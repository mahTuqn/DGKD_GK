const value = process.env.DATABASE_URL_WORKER_PROCESS_TEST;

function fail(reason) {
  console.error(`Worker soak database preflight failed: ${reason}`);
  process.exit(1);
}

if (!value) {
  fail("set DATABASE_URL_WORKER_PROCESS_TEST to a dedicated loopback PostgreSQL database named cinema_worker_soak or cinema_worker_soak_*.");
}

let url;
try {
  url = new URL(value);
} catch {
  fail("DATABASE_URL_WORKER_PROCESS_TEST is not a valid PostgreSQL URL.");
}

if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
  fail("DATABASE_URL_WORKER_PROCESS_TEST must use the PostgreSQL protocol.");
}

if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase())) {
  fail("the extended worker soak is local-only; use a loopback database host.");
}

const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
if (!/^cinema_worker_soak(?:_[a-z0-9][a-z0-9_-]*)?$/i.test(databaseName)) {
  fail("the database name must start with cinema_worker_soak to keep the gate isolated from application and demo databases.");
}

console.log("Worker soak database preflight passed: loopback PostgreSQL and dedicated cinema_worker_soak database name.");
