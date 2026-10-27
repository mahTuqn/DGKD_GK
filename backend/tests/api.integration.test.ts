import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HoldStatus, OrderStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken, hashPassword } from "../src/auth.js";
import { prisma } from "../src/db.js";
import { formatBusinessDate } from "../src/domain/booking-policy.js";
import { signMockPaymentEvent } from "../src/domain/mock-payment-signature.js";
import { processOutboxBatch } from "../src/worker.js";

const hasTestDatabase = Boolean(process.env.DATABASE_URL_TEST);
const apiDescribe = hasTestDatabase ? describe.sequential : describe.skip;
const expectSafeError = (response: { body: unknown }) => {
  const serialized = JSON.stringify(response.body);
  expect(serialized).not.toMatch(/"stack"\s*:|"passwordHash"\s*:|"token"\s*:/i);
  expect(serialized).not.toContain("cinema-booking-local-mock-payment-secret-2026");
  if (process.env.MOCK_PAYMENT_SECRET) expect(serialized).not.toContain(process.env.MOCK_PAYMENT_SECRET);
};

apiDescribe("REQ-AUTH/BOOK/PAY/TICKET: isolated PostgreSQL HTTP flow", () => {
  const app = createApp();
  const fixture = randomUUID();
  let userIds: string[] = [];
  let staffId: string | undefined;
  let adminId: string | undefined;
  let cinemaId: string | undefined;
  let adminCinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let adminAuditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let inactiveShowtimeId: string | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({ data: { name: `HTTP test ${fixture}`, city: "Test", address: "Isolated HTTP fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `HTTP room ${fixture}`, screenType: "TEST" } });
    auditoriumId = auditorium.id;
    await prisma.seat.createMany({ data: Array.from({ length: 9 }, (_, index) => ({ auditoriumId: auditorium.id, label: `T${index + 1}`, row: "T", column: index + 1, type: SeatType.STANDARD })) });
    const movie = await prisma.movie.create({ data: { slug: `http-${fixture}`, title: `HTTP fixture ${fixture}`, genre: "Test", synopsis: "Temporary data for API integration assertions.", runtimeMinutes: 90, ageRating: "P" } });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 90_000 } });
    showtimeId = showtime.id;
    const inactiveShowtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt: new Date(startAt.getTime() + 4 * 60 * 60_000), endAt: new Date(startAt.getTime() + 5.5 * 60 * 60_000), priceVnd: 85_000, status: RecordStatus.INACTIVE } });
    inactiveShowtimeId = inactiveShowtime.id;
    const staff = await prisma.user.create({ data: { name: "HTTP Test Staff", email: `staff-${fixture}@test.local`, passwordHash: await hashPassword("StaffIntegration123!"), role: Role.STAFF, assignedCinemaId: cinema.id } });
    staffId = staff.id;
    const admin = await prisma.user.create({ data: { name: "HTTP Test Admin", email: `admin-${fixture}@test.local`, passwordHash: await hashPassword("AdminIntegration123!"), role: Role.ADMIN } });
    adminId = admin.id;
  }, 30_000);

  afterAll(async () => {
    if (showtimeId) {
      const orders = await prisma.cinemaOrder.findMany({ where: { showtimeId }, select: { id: true } });
      const orderIds = orders.map((order) => order.id);
      if (orderIds.length) {
        await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.reconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
        await prisma.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.seatClaim.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.cinemaOrder.deleteMany({ where: { id: { in: orderIds } } });
      }
      await prisma.seatClaim.deleteMany({ where: { showtimeId } });
      await prisma.seatHold.deleteMany({ where: { showtimeId } });
      await prisma.showtime.deleteMany({ where: { id: showtimeId } });
    }
    if (inactiveShowtimeId) await prisma.showtime.deleteMany({ where: { id: inactiveShowtimeId } });
    if (staffId || adminId || userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: [...userIds, ...(staffId ? [staffId] : []), ...(adminId ? [adminId] : [])] } } });
    // Staff points at its assigned cinema; remove fixture users before deleting that cinema.
    if (staffId) await prisma.user.deleteMany({ where: { id: staffId } });
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (auditoriumId) await prisma.seat.deleteMany({ where: { auditoriumId } });
    if (adminAuditoriumId) await prisma.seat.deleteMany({ where: { auditoriumId: adminAuditoriumId } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (adminAuditoriumId) await prisma.auditorium.deleteMany({ where: { id: adminAuditoriumId } });
    if (adminCinemaId) await prisma.cinema.deleteMany({ where: { id: adminCinemaId } });
    if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-API-01][TC-PLAN-01][TC-PLAN-02][TC-PLAN-03][TC-PLAN-04][TC-PLAN-05] enforces auth, booking boundaries, payment/report rules, concurrency, and one-use staff check-in", async () => {
    const guestHold = await request(app).post("/api/holds").send({ showtimeId, seatIds: ["missing"] });
    expect(guestHold.status).toBe(401);
    expectSafeError(guestHold);

    const registered = await request(app).post("/api/auth/register").send({ name: "HTTP Customer A", email: `customer-a-${fixture}@test.local`, password: "CustomerIntegration123!" });
    expect(registered.status).toBe(201);
    expect(registered.body.user.role).toBe("CUSTOMER");
    expect(registered.body.user).not.toHaveProperty("passwordHash");
    const customerAId = registered.body.user.id as string;
    userIds.push(customerAId);
    const tokenA = registered.body.token as string;
    const authA = { Authorization: `Bearer ${tokenA}` };

    const customerBResponse = await request(app).post("/api/auth/register").send({ name: "HTTP Customer B", email: `customer-b-${fixture}@test.local`, password: "CustomerIntegration123!" });
    expect(customerBResponse.status).toBe(201);
    userIds.push(customerBResponse.body.user.id as string);
    const authB = { Authorization: `Bearer ${customerBResponse.body.token as string}` };

    expect((await request(app).get("/api/admin/summary").set(authA)).status).toBe(403);
    expect((await request(app).post("/api/tickets/not-a-ticket/check-in").set(authA)).status).toBe(403);

    const adminLogin = await request(app).post("/api/auth/login").send({ email: `admin-${fixture}@test.local`, password: "AdminIntegration123!" });
    expect(adminLogin.status).toBe(200);
    const adminAuth = { Authorization: `Bearer ${adminLogin.body.token as string}` };
    expect((await request(app).get("/api/admin/cinemas").set(adminAuth)).status).toBe(200);
    const newCinema = await request(app).post("/api/admin/cinemas").set(adminAuth).send({ name: `Created cinema ${fixture}`, city: "Test city", address: "Created by API integration test" });
    expect(newCinema.status).toBe(201);
    adminCinemaId = newCinema.body.id as string;
    expect((await request(app).patch(`/api/admin/cinemas/${adminCinemaId}`).set(adminAuth).send({ city: "Updated test city" })).status).toBe(200);
    const newAuditorium = await request(app).post("/api/admin/auditoriums").set(adminAuth).send({ cinemaId: adminCinemaId, name: "Created room", seats: [{ label: "B1", row: "B", column: 1, type: "STANDARD" }] });
    expect(newAuditorium.status).toBe(201);
    expect(newAuditorium.body.seats).toHaveLength(1);
    adminAuditoriumId = newAuditorium.body.id as string;
    const seatPatch = await request(app).patch(`/api/admin/seats/${newAuditorium.body.seats[0].id as string}`).set(adminAuth).send({ label: "B2", row: "B", column: 2 });
    expect(seatPatch.status).toBe(200);
    expect((await request(app).patch(`/api/admin/auditoriums/${adminAuditoriumId}`).set(adminAuth).send({ screenType: "PREMIUM" })).status).toBe(200);
    expect((await request(app).get("/api/admin/auditoriums").set(adminAuth)).body.some((room: { id: string }) => room.id === adminAuditoriumId)).toBe(true);
    const moviePatch = await request(app).patch(`/api/admin/movies/${movieId}`).set(adminAuth).send({ title: `Updated HTTP fixture ${fixture}` });
    expect(moviePatch.status).toBe(200);
    expect(moviePatch.body.title).toContain("Updated HTTP fixture");
    const showtimePatch = await request(app).patch(`/api/admin/showtimes/${showtimeId}`).set(adminAuth).send({ priceVnd: 92_000 });
    expect(showtimePatch.status).toBe(200);
    expect(showtimePatch.body.priceVnd).toBe(92_000);
    expect(showtimePatch.body.status).toBe("ACTIVE");
    const catalogDate = formatBusinessDate((await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeId! }, select: { startAt: true } })).startAt);
    const filteredShowtimes = await request(app).get("/api/showtimes").query({ date: catalogDate, movieId, cinemaId });
    expect(filteredShowtimes.status).toBe(200);
    expect(filteredShowtimes.body.map((showtime: { id: string }) => showtime.id)).toEqual([showtimeId]);
    expect(filteredShowtimes.body.some((showtime: { id: string }) => showtime.id === inactiveShowtimeId)).toBe(false);

    const seatIds = (await prisma.seat.findMany({ where: { auditoriumId }, orderBy: { column: "asc" }, select: { id: true } })).map((seat) => seat.id);
    const tooManySeats = await request(app).post("/api/holds").set(authA).send({ showtimeId, seatIds });
    expect(tooManySeats.status).toBe(422);
    expect(await prisma.seatHold.count({ where: { userId: customerAId, showtimeId } })).toBe(0);
    expect(await prisma.seatClaim.count({ where: { showtimeId } })).toBe(0);

    const holdResponse = await request(app).post("/api/holds").set(authA).send({ showtimeId, seatIds: [seatIds[0]] });
    expect(holdResponse.status).toBe(201);
    expect(holdResponse.body.status).toBe(HoldStatus.HELD);
    const ownerAttempt = await request(app).post("/api/orders").set(authB).send({ holdId: holdResponse.body.id });
    expect(ownerAttempt.status).toBe(404);
    expectSafeError(ownerAttempt);
    const orderResponse = await request(app).post("/api/orders").set(authA).send({ holdId: holdResponse.body.id });
    expect(orderResponse.status).toBe(201);
    expect(orderResponse.body.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect((await request(app).get(`/api/orders/${orderResponse.body.id}`).set(authB)).status).toBe(404);

    const revenueBeforeConfirmation = (await request(app).get("/api/admin/summary").set(adminAuth)).body.confirmedRevenueVnd as number;
    const payment = await request(app).post("/api/payments/mock/complete").set(authA).send({ orderId: orderResponse.body.id });
    expect(payment.status).toBe(200);
    expect(payment.body.tickets).toHaveLength(1);
    const retryPayment = await request(app).post("/api/payments/mock/complete").set(authA).send({ orderId: orderResponse.body.id });
    expect(retryPayment.status).toBe(200);
    expect(retryPayment.body.tickets[0].id).toBe(payment.body.tickets[0].id);
    expect(await prisma.ticket.count({ where: { orderId: orderResponse.body.id } })).toBe(1);
    const revenueAfterConfirmation = (await request(app).get("/api/admin/summary").set(adminAuth)).body.confirmedRevenueVnd as number;
    expect(revenueAfterConfirmation).toBe(revenueBeforeConfirmation + orderResponse.body.totalVnd);
    const fixtureShowtime = await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeId! }, select: { startAt: true } });
    const fixtureDate = formatBusinessDate(fixtureShowtime.startAt);
    const occupancy = await request(app).get(`/api/admin/reports/occupancy?from=${fixtureDate}&to=${fixtureDate}`).set(adminAuth);
    expect(occupancy.status).toBe(200);
    expect(occupancy.body.showtimeCount).toBe(1);
    expect(occupancy.body.soldSeats).toBe(1);
    expect(occupancy.body.capacitySeats).toBe(9);
    expect(occupancy.body.fillRatePercent).toBe(11.11);
    expect(occupancy.body.definition).toContain("SeatClaim SOLD");
    expect((await request(app).get("/api/admin/summary").set(adminAuth)).body.occupancy.capacitySeats).toBeGreaterThanOrEqual(9);

    const staffLogin = await request(app).post("/api/auth/login").send({ email: `staff-${fixture}@test.local`, password: "StaffIntegration123!" });
    expect(staffLogin.status).toBe(200);
    const staffAuth = { Authorization: `Bearer ${staffLogin.body.token as string}` };
    const ticketId = payment.body.tickets[0].id as string;
    expect((await request(app).post(`/api/tickets/${ticketId}/check-in`).set(staffAuth).send({})).status).toBe(200);
    expect((await request(app).post(`/api/tickets/${ticketId}/check-in`).set(staffAuth).send({})).status).toBe(409);

    const secondHold = await request(app).post("/api/holds").set(authA).send({ showtimeId, seatIds: [seatIds[1]] });
    expect(secondHold.status).toBe(201);
    const secondOrder = await request(app).post("/api/orders").set(authA).send({ holdId: secondHold.body.id });
    expect(secondOrder.status).toBe(201);
    const pending = await request(app).get(`/api/orders/${secondOrder.body.id}`).set(authA);
    expect(pending.body.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect(pending.body.tickets).toHaveLength(0);
    const webhookEvent = { eventId: `evt-bad-${fixture}`, orderId: secondOrder.body.id as string, status: "SUCCEEDED", amountVnd: secondOrder.body.totalVnd as number, currency: "VND" };
    const badWebhook = await request(app).post("/api/payments/mock/webhook").set("x-mock-signature", "0".repeat(64)).send(webhookEvent);
    expect(badWebhook.status).toBe(401);
    expectSafeError(badWebhook);
    const stillPending = await request(app).get(`/api/orders/${secondOrder.body.id}`).set(authA);
    expect(stillPending.body.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect(stillPending.body.tickets).toHaveLength(0);
    expect(await prisma.seatHold.count({ where: { id: secondHold.body.id } })).toBe(1);

    const revenueWithPending = (await request(app).get("/api/admin/summary").set(adminAuth)).body.confirmedRevenueVnd as number;
    expect(revenueWithPending).toBe(revenueAfterConfirmation);
    const failedPayment = await request(app).post("/api/payments/mock/complete").set(authA).send({ orderId: secondOrder.body.id, outcome: "FAILED" });
    expect(failedPayment.status).toBe(402);
    const failedOrder = await request(app).get(`/api/orders/${secondOrder.body.id}`).set(authA);
    expect(failedOrder.body.status).toBe(OrderStatus.PAYMENT_FAILED);
    expect(failedOrder.body.tickets).toHaveLength(0);
    const revenueWithFailed = (await request(app).get("/api/admin/summary").set(adminAuth)).body.confirmedRevenueVnd as number;
    expect(revenueWithFailed).toBe(revenueAfterConfirmation);

    // The order total is an immutable snapshot of the server-priced seat claim.
    const priceSnapshotHold = await request(app).post("/api/holds").set(authA).send({ showtimeId, seatIds: [seatIds[2]] });
    expect(priceSnapshotHold.status).toBe(201);
    expect(priceSnapshotHold.body.totalVnd).toBe(92_000);
    expect((await request(app).patch(`/api/admin/showtimes/${showtimeId}`).set(adminAuth).send({ priceVnd: 110_000 })).status).toBe(200);
    const forgedOrder = await request(app).post("/api/orders").set(authA).send({ holdId: priceSnapshotHold.body.id, totalVnd: 1 });
    expect(forgedOrder.status).toBe(422);
    expectSafeError(forgedOrder);
    const snapshotOrder = await request(app).post("/api/orders").set(authA).send({ holdId: priceSnapshotHold.body.id });
    expect(snapshotOrder.status).toBe(201);
    expect(snapshotOrder.body.totalVnd).toBe(92_000);
    const retriedOrder = await request(app).post("/api/orders").set(authA).send({ holdId: priceSnapshotHold.body.id });
    expect(retriedOrder.status).toBe(201);
    expect(retriedOrder.body.id).toBe(snapshotOrder.body.id);
    expect(await prisma.cinemaOrder.count({ where: { holdId: priceSnapshotHold.body.id } })).toBe(1);
    expect(await prisma.seatClaim.findUniqueOrThrow({ where: { showtimeId_seatId: { showtimeId: showtimeId!, seatId: seatIds[2]! } } }).then((claim) => claim.priceVnd)).toBe(92_000);

    // Expire the server-created hold at its stored boundary and verify checkout releases the claim.
    const expiringHold = await request(app).post("/api/holds").set(authB).send({ showtimeId, seatIds: [seatIds[3]] });
    expect(expiringHold.status).toBe(201);
    const ttlSeconds = (new Date(expiringHold.body.expiresAt as string).getTime() - Date.now()) / 1000;
    expect(ttlSeconds).toBeGreaterThan(295);
    expect(ttlSeconds).toBeLessThanOrEqual(300);
    await prisma.seatHold.update({ where: { id: expiringHold.body.id as string }, data: { expiresAt: new Date(Date.now() - 1) } });
    const expiredCheckout = await request(app).post("/api/orders").set(authB).send({ holdId: expiringHold.body.id });
    expect(expiredCheckout.status).toBe(409);
    expect(expiredCheckout.body.error).toBe("HOLD_EXPIRED");
    const expiredClaim = await prisma.seatClaim.findUniqueOrThrow({ where: { showtimeId_seatId: { showtimeId: showtimeId!, seatId: seatIds[3]! } } });
    expect(expiredClaim.status).toBe("EXPIRED");
    expect(expiredClaim.holdId).toBeNull();

    // A correctly signed success delivered after expiry must not resurrect the old booking.
    const lateHold = await request(app).post("/api/holds").set(authB).send({ showtimeId, seatIds: [seatIds[5]] });
    expect(lateHold.status).toBe(201);
    const lateOrder = await request(app).post("/api/orders").set(authB).send({ holdId: lateHold.body.id });
    expect(lateOrder.status).toBe(201);
    await prisma.seatHold.update({ where: { id: lateHold.body.id as string }, data: { expiresAt: new Date(Date.now() - 1) } });
    await prisma.seatClaim.updateMany({ where: { orderId: lateOrder.body.id as string, status: "HELD" }, data: { expiresAt: new Date(Date.now() - 1) } });
    const lateEvent = {
      eventId: `evt-late-${fixture}`,
      orderId: lateOrder.body.id as string,
      status: "SUCCEEDED" as const,
      amountVnd: lateOrder.body.totalVnd as number,
      currency: "VND" as const
    };
    const webhookSecret = process.env.MOCK_PAYMENT_SECRET || "cinema-booking-local-mock-payment-secret-2026";
    const lateCallback = await request(app).post("/api/payments/mock/webhook")
      .set("x-mock-signature", signMockPaymentEvent(lateEvent, webhookSecret))
      .send(lateEvent);
    expect(lateCallback.status).toBe(409);
    expect(lateCallback.body.error).toBe("PAYMENT_TOO_LATE");
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderId: lateOrder.body.id as string } }).then((payment) => payment.status)).toBe("RECONCILIATION_REQUIRED");
    expect(await prisma.outboxEvent.count({ where: { eventKey: `payment-reconciliation:${lateEvent.eventId}` } })).toBe(1);
    await processOutboxBatch(prisma);
    const reconciliationCase = await prisma.reconciliationCase.findUniqueOrThrow({ where: { providerEventId: lateEvent.eventId } });
    expect(reconciliationCase.status).toBe("OPEN");
    expect(reconciliationCase.orderId).toBe(lateOrder.body.id);
    expect(reconciliationCase.amountVnd).toBe(lateOrder.body.totalVnd);
    const expiredOrder = await request(app).get(`/api/orders/${lateOrder.body.id}`).set(authB);
    expect(expiredOrder.body.status).toBe(OrderStatus.EXPIRED);
    expect(expiredOrder.body.tickets).toHaveLength(0);
    const releasedLateSeat = await request(app).post("/api/holds").set(authB).send({ showtimeId, seatIds: [seatIds[5]] });
    expect(releasedLateSeat.status).toBe(201);

    // One hundred distinct customers contend for an initially unclaimed seat.
    const racers = Array.from({ length: 100 }, (_, index) => ({
      id: randomUUID(),
      name: `Race customer ${index}`,
      email: `race-${index}-${fixture}@test.local`,
      passwordHash: "unused-in-api-race-test",
      role: Role.CUSTOMER
    }));
    await prisma.user.createMany({ data: racers });
    userIds.push(...racers.map((user) => user.id));
    const raceResults = await Promise.all(racers.map((user) => request(app)
      .post("/api/holds")
      .set({ Authorization: `Bearer ${createToken({ id: user.id })}` })
      .send({ showtimeId, seatIds: [seatIds[4]] })));
    expect(raceResults.filter((result) => result.status === 201)).toHaveLength(1);
    expect(raceResults.filter((result) => result.status === 409)).toHaveLength(99);
    expect(raceResults.every((result) => result.status === 201 || result.status === 409)).toBe(true);
    const raceClaim = await prisma.seatClaim.findUniqueOrThrow({ where: { showtimeId_seatId: { showtimeId: showtimeId!, seatId: seatIds[4]! } } });
    expect(raceClaim.status).toBe("HELD");
    expect(await prisma.seatClaim.count({ where: { showtimeId, seatId: seatIds[4], status: "HELD" } })).toBe(1);
  }, 90_000);
});
