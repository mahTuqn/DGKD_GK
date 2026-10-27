import { PrismaClient } from "@prisma/client";

const runId = process.argv[2]?.toLowerCase();
if (!runId || !/^[a-z0-9-]{1,48}$/.test(runId)) {
  console.error("Usage: DATABASE_URL=<isolated-db> node tests/non-functional/k6/cleanup-fixtures.mjs <RUN_ID>");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("Refusing to clean k6 fixtures without DATABASE_URL pointing at the test database.");
  process.exit(2);
}

const prisma = new PrismaClient();

try {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: `k6perf-${runId}-`, endsWith: "@example.test" } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (userIds.length === 0) {
    console.info(`No k6 fixtures found for run ${runId}.`);
    process.exitCode = 0;
  } else {
    const orders = await prisma.cinemaOrder.count({ where: { userId: { in: userIds } } });
    if (orders > 0) {
      throw new Error(`Refusing cleanup: found ${orders} order(s) for this run; review them manually first.`);
    }
    const holds = await prisma.seatHold.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const holdIds = holds.map(({ id }) => id);

    const result = await prisma.$transaction(async (tx) => {
      const claims = await tx.seatClaim.deleteMany({ where: { holdId: { in: holdIds } } });
      const audit = await tx.auditLog.deleteMany({ where: { actorId: { in: userIds }, action: "SEATS_HELD" } });
      const deletedHolds = await tx.seatHold.deleteMany({ where: { id: { in: holdIds } } });
      const deletedUsers = await tx.user.deleteMany({ where: { id: { in: userIds } } });
      return { claims: claims.count, audit: audit.count, holds: deletedHolds.count, users: deletedUsers.count };
    });
    console.info(`Cleaned k6 run ${runId}: ${JSON.stringify(result)}.`);
  }
} catch (error) {
  console.error("k6 fixture cleanup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
