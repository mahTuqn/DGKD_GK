import { PrismaClient } from "@prisma/client";

// Integration tests may point the application itself at an isolated database.
// Normal development and production continue to use DATABASE_URL.
const testDatasourceUrl = process.env.DATABASE_URL_TEST;
export const prisma = new PrismaClient(testDatasourceUrl ? { datasourceUrl: testDatasourceUrl } : undefined);
