const databaseUrl = process.env.DATABASE_URL_API_PROCESS_TEST;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL_API_PROCESS_TEST to a dedicated, migrated PostgreSQL database before running the multi-process API race test.");
}

const parsed = new URL(databaseUrl);
if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL_API_PROCESS_TEST must use PostgreSQL.");
}

console.log("Dedicated PostgreSQL URL configured for the multi-process API race test.");
