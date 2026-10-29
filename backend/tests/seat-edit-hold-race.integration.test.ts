import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const seatRaceDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

type HttpResult = {
  status: number;
  body: Record<string, unknown>;
  requestId: string | undefined;
};

function observe(response: { status: number; body: unknown; headers: Record<string, string | string[] | undefined> }): HttpResult {
  return {
    status: response.status,
    body: response.body as Record<string, unknown>,
    requestId: typeof response.headers["x-request-id"] === "string" ? response.headers["x-request-id"] : undefined
  };
}

async function waitForSeatBlockerQueries(blockerPid: number, count: number) {
  // Keep the barrier shorter than Prisma's default interactive-transaction timeout.
  const deadline = Date.now() + 2_500;
  while (Date.now() < deadline) {
    const blocked = await prisma.$queryRaw<Array<{ pid: number; query: string }>>`
      SELECT pid::int AS pid, query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> ${blockerPid}
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
        AND (query ILIKE '%"Seat"%' OR query ILIKE '%"SeatClaim"%')
    `;
    if (blocked.length >= count) return blocked;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

async function waitForSeatRequestAtRowLock(kind: "hold" | "edit", queryStartedAt: Date) {
  const deadline = Date.now() + 2_500;
  while (Date.now() < deadline) {
    const waiting = kind === "hold"
      ? await prisma.$queryRaw<Array<{ pid: number; query: string }>>`
        SELECT pid::int AS pid, query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query_start >= ${queryStartedAt}
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND ((query ILIKE '%"Seat"%' AND query ILIKE '%FOR SHARE%') OR query ILIKE '%"SeatClaim"%')
      `
      : await prisma.$queryRaw<Array<{ pid: number; query: string }>>`
        SELECT pid::int AS pid, query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query_start >= ${queryStartedAt}
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND ((query ILIKE '%"Seat"%' AND query ILIKE '%FOR UPDATE%') OR query ILIKE '%UPDATE "Seat"%')
      `;
    if (waiting.length > 0) return waiting;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

type RacedRequest = { kind: "hold" | "edit"; start: () => Promise<HttpResult> };

async function runBehindSeatLock(seatId: string, startRequests: [RacedRequest, RacedRequest]): Promise<[HttpResult, HttpResult]> {
  let signalSeatLocked!: (pid: number) => void;
  let releaseSeatLock!: () => void;
  const seatLocked = new Promise<number>((resolve) => { signalSeatLocked = resolve; });
  const waitForRelease = new Promise<void>((resolve) => { releaseSeatLock = resolve; });
  const blockerTransaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Seat" WHERE "id" = ${seatId} FOR UPDATE`;
    const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    signalSeatLocked(connection!.pid);
    await waitForRelease;
  }, { timeout: 20_000 });

  const pendingRequests: Array<Promise<HttpResult>> = [];
  try {
    const blockerPid = await seatLocked;
    for (let index = 0; index < startRequests.length; index += 1) {
      const requestStartedAt = new Date();
      const pending = startRequests[index]!.start();
      pendingRequests.push(pending);
      const waiting = index === 0
        ? await waitForSeatBlockerQueries(blockerPid, 1)
        : await waitForSeatRequestAtRowLock(startRequests[index]!.kind, requestStartedAt);
      expect(waiting.length, `request ${index + 1} must reach its Seat/SeatClaim row-lock wait`).toBeGreaterThan(0);
    }
    releaseSeatLock();
    await blockerTransaction;
    const responses = await Promise.all(pendingRequests);
    if (responses.length !== 2) throw new Error(`Expected two raced requests, received ${responses.length}`);
    return [responses[0]!, responses[1]!];
  } finally {
    releaseSeatLock();
    await blockerTransaction.catch(() => undefined);
    await Promise.all(pendingRequests.map((pending) => pending.catch(() => undefined)));
  }
}

seatRaceDescribe("Admin seat edits serialize with customer seat holds", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let seatIds: string[] = [];
  let customerAId: string | undefined;
  let customerBId: string | undefined;
  let adminId: string | undefined;
  let customerAToken: string;
  let customerBToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({
      data: { name: `Seat lock ${fixture}`, city: "Test", address: "Isolated seat lock fixture", status: RecordStatus.ACTIVE }
    });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Seat lock room ${fixture}` } });
    auditoriumId = auditorium.id;
    const seats = await prisma.seat.createManyAndReturn({
      data: [
        { auditoriumId: auditorium.id, label: "A1", row: "A", column: 1, type: SeatType.STANDARD },
        { auditoriumId: auditorium.id, label: "B1", row: "B", column: 1, type: SeatType.STANDARD }
      ]
    });
    seatIds = seats.map((seat) => seat.id);
    const movie = await prisma.movie.create({
      data: {
        slug: `seat-lock-${fixture}`,
        title: `Seat lock ${fixture}`,
        genre: "Test",
        synopsis: "Isolated fixture for seat-edit and hold serialization.",
        runtimeMinutes: 90,
        ageRating: "P"
      }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtime = await prisma.showtime.create({
      data: {
        movieId: movie.id,
        auditoriumId: auditorium.id,
        startAt,
        endAt: new Date(startAt.getTime() + 90 * 60_000),
        priceVnd: 100_000,
        premiumSurchargeVnd: 30_000
      }
    });
    showtimeId = showtime.id;

    const users = await prisma.user.createManyAndReturn({
      data: [
        { name: "Seat Race Customer A", email: `seat-race-a-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER },
        { name: "Seat Race Customer B", email: `seat-race-b-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER },
        { name: "Seat Race Admin", email: `seat-race-admin-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN }
      ]
    });
    customerAId = users[0]!.id;
    customerBId = users[1]!.id;
    adminId = users[2]!.id;
    userIds.push(...users.map((user) => user.id));
    customerAToken = createToken({ id: users[0]!.id, authVersion: users[0]!.authVersion });
    customerBToken = createToken({ id: users[1]!.id, authVersion: users[1]!.authVersion });
    adminToken = createToken({ id: users[2]!.id, authVersion: users[2]!.authVersion });
  }, 20_000);

  afterAll(async () => {
    try {
      if (showtimeId) {
        const orders = await prisma.cinemaOrder.findMany({ where: { showtimeId }, select: { id: true } });
        const orderIds = orders.map((order) => order.id);
        if (orderIds.length) {
          await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.seatClaim.deleteMany({ where: { orderId: { in: orderIds } } });
          await prisma.cinemaOrder.deleteMany({ where: { id: { in: orderIds } } });
        }
        await prisma.seatClaim.deleteMany({ where: { showtimeId } });
        await prisma.seatHold.deleteMany({ where: { showtimeId } });
        await prisma.showtime.deleteMany({ where: { id: showtimeId } });
      }
      if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      if (seatIds.length) await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
      if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
      if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    } finally {
      await prisma.$disconnect();
    }
  }, 20_000);

  it("[TC-SEC-41] commits either the seat edit before a hold or the hold before an edit, never stale shape/price", async () => {
    const editedSeatId = seatIds[0]!;
    const claimedSeatId = seatIds[1]!;
    const seatFields = { id: true, auditoriumId: true, label: true, row: true, column: true, type: true, isAccessible: true } as const;
    const claimFields = { id: true, showtimeId: true, seatId: true, holdId: true, orderId: true, status: true, expiresAt: true, priceVnd: true } as const;
    const holdFields = { id: true, userId: true, showtimeId: true, status: true, expiresAt: true } as const;
    const auditFields = { actorId: true, action: true, entity: true, entityId: true, metadata: true } as const;

    const seatBeforeEdit = await prisma.seat.findUniqueOrThrow({ where: { id: editedSeatId! }, select: seatFields });
    const adminEditAuditBefore = await prisma.auditLog.findMany({
      where: { actorId: adminId!, action: "SEAT_UPDATED", entityId: editedSeatId! }, select: auditFields
    });
    const customerHoldAuditBefore = await prisma.auditLog.findMany({
      where: { actorId: customerAId!, action: "SEATS_HELD" }, select: auditFields
    });
    expect(await prisma.seatClaim.findMany({ where: { seatId: editedSeatId }, select: claimFields })).toEqual([]);
    expect(await prisma.seatHold.findMany({ where: { userId: customerAId }, select: holdFields })).toEqual([]);

    const [editBeforeHold, holdAfterEdit] = await runBehindSeatLock(editedSeatId!, [
      { kind: "edit", start: () => request(app).patch(`/api/admin/seats/${editedSeatId}`).set({ Authorization: `Bearer ${adminToken}` })
        .send({ label: "A1P", type: SeatType.PREMIUM }).then(observe) },
      { kind: "hold", start: () => request(app).post("/api/holds").set({ Authorization: `Bearer ${customerAToken}` })
        .send({ showtimeId, seatIds: [editedSeatId] }).then(observe) }
    ]);

    expect(editBeforeHold.status).toBe(200);
    expect(holdAfterEdit.status).toBe(201);
    expect(holdAfterEdit.body.totalVnd).toBe(130_000);
    expect(holdAfterEdit.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(editBeforeHold.requestId).toMatch(/^[0-9a-f-]{36}$/i);

    const updatedSeat = await prisma.seat.findUniqueOrThrow({ where: { id: editedSeatId! }, select: seatFields });
    expect(updatedSeat).toEqual({ ...seatBeforeEdit, label: "A1P", type: SeatType.PREMIUM });
    const editedHold = await prisma.seatHold.findUniqueOrThrow({ where: { id: String(holdAfterEdit.body.id) }, select: holdFields });
    expect(editedHold).toEqual({
      id: holdAfterEdit.body.id,
      userId: customerAId,
      showtimeId,
      status: HoldStatus.HELD,
      expiresAt: new Date(String(holdAfterEdit.body.expiresAt))
    });
    const editedClaims = await prisma.seatClaim.findMany({ where: { seatId: editedSeatId }, select: claimFields });
    expect(editedClaims).toEqual([{
      id: expect.any(String),
      showtimeId,
      seatId: editedSeatId,
      holdId: editedHold.id,
      orderId: null,
      status: ClaimStatus.HELD,
      expiresAt: editedHold.expiresAt,
      priceVnd: 130_000
    }]);
    const editedSeatAudit = await prisma.auditLog.findMany({
      where: { actorId: adminId!, action: "SEAT_UPDATED", entityId: editedSeatId }, select: auditFields
    });
    expect(editedSeatAudit).toEqual([{
      actorId: adminId,
      action: "SEAT_UPDATED",
      entity: "Seat",
      entityId: editedSeatId,
      metadata: { auditoriumId, changedFields: ["label", "type"], correlationId: editBeforeHold.requestId }
    }]);
    const editedHoldAudit = await prisma.auditLog.findMany({
      where: { actorId: customerAId!, action: "SEATS_HELD", entityId: editedHold.id }, select: auditFields
    });
    expect(editedHoldAudit).toEqual([{
      actorId: customerAId,
      action: "SEATS_HELD",
      entity: "SeatHold",
      entityId: editedHold.id,
      metadata: { showtimeId, seatIds: [editedSeatId], totalVnd: 130_000, correlationId: holdAfterEdit.requestId }
    }]);
    expect(await prisma.auditLog.findMany({
      where: { actorId: adminId!, action: "SEAT_UPDATED", entityId: editedSeatId }, select: auditFields
    })).toHaveLength(adminEditAuditBefore.length + 1);
    expect(await prisma.auditLog.findMany({
      where: { actorId: customerAId!, action: "SEATS_HELD" }, select: auditFields
    })).toHaveLength(customerHoldAuditBefore.length + 1);

    const seatBeforeHeldRace = await prisma.seat.findUniqueOrThrow({ where: { id: claimedSeatId! }, select: seatFields });
    const holdAuditBeforeHeldRace = await prisma.auditLog.findMany({
      where: { actorId: customerBId!, action: "SEATS_HELD" }, select: auditFields
    });
    expect(await prisma.seatClaim.findMany({ where: { seatId: claimedSeatId }, select: claimFields })).toEqual([]);
    expect(await prisma.seatHold.findMany({ where: { userId: customerBId }, select: holdFields })).toEqual([]);

    const [holdBeforeEdit, rejectedSeatEdit] = await runBehindSeatLock(claimedSeatId!, [
      { kind: "hold", start: () => request(app).post("/api/holds").set({ Authorization: `Bearer ${customerBToken}` })
        .send({ showtimeId, seatIds: [claimedSeatId] }).then(observe) },
      { kind: "edit", start: () => request(app).patch(`/api/admin/seats/${claimedSeatId}`).set({ Authorization: `Bearer ${adminToken}` })
        .send({ label: "B1P", type: SeatType.PREMIUM }).then(observe) }
    ]);

    expect(holdBeforeEdit.status).toBe(201);
    expect(holdBeforeEdit.body.totalVnd).toBe(100_000);
    expect(rejectedSeatEdit.status).toBe(409);
    expect(rejectedSeatEdit.body.error).toBe("SEAT_HAS_BOOKINGS");
    expect(rejectedSeatEdit.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await prisma.seat.findUniqueOrThrow({ where: { id: claimedSeatId! }, select: seatFields })).toEqual(seatBeforeHeldRace);

    const heldSeatHold = await prisma.seatHold.findUniqueOrThrow({ where: { id: String(holdBeforeEdit.body.id) }, select: holdFields });
    expect(heldSeatHold).toEqual({
      id: holdBeforeEdit.body.id,
      userId: customerBId,
      showtimeId,
      status: HoldStatus.HELD,
      expiresAt: new Date(String(holdBeforeEdit.body.expiresAt))
    });
    expect(await prisma.seatClaim.findMany({ where: { seatId: claimedSeatId }, select: claimFields })).toEqual([{
      id: expect.any(String),
      showtimeId,
      seatId: claimedSeatId,
      holdId: heldSeatHold.id,
      orderId: null,
      status: ClaimStatus.HELD,
      expiresAt: heldSeatHold.expiresAt,
      priceVnd: 100_000
    }]);
    expect(await prisma.auditLog.findMany({
      where: { actorId: customerBId!, action: "SEATS_HELD", entityId: heldSeatHold.id }, select: auditFields
    })).toEqual([{
      actorId: customerBId,
      action: "SEATS_HELD",
      entity: "SeatHold",
      entityId: heldSeatHold.id,
      metadata: { showtimeId, seatIds: [claimedSeatId], totalVnd: 100_000, correlationId: holdBeforeEdit.requestId }
    }]);
    expect(await prisma.auditLog.findMany({
      where: { actorId: adminId!, action: "SEAT_UPDATED", entityId: claimedSeatId }, select: auditFields
    })).toEqual([]);
    expect(await prisma.auditLog.findMany({
      where: { actorId: customerBId!, action: "SEATS_HELD" }, select: auditFields
    })).toHaveLength(holdAuditBeforeHeldRace.length + 1);
  }, 60_000);
});
