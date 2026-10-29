import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HoldStatus, OrderStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const bookingDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

bookingDescribe("one active customer booking at a time", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  const seatIds: string[] = [];
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let firstCustomerToken: string;
  let concurrentCustomerToken: string;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({
      data: { name: `Booking guard ${fixture}`, city: "Test", address: "Isolated booking concurrency fixture", status: RecordStatus.ACTIVE }
    });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Booking guard room ${fixture}` } });
    auditoriumId = auditorium.id;
    const seats = await prisma.seat.createManyAndReturn({
      data: Array.from({ length: 4 }, (_, index) => ({ auditoriumId: auditorium.id, label: `B${index + 1}`, row: "B", column: index + 1, type: SeatType.STANDARD }))
    });
    seatIds.push(...seats.map((seat) => seat.id));
    const movie = await prisma.movie.create({
      data: {
        slug: `booking-guard-${fixture}`,
        title: `Booking Guard ${fixture}`,
        genre: "Test",
        synopsis: "Isolated fixture for the single active booking rule.",
        runtimeMinutes: 90,
        ageRating: "P"
      }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 48 * 60 * 60_000);
    const showtime = await prisma.showtime.create({
      data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 90_000 }
    });
    showtimeId = showtime.id;

    const firstCustomer = await prisma.user.create({
      data: { name: "Booking Guard Customer", email: `booking-guard-${fixture}@test.local`, passwordHash: "unused-in-booking-guard-test", role: Role.CUSTOMER }
    });
    const concurrentCustomer = await prisma.user.create({
      data: { name: "Concurrent Booking Customer", email: `booking-race-${fixture}@test.local`, passwordHash: "unused-in-booking-guard-test", role: Role.CUSTOMER }
    });
    userIds.push(firstCustomer.id, concurrentCustomer.id);
    firstCustomerToken = createToken({ id: firstCustomer.id, authVersion: firstCustomer.authVersion });
    concurrentCustomerToken = createToken({ id: concurrentCustomer.id, authVersion: concurrentCustomer.authVersion });
  }, 30_000);

  afterAll(async () => {
    if (showtimeId) {
      const [orders, holds] = await Promise.all([
        prisma.cinemaOrder.findMany({ where: { showtimeId }, select: { id: true } }),
        prisma.seatHold.findMany({ where: { showtimeId }, select: { id: true } })
      ]);
      const orderIds = orders.map((order) => order.id);
      const holdIds = holds.map((hold) => hold.id);
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: orderIds } }, { entityId: { in: holdIds } }, { actorId: { in: userIds } }] } });
      if (orderIds.length) {
        await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.reconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
        await prisma.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      }
      await prisma.seatClaim.deleteMany({ where: { showtimeId } });
      if (orderIds.length) await prisma.cinemaOrder.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.seatHold.deleteMany({ where: { showtimeId } });
      await prisma.showtime.delete({ where: { id: showtimeId } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (movieId) await prisma.movie.delete({ where: { id: movieId } });
    if (seatIds.length) await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
    if (auditoriumId) await prisma.auditorium.delete({ where: { id: auditoriumId } });
    if (cinemaId) await prisma.cinema.delete({ where: { id: cinemaId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-SEC-33] blocks a second booking while payment is pending and releases the limit after failure", async () => {
    const auth = { Authorization: `Bearer ${firstCustomerToken}` };
    const firstHold = await request(app).post("/api/holds").set(auth).send({ showtimeId, seatIds: [seatIds[0]] });
    expect(firstHold.status).toBe(201);
    const order = await request(app).post("/api/orders").set(auth).send({ holdId: firstHold.body.id as string });
    expect(order.status).toBe(201);
    expect(order.body.status).toBe(OrderStatus.PAYMENT_PENDING);

    const pendingHold = await prisma.seatHold.findUniqueOrThrow({ where: { id: firstHold.body.id as string } });
    expect(pendingHold.status).toBe(HoldStatus.PAYMENT_PENDING);
    const heldOrderCount = await prisma.cinemaOrder.count({ where: { userId: pendingHold.userId, status: OrderStatus.PAYMENT_PENDING } });
    expect(heldOrderCount).toBe(1);

    const blockedHold = await request(app).post("/api/holds").set(auth).send({ showtimeId, seatIds: [seatIds[1]] });
    expect(blockedHold.status).toBe(409);
    expect(blockedHold.body.error).toBe("ACTIVE_HOLD_EXISTS");
    expect(await prisma.seatClaim.findUnique({ where: { showtimeId_seatId: { showtimeId: showtimeId!, seatId: seatIds[1]! } } })).toBeNull();
    expect(await prisma.seatHold.count({ where: { userId: pendingHold.userId } })).toBe(1);

    const failedPayment = await request(app).post("/api/payments/mock/complete").set(auth).send({ orderId: order.body.id, outcome: "FAILED" });
    expect(failedPayment.status).toBe(402);
    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: firstHold.body.id as string } })).status).toBe(HoldStatus.RELEASED);

    const holdAfterFailure = await request(app).post("/api/holds").set(auth).send({ showtimeId, seatIds: [seatIds[1]] });
    expect(holdAfterFailure.status).toBe(201);
  }, 30_000);

  it("serializes simultaneous holds for different seats from the same customer", async () => {
    const auth = { Authorization: `Bearer ${concurrentCustomerToken}` };
    const [first, second] = await Promise.all([
      request(app).post("/api/holds").set(auth).send({ showtimeId, seatIds: [seatIds[2]] }),
      request(app).post("/api/holds").set(auth).send({ showtimeId, seatIds: [seatIds[3]] })
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(rejected.body.error).toBe("ACTIVE_HOLD_EXISTS");
    const activeHolds = await prisma.seatHold.findMany({ where: { userId: { in: userIds }, showtimeId, status: HoldStatus.HELD, expiresAt: { gt: new Date() } } });
    const customerHolds = activeHolds.filter((hold) => hold.userId !== userIds[0]);
    expect(customerHolds).toHaveLength(1);
    const claims = await prisma.seatClaim.findMany({ where: { showtimeId, seatId: { in: [seatIds[2]!, seatIds[3]!] }, status: "HELD" } });
    expect(claims).toHaveLength(1);
    expect(claims[0]!.holdId).toBe(customerHolds[0]!.id);
    expect(await prisma.auditLog.count({ where: { actorId: userIds[1], action: "SEATS_HELD" } })).toBe(1);
  }, 30_000);
});
