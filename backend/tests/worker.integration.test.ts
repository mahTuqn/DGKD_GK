import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, OrderStatus, OutboxEventStatus, OutboxEventType, PaymentStatus, PrismaClient, RecordStatus, ReconciliationCaseStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { enqueueOutboxEvent, expireDueHolds, processOutboxBatch } from "../src/worker.js";

const workerDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

workerDescribe("plan phase 5: expiration worker and payment reconciliation outbox", () => {
  const fixture = randomUUID();
  const userIds: string[] = [];
  const seatIds: string[] = [];
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let expiredHeldId: string | undefined;
  let pendingHoldId: string | undefined;
  let pendingOrderId: string | undefined;
  let futureHoldId: string | undefined;
  let boundaryHeldId: string | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({ data: { name: `Worker ${fixture}`, city: "Test", address: "Worker fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Worker room ${fixture}` } });
    auditoriumId = auditorium.id;
    await prisma.seat.createMany({ data: [1, 2, 3].map((column) => ({ auditoriumId: auditorium.id, label: `W${column}`, row: "W", column, type: SeatType.STANDARD })) });
    const seats = await prisma.seat.findMany({ where: { auditoriumId: auditorium.id }, orderBy: { column: "asc" } });
    seatIds.push(...seats.map((seat) => seat.id));
    const movie = await prisma.movie.create({
      data: { slug: `worker-${fixture}`, title: `Worker ${fixture}`, genre: "Test", synopsis: "Fixture data for background expiration and reconciliation.", runtimeMinutes: 90, ageRating: "P" }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000 } });
    showtimeId = showtime.id;
    const heldUser = await prisma.user.create({ data: { name: "Worker Held Customer", email: `worker-held-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    const pendingUser = await prisma.user.create({ data: { name: "Worker Pending Customer", email: `worker-pending-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    const futureUser = await prisma.user.create({ data: { name: "Worker Future Customer", email: `worker-future-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    userIds.push(heldUser.id, pendingUser.id, futureUser.id);

    const now = new Date();
    const expiredAt = new Date(now.getTime() - 1_000);
    const futureAt = new Date(now.getTime() + 600_000);
    const held = await prisma.seatHold.create({ data: { userId: heldUser.id, showtimeId: showtime.id, status: HoldStatus.HELD, expiresAt: expiredAt } });
    expiredHeldId = held.id;
    await prisma.seatClaim.create({ data: { showtimeId: showtime.id, seatId: seats[0]!.id, holdId: held.id, status: ClaimStatus.HELD, expiresAt: expiredAt, priceVnd: 100_000 } });

    const pendingHold = await prisma.seatHold.create({ data: { userId: pendingUser.id, showtimeId: showtime.id, status: HoldStatus.PAYMENT_PENDING, expiresAt: expiredAt } });
    pendingHoldId = pendingHold.id;
    const order = await prisma.cinemaOrder.create({ data: { userId: pendingUser.id, showtimeId: showtime.id, holdId: pendingHold.id, status: OrderStatus.PAYMENT_PENDING, totalVnd: 100_000 } });
    pendingOrderId = order.id;
    await prisma.seatClaim.create({ data: { showtimeId: showtime.id, seatId: seats[1]!.id, holdId: pendingHold.id, orderId: order.id, status: ClaimStatus.HELD, expiresAt: expiredAt, priceVnd: 100_000 } });
    await prisma.payment.create({ data: { orderId: order.id, status: PaymentStatus.PENDING, amountVnd: 100_000 } });

    const futureHold = await prisma.seatHold.create({ data: { userId: futureUser.id, showtimeId: showtime.id, status: HoldStatus.HELD, expiresAt: futureAt } });
    futureHoldId = futureHold.id;
    await prisma.seatClaim.create({ data: { showtimeId: showtime.id, seatId: seats[2]!.id, holdId: futureHold.id, status: ClaimStatus.HELD, expiresAt: futureAt, priceVnd: 100_000 } });
  }, 30_000);

  afterAll(async () => {
    const orderIds = pendingOrderId ? [pendingOrderId] : [];
    if (orderIds.length) await prisma.reconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
    const auditEntityIds = [expiredHeldId, pendingOrderId, boundaryHeldId].filter((id): id is string => Boolean(id));
    if (auditEntityIds.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: auditEntityIds } } });
    if (orderIds.length) {
      await prisma.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.seatClaim.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.cinemaOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (showtimeId) {
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
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-WORKER-01] idempotently expires due holds, pending orders, and releases claims", async () => {
    const now = new Date();
    const correlationId = `worker-cycle-${fixture}`;
    const firstSweep = await expireDueHolds(prisma, now, 500, correlationId);
    expect(firstSweep.expiredHeldHolds).toBeGreaterThanOrEqual(1);
    expect(firstSweep.expiredPendingOrders).toBeGreaterThanOrEqual(1);

    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: expiredHeldId! } })).status).toBe(HoldStatus.EXPIRED);
    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: pendingHoldId! } })).status).toBe(HoldStatus.EXPIRED);
    expect((await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: pendingOrderId! } })).status).toBe(OrderStatus.EXPIRED);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: pendingOrderId! } })).status).toBe(PaymentStatus.FAILED);

    const releasedClaims = await prisma.seatClaim.findMany({ where: { showtimeId, seatId: { in: seatIds.slice(0, 2) } } });
    expect(releasedClaims).toHaveLength(2);
    expect(releasedClaims.every((claim) => claim.status === ClaimStatus.EXPIRED && claim.holdId === null && claim.orderId === null && claim.expiresAt === null)).toBe(true);
    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: futureHoldId! } })).status).toBe(HoldStatus.HELD);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: pendingOrderId } })).toBe(0);
    expect(await prisma.reconciliationCase.count({ where: { orderId: pendingOrderId } })).toBe(0);
    const [heldExpiryAudit, pendingOrderExpiryAudit] = await Promise.all([
      prisma.auditLog.findFirst({ where: { action: "SEAT_HOLD_EXPIRED", entityId: expiredHeldId } }),
      prisma.auditLog.findFirst({ where: { action: "PAYMENT_PENDING_EXPIRED", entityId: pendingOrderId } })
    ]);
    expect(heldExpiryAudit?.metadata).toMatchObject({ correlationId });
    expect(pendingOrderExpiryAudit?.metadata).toMatchObject({ correlationId });

    const secondSweep = await expireDueHolds(prisma, new Date(now.getTime() + 1_000), 500);
    expect(secondSweep.expiredHeldHolds).toBe(0);
    expect(secondSweep.expiredPendingOrders).toBe(0);
    expect(await prisma.payment.count({ where: { orderId: pendingOrderId, status: PaymentStatus.FAILED } })).toBe(1);
    expect(await prisma.seatClaim.count({ where: { showtimeId, seatId: { in: seatIds.slice(0, 2) }, status: ClaimStatus.EXPIRED } })).toBe(2);
  }, 30_000);

  it("[TC-WORKER-03] expires a hold at the exact deadline but keeps one active 1ms later", async () => {
    // Use a fixed sweep time so the equality boundary is deterministic.
    const boundaryAt = new Date("2026-10-27T12:00:00.000Z");
    const atBoundaryUser = await prisma.user.create({
      data: { name: "Worker Boundary Customer", email: `worker-boundary-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER }
    });
    const afterBoundaryUser = await prisma.user.create({
      data: { name: "Worker After Boundary Customer", email: `worker-after-boundary-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER }
    });
    userIds.push(atBoundaryUser.id, afterBoundaryUser.id);

    const atBoundary = await prisma.seatHold.create({
      data: { userId: atBoundaryUser.id, showtimeId: showtimeId!, status: HoldStatus.HELD, expiresAt: boundaryAt }
    });
    boundaryHeldId = atBoundary.id;
    const afterBoundary = await prisma.seatHold.create({
      data: { userId: afterBoundaryUser.id, showtimeId: showtimeId!, status: HoldStatus.HELD, expiresAt: new Date(boundaryAt.getTime() + 1) }
    });

    const sweep = await expireDueHolds(prisma, boundaryAt, 500);

    expect(sweep.expiredHeldHolds).toBeGreaterThanOrEqual(1);
    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: atBoundary.id } })).status).toBe(HoldStatus.EXPIRED);
    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: afterBoundary.id } })).status).toBe(HoldStatus.HELD);
  }, 30_000);

  it("[TC-WORKER-02] processes concurrent duplicate late-payment events into one OPEN manual case", async () => {
    const providerEventId = `late-${fixture}`;
    const event = {
      eventKey: `payment-reconciliation:${providerEventId}`,
      eventType: OutboxEventType.PAYMENT_RECONCILIATION_REQUIRED,
      aggregateId: pendingOrderId!,
      payload: { providerEventId, orderId: pendingOrderId!, amountVnd: 100_000, currency: "VND", reason: "PAYMENT_AFTER_EXPIRY" } as const
    };
    const enqueued = await prisma.$transaction(async (tx) => {
      const first = await enqueueOutboxEvent(tx, event);
      const duplicateKey = await enqueueOutboxEvent(tx, event);
      const duplicateProviderEvent = await enqueueOutboxEvent(tx, { ...event, eventKey: `duplicate:${providerEventId}` });
      return { first, duplicateKey, duplicateProviderEvent };
    });
    expect(enqueued.duplicateKey.id).toBe(enqueued.first.id);
    expect(enqueued.duplicateProviderEvent.id).not.toBe(enqueued.first.id);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: pendingOrderId } })).toBe(2);

    const [firstWorker, secondWorker] = await Promise.all([
      processOutboxBatch(prisma, new Date(), 1),
      processOutboxBatch(prisma, new Date(), 1)
    ]);
    expect(firstWorker.dead + secondWorker.dead).toBe(0);
    expect(firstWorker.processed + secondWorker.processed).toBe(2);
    expect(await prisma.reconciliationCase.count({ where: { providerEventId } })).toBe(1);
    const reconciliationCase = await prisma.reconciliationCase.findUniqueOrThrow({ where: { providerEventId } });
    expect(reconciliationCase.orderId).toBe(pendingOrderId);
    expect(reconciliationCase.amountVnd).toBe(100_000);
    expect(reconciliationCase.currency).toBe("VND");
    expect(reconciliationCase.reason).toBe("PAYMENT_AFTER_EXPIRY");
    expect(reconciliationCase.status).toBe(ReconciliationCaseStatus.OPEN);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: pendingOrderId } })).status).toBe(PaymentStatus.FAILED);
    expect(await prisma.ticket.count({ where: { orderId: pendingOrderId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: pendingOrderId, status: OutboxEventStatus.PROCESSED } })).toBe(2);

    const replay = await processOutboxBatch(prisma, new Date(), 10);
    expect(replay.processed).toBe(0);
    expect(await prisma.reconciliationCase.count({ where: { providerEventId } })).toBe(1);
  }, 30_000);

  it("[TC-WORKER-04] independent worker instances process one outbox event exactly once", async () => {
    const providerEventId = `multi-instance-${fixture}`;
    const event = {
      eventKey: `payment-reconciliation:${providerEventId}`,
      eventType: OutboxEventType.PAYMENT_RECONCILIATION_REQUIRED,
      aggregateId: pendingOrderId!,
      payload: { providerEventId, orderId: pendingOrderId!, amountVnd: 100_000, currency: "VND", reason: "PAYMENT_AFTER_EXPIRY" } as const
    };
    await prisma.$transaction((tx) => enqueueOutboxEvent(tx, event));

    const secondWorker = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST! });
    await secondWorker.$connect();
    try {
      const now = new Date();
      const results = await Promise.all([
        processOutboxBatch(prisma, now, 1),
        processOutboxBatch(secondWorker, now, 1)
      ]);

      expect(results.reduce((total, result) => total + result.dead, 0)).toBe(0);
      expect(results.reduce((total, result) => total + result.processed, 0)).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { eventKey: event.eventKey, status: OutboxEventStatus.PROCESSED } })).toBe(1);
      expect(await prisma.reconciliationCase.count({ where: { providerEventId } })).toBe(1);
    } finally {
      await secondWorker.$disconnect();
    }
  }, 30_000);

});
