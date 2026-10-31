import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecordStatus, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const databaseDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

async function waitForBlockedQuery(blockerPid: number, queryPattern: string, deadline: number) {
  while (Date.now() < deadline) {
    const waiting = await prisma.$queryRaw<Array<{ pid: number; query: string }>>`
      SELECT pid::int AS pid, query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> ${blockerPid}
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND query ILIKE ${queryPattern}
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `;
    if (waiting.length > 0) return waiting;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

databaseDescribe("Admin read serialization with role revocation", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  let cinemaId: string | undefined;
  let readAdminId: string;
  let revokingAdminId: string;
  let assignedStaffId: string;
  let readAdminToken: string;
  let revokingAdminToken: string;

  beforeAll(async () => {
    await prisma.$connect();

    const cinema = await prisma.cinema.create({
      data: { name: `Admin read race ${fixture}`, city: "Test", address: "Isolated Admin read revocation fixture", status: RecordStatus.ACTIVE }
    });
    cinemaId = cinema.id;
    const users = await prisma.user.createManyAndReturn({
      data: [
        { name: "Admin read requester", email: `admin-read-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN },
        { name: "Admin revoker", email: `admin-revoker-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN },
        {
          name: "Assigned staff for user-list relation",
          email: `admin-read-staff-${fixture}@test.local`,
          passwordHash: "unused-test-only",
          role: Role.STAFF,
          assignedCinemaId: cinema.id,
          createdAt: new Date("2000-01-01T00:00:00.000Z")
        }
      ]
    });
    readAdminId = users[0]!.id;
    revokingAdminId = users[1]!.id;
    assignedStaffId = users[2]!.id;
    userIds.push(readAdminId, revokingAdminId, assignedStaffId);
    readAdminToken = createToken({ id: readAdminId, authVersion: users[0]!.authVersion });
    revokingAdminToken = createToken({ id: revokingAdminId, authVersion: users[1]!.authVersion });
  }, 30_000);

  afterAll(async () => {
    if (userIds.length) {
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-SEC-53] keeps Admin user-list reads ahead of a concurrent role revocation", async () => {
    let signalLockAcquired!: (pid: number) => void;
    let rejectLockAcquired!: (error: unknown) => void;
    let releaseCinemaLock!: () => void;
    const lockAcquired = new Promise<number>((resolve, reject) => {
      signalLockAcquired = resolve;
      rejectLockAcquired = reject;
    });
    const waitForRelease = new Promise<void>((resolve) => { releaseCinemaLock = resolve; });
    const cinemaLockTransaction = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Cinema" IN ACCESS EXCLUSIVE MODE`;
      const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      signalLockAcquired(connection!.pid);
      await waitForRelease;
    }, { timeout: 40_000 }).catch((error: unknown) => {
      rejectLockAcquired(error);
      throw error;
    });

    let readPromise: Promise<{ status: number; body: Record<string, unknown> }> | undefined;
    let revocationPromise: Promise<{ status: number; body: Record<string, unknown> }> | undefined;
    let readResponse: { status: number; body: Record<string, unknown> } | undefined;
    let revocationResponse: { status: number; body: Record<string, unknown> } | undefined;
    let readReachedCinemaLock = false;
    let revocationWaitedForRead = false;
    try {
      const lockPid = await lockAcquired;
      readPromise = request(app)
        .get("/api/admin/users")
        .set({ Authorization: `Bearer ${readAdminToken}` })
        .then((response) => ({ status: response.status, body: response.body as Record<string, unknown> }));
      const waitingRead = await waitForBlockedQuery(lockPid, '%"Cinema"%', Date.now() + 8_000);
      readReachedCinemaLock = waitingRead.length > 0;

      if (readReachedCinemaLock) {
        const readerPid = waitingRead[0]!.pid;
        revocationPromise = request(app)
          .patch(`/api/admin/users/${readAdminId}/role`)
          .set({ Authorization: `Bearer ${revokingAdminToken}` })
          .send({ role: Role.CUSTOMER })
          .then((response) => ({ status: response.status, body: response.body as Record<string, unknown> }));
        const waitingRevocation = await waitForBlockedQuery(readerPid, '%FOR UPDATE%', Date.now() + 8_000);
        revocationWaitedForRead = waitingRevocation.some(({ query }) => query.toLowerCase().includes('"user"'));
      }
    } finally {
      releaseCinemaLock();
      await cinemaLockTransaction.catch(() => undefined);
      if (readPromise) readResponse = await readPromise;
      if (revocationPromise) revocationResponse = await revocationPromise;
    }

    expect(readReachedCinemaLock).toBe(true);
    expect(revocationWaitedForRead).toBe(true);
    expect(readResponse?.status).toBe(200);
    expect(readResponse?.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: assignedStaffId, assignedCinemaId: cinemaId })]));
    expect(revocationResponse?.status).toBe(200);
    expect(revocationResponse?.body).toMatchObject({ id: readAdminId, role: Role.CUSTOMER, assignedCinemaId: null });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: readAdminId }, select: { role: true, authVersion: true } }))
      .toEqual({ role: Role.CUSTOMER, authVersion: 1 });

    const staleAdminRead = await request(app).get("/api/admin/users").set({ Authorization: `Bearer ${readAdminToken}` });
    expect(staleAdminRead.status).toBe(401);
    expect(staleAdminRead.body.error).toBe("INVALID_TOKEN");
  }, 50_000);
});
