import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const raceDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

type HttpResult = {
  status: number;
  body: Record<string, unknown>;
  requestId: string | undefined;
};

type LockTable = "Showtime" | "Auditorium";
type RequestKind = "hold" | "edit" | "create";
type RacedRequest = { kind: RequestKind; start: () => Promise<HttpResult> };

function observe(response: { status: number; body: unknown; headers: Record<string, string | string[] | undefined> }): HttpResult {
  return {
    status: response.status,
    body: response.body as Record<string, unknown>,
    requestId: typeof response.headers["x-request-id"] === "string" ? response.headers["x-request-id"] : undefined
  };
}

function modeFor(kind: RequestKind): "SHARE" | "UPDATE" {
  return kind === "hold" ? "SHARE" : "UPDATE";
}

async function findWaitingShowtimeQuery(
  table: LockTable,
  mode: "SHARE" | "UPDATE",
  queryStartedAt: Date,
  deadline: number,
  blockerPid?: number
) {
  while (Date.now() < deadline) {
    const pattern = `%FROM "${table}"%`;
    const lockPattern = `%FOR ${mode}%`;
    const waiting = blockerPid === undefined
      ? await prisma.$queryRaw<Array<{ pid: number; query: string }>>`
        SELECT pid::int AS pid, query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query_start >= ${queryStartedAt}
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query ILIKE ${pattern}
          AND query ILIKE ${lockPattern}
      `
      : await prisma.$queryRaw<Array<{ pid: number; query: string }>>`
        SELECT pid::int AS pid, query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> ${blockerPid}
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query_start >= ${queryStartedAt}
          AND ${blockerPid} = ANY(pg_blocking_pids(pid))
          AND query ILIKE ${pattern}
          AND query ILIKE ${lockPattern}
      `;
    if (waiting.length > 0) return waiting;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

async function runBehindRowLock(table: LockTable, rowId: string, requests: [RacedRequest, RacedRequest]): Promise<[HttpResult, HttpResult]> {
  let signalLocked!: (pid: number) => void;
  let rejectLocked!: (error: unknown) => void;
  let releaseLock!: () => void;
  const locked = new Promise<number>((resolve, reject) => { signalLocked = resolve; rejectLocked = reject; });
  const waitForRelease = new Promise<void>((resolve) => { releaseLock = resolve; });
  const barrierTransaction = prisma.$transaction(async (tx) => {
    if (table === "Showtime") {
      await tx.$queryRaw`SELECT "id" FROM "Showtime" WHERE "id" = ${rowId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT "id" FROM "Auditorium" WHERE "id" = ${rowId} FOR UPDATE`;
    }
    const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    signalLocked(connection!.pid);
    await waitForRelease;
  }, { timeout: 20_000 }).catch((error: unknown) => {
    rejectLocked(error);
    throw error;
  });

  const pendingRequests: Array<Promise<HttpResult>> = [];
  try {
    const blockerPid = await locked;
    // Keep both probes within one deadline, below Prisma's default transaction timeout.
    const deadline = Date.now() + 4_000;
    for (let index = 0; index < requests.length; index += 1) {
      const requestStartedAt = new Date();
      const pending = requests[index]!.start();
      pendingRequests.push(pending);
      const waiting = await findWaitingShowtimeQuery(
        table,
        modeFor(requests[index]!.kind),
        requestStartedAt,
        deadline,
        index === 0 ? blockerPid : undefined
      );
      expect(waiting.length, `${requests[index]!.kind} request ${index + 1} must reach its ${table} row-lock wait`).toBeGreaterThan(0);
    }
    releaseLock();
    await barrierTransaction;
    const responses = await Promise.all(pendingRequests);
    if (responses.length !== 2) throw new Error(`Expected two raced requests, received ${responses.length}`);
    return [responses[0]!, responses[1]!];
  } finally {
    releaseLock();
    await barrierTransaction.catch(() => undefined);
    await Promise.all(pendingRequests.map((pending) => pending.catch(() => undefined)));
  }
}

raceDescribe("Showtime edits serialize with holds and schedule creation", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  const seatIds: string[] = [];
  const auditoriumIds: string[] = [];
  const showtimeIds: string[] = [];
  let cinemaId: string | undefined;
  let movieId: string | undefined;
  let roomAId: string | undefined;
  let roomBId: string | undefined;
  let seatAId: string | undefined;
  let seatBId: string | undefined;
  let firstShowtimeId: string | undefined;
  let secondShowtimeId: string | undefined;
  let scheduleRaceStartAt: Date | undefined;
  let customerAId: string | undefined;
  let customerBId: string | undefined;
  let adminId: string | undefined;
  let customerAToken: string;
  let customerBToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({
      data: { name: `Showtime lock ${fixture}`, city: "Test", address: "Isolated showtime lock fixture", status: RecordStatus.ACTIVE }
    });
    cinemaId = cinema.id;
    const roomA = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Showtime room A ${fixture}` } });
    roomAId = roomA.id;
    auditoriumIds.push(roomA.id);
    const roomB = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Showtime room B ${fixture}` } });
    roomBId = roomB.id;
    auditoriumIds.push(roomB.id);
    const seatA = await prisma.seat.create({
      data: { auditoriumId: roomA.id, label: "A1", row: "A", column: 1, type: SeatType.STANDARD }
    });
    seatAId = seatA.id;
    seatIds.push(seatA.id);
    const seatB = await prisma.seat.create({
      data: { auditoriumId: roomB.id, label: "B1", row: "B", column: 1, type: SeatType.STANDARD }
    });
    seatBId = seatB.id;
    seatIds.push(seatB.id);

    const movie = await prisma.movie.create({
      data: {
        slug: `showtime-lock-${fixture}`,
        title: `Showtime lock ${fixture}`,
        genre: "Test",
        synopsis: "Isolated fixture for showtime-edit and hold serialization.",
        runtimeMinutes: 90,
        ageRating: "P"
      }
    });
    movieId = movie.id;
    const firstStartAt = new Date(Date.now() + 370 * 86_400_000);
    const secondStartAt = new Date(firstStartAt.getTime() + 2 * 86_400_000);
    const durationMs = movie.runtimeMinutes * 60_000;
    const firstShowtime = await prisma.showtime.create({
      data: {
        movieId: movie.id,
        auditoriumId: roomA.id,
        startAt: firstStartAt,
        endAt: new Date(firstStartAt.getTime() + durationMs),
        priceVnd: 100_000,
        premiumSurchargeVnd: 30_000
      }
    });
    firstShowtimeId = firstShowtime.id;
    showtimeIds.push(firstShowtime.id);
    const secondShowtime = await prisma.showtime.create({
      data: {
        movieId: movie.id,
        auditoriumId: roomA.id,
        startAt: secondStartAt,
        endAt: new Date(secondStartAt.getTime() + durationMs),
        priceVnd: 100_000,
        premiumSurchargeVnd: 30_000
      }
    });
    secondShowtimeId = secondShowtime.id;
    showtimeIds.push(secondShowtime.id);
    scheduleRaceStartAt = new Date(secondStartAt.getTime() + 2 * 86_400_000);

    const customerA = await prisma.user.create({ data: { name: "Showtime Race Customer A", email: `showtime-race-a-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    customerAId = customerA.id;
    userIds.push(customerA.id);
    const customerB = await prisma.user.create({ data: { name: "Showtime Race Customer B", email: `showtime-race-b-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    customerBId = customerB.id;
    userIds.push(customerB.id);
    const admin = await prisma.user.create({ data: { name: "Showtime Race Admin", email: `showtime-race-admin-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN } });
    adminId = admin.id;
    userIds.push(admin.id);
    customerAToken = createToken({ id: customerA.id, authVersion: customerA.authVersion });
    customerBToken = createToken({ id: customerB.id, authVersion: customerB.authVersion });
    adminToken = createToken({ id: admin.id, authVersion: admin.authVersion });
    expect(scheduleRaceStartAt!.getTime()).toBeGreaterThan(secondShowtime.endAt.getTime() + 20 * 60_000);
  }, 20_000);

  afterAll(async () => {
    try {
      const createdAtRaceTime = roomAId && scheduleRaceStartAt
        ? await prisma.showtime.findMany({ where: { auditoriumId: roomAId, startAt: scheduleRaceStartAt }, select: { id: true } })
        : [];
      const fixtureShowtimeIds = [...new Set([...showtimeIds, ...createdAtRaceTime.map((showtime) => showtime.id)])];
      if (fixtureShowtimeIds.length) {
        const orders = await prisma.cinemaOrder.findMany({ where: { showtimeId: { in: fixtureShowtimeIds } }, select: { id: true } });
        const orderIds = orders.map((order) => order.id);
        if (orderIds.length) {
          await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.seatClaim.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.cinemaOrder.deleteMany({ where: { id: { in: orderIds } } });
        }
        await prisma.seatClaim.deleteMany({ where: { showtimeId: { in: fixtureShowtimeIds } } });
        await prisma.seatHold.deleteMany({ where: { showtimeId: { in: fixtureShowtimeIds } } });
        await prisma.showtime.deleteMany({ where: { id: { in: fixtureShowtimeIds } } });
      }
      if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      if (seatIds.length) await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
      if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
      if (auditoriumIds.length) await prisma.auditorium.deleteMany({ where: { id: { in: auditoriumIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    } finally {
      await prisma.$disconnect();
    }
  }, 20_000);

  it("[TC-SEC-43] serializes showtime identity edits against seat holds", async () => {
    const showtimeFields = { id: true, movieId: true, auditoriumId: true, startAt: true, endAt: true, priceVnd: true, premiumSurchargeVnd: true, status: true } as const;
    const claimFields = { id: true, showtimeId: true, seatId: true, holdId: true, orderId: true, status: true, expiresAt: true, priceVnd: true } as const;
    const holdFields = { id: true, userId: true, showtimeId: true, status: true, expiresAt: true } as const;
    const auditFields = { actorId: true, action: true, entity: true, entityId: true, metadata: true } as const;

    const beforeEditFirst = await prisma.showtime.findUniqueOrThrow({ where: { id: firstShowtimeId! }, select: showtimeFields });
    expect(await prisma.seatClaim.findMany({ where: { showtimeId: firstShowtimeId }, select: claimFields })).toEqual([]);
    const [editFirst, holdAfterEdit] = await runBehindRowLock("Showtime", firstShowtimeId!, [
      {
        kind: "edit",
        start: () => request(app).patch(`/api/admin/showtimes/${firstShowtimeId}`).set({ Authorization: `Bearer ${adminToken}` })
          .send({ auditoriumId: roomBId, priceVnd: 150_000 }).then(observe)
      },
      {
        kind: "hold",
        start: () => request(app).post("/api/holds").set({ Authorization: `Bearer ${customerAToken}` })
          .send({ showtimeId: firstShowtimeId, seatIds: [seatBId] }).then(observe)
      }
    ]);

    expect(editFirst.status).toBe(200);
    expect(holdAfterEdit.status).toBe(201);
    expect(holdAfterEdit.body.totalVnd).toBe(150_000);
    expect(editFirst.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(holdAfterEdit.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await prisma.showtime.findUniqueOrThrow({ where: { id: firstShowtimeId! }, select: showtimeFields }))
      .toEqual({ ...beforeEditFirst, auditoriumId: roomBId, priceVnd: 150_000 });
    expect(await prisma.seatClaim.findMany({ where: { showtimeId: firstShowtimeId }, select: claimFields })).toEqual([{
      id: expect.any(String),
      showtimeId: firstShowtimeId,
      seatId: seatBId,
      holdId: String(holdAfterEdit.body.id),
      orderId: null,
      status: ClaimStatus.HELD,
      expiresAt: new Date(String(holdAfterEdit.body.expiresAt)),
      priceVnd: 150_000
    }]);
    expect(await prisma.seatHold.findMany({ where: { userId: customerAId }, select: holdFields })).toEqual([{
      id: String(holdAfterEdit.body.id),
      userId: customerAId,
      showtimeId: firstShowtimeId,
      status: HoldStatus.HELD,
      expiresAt: new Date(String(holdAfterEdit.body.expiresAt))
    }]);
    expect(await prisma.auditLog.findMany({ where: { actorId: adminId!, action: "SHOWTIME_UPDATED", entityId: firstShowtimeId }, select: auditFields })).toEqual([{
      actorId: adminId,
      action: "SHOWTIME_UPDATED",
      entity: "Showtime",
      entityId: firstShowtimeId,
      metadata: { changedFields: ["auditoriumId", "priceVnd"], priceVnd: 150_000, premiumSurchargeVnd: 30_000, correlationId: editFirst.requestId }
    }]);
    expect(await prisma.auditLog.findMany({ where: { actorId: customerAId!, action: "SEATS_HELD", entityId: String(holdAfterEdit.body.id) }, select: auditFields })).toEqual([{
      actorId: customerAId,
      action: "SEATS_HELD",
      entity: "SeatHold",
      entityId: String(holdAfterEdit.body.id),
      metadata: { showtimeId: firstShowtimeId, seatIds: [seatBId], totalVnd: 150_000, correlationId: holdAfterEdit.requestId }
    }]);

    const beforeHoldFirst = await prisma.showtime.findUniqueOrThrow({ where: { id: secondShowtimeId! }, select: showtimeFields });
    const customerBAuditsBefore = await prisma.auditLog.findMany({ where: { actorId: customerBId!, action: "SEATS_HELD" }, select: auditFields });
    const [holdFirst, rejectedIdentityEdit] = await runBehindRowLock("Showtime", secondShowtimeId!, [
      {
        kind: "hold",
        start: () => request(app).post("/api/holds").set({ Authorization: `Bearer ${customerBToken}` })
          .send({ showtimeId: secondShowtimeId, seatIds: [seatAId] }).then(observe)
      },
      {
        kind: "edit",
        start: () => request(app).patch(`/api/admin/showtimes/${secondShowtimeId}`).set({ Authorization: `Bearer ${adminToken}` })
          .send({ auditoriumId: roomBId, priceVnd: 250_000 }).then(observe)
      }
    ]);

    expect(holdFirst.status).toBe(201);
    expect(holdFirst.body.totalVnd).toBe(100_000);
    expect(rejectedIdentityEdit.status).toBe(409);
    expect(rejectedIdentityEdit.body.error).toBe("SHOWTIME_HAS_BOOKINGS");
    expect(rejectedIdentityEdit.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await prisma.showtime.findUniqueOrThrow({ where: { id: secondShowtimeId! }, select: showtimeFields })).toEqual(beforeHoldFirst);
    expect(await prisma.seatHold.findMany({ where: { userId: customerBId }, select: holdFields })).toEqual([{
      id: String(holdFirst.body.id),
      userId: customerBId,
      showtimeId: secondShowtimeId,
      status: HoldStatus.HELD,
      expiresAt: new Date(String(holdFirst.body.expiresAt))
    }]);
    expect(await prisma.seatClaim.findMany({ where: { showtimeId: secondShowtimeId }, select: claimFields })).toEqual([{
      id: expect.any(String),
      showtimeId: secondShowtimeId,
      seatId: seatAId,
      holdId: String(holdFirst.body.id),
      orderId: null,
      status: ClaimStatus.HELD,
      expiresAt: new Date(String(holdFirst.body.expiresAt)),
      priceVnd: 100_000
    }]);
    expect(await prisma.auditLog.findMany({ where: { actorId: adminId!, action: "SHOWTIME_UPDATED", entityId: secondShowtimeId }, select: auditFields })).toEqual([]);
    expect(await prisma.auditLog.findMany({ where: { actorId: customerBId!, action: "SEATS_HELD" }, select: auditFields })).toHaveLength(customerBAuditsBefore.length + 1);
    expect(await prisma.auditLog.findMany({ where: { actorId: customerBId!, action: "SEATS_HELD", entityId: String(holdFirst.body.id) }, select: auditFields })).toEqual([{
      actorId: customerBId,
      action: "SEATS_HELD",
      entity: "SeatHold",
      entityId: String(holdFirst.body.id),
      metadata: { showtimeId: secondShowtimeId, seatIds: [seatAId], totalVnd: 100_000, correlationId: holdFirst.requestId }
    }]);
  }, 60_000);

  it("[TC-SEC-44] keeps showtime overlap rejection deterministic with READ COMMITTED room locks", async () => {
    const startAt = scheduleRaceStartAt!;
    const createShowtime = () => request(app).post("/api/admin/showtimes").set({ Authorization: `Bearer ${adminToken}` }).send({
      movieId,
      auditoriumId: roomAId,
      startAt: startAt.toISOString(),
      priceVnd: 100_000
    }).then(observe);
    const [firstCreate, overlappingCreate] = await runBehindRowLock("Auditorium", roomAId!, [
      { kind: "create", start: createShowtime },
      { kind: "create", start: createShowtime }
    ]);

    for (const response of [firstCreate, overlappingCreate]) {
      if (response.status === 201 && typeof response.body.id === "string") showtimeIds.push(response.body.id);
    }
    expect(firstCreate.status).toBe(201);
    expect(overlappingCreate.status).toBe(409);
    expect(overlappingCreate.body.error).toBe("SHOWTIME_OVERLAP");
    expect(firstCreate.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(overlappingCreate.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await prisma.showtime.count({ where: { auditoriumId: roomAId!, startAt } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: adminId!, action: "SHOWTIME_CREATED", entityId: String(firstCreate.body.id) } })).toBe(1);
  }, 60_000);
});
