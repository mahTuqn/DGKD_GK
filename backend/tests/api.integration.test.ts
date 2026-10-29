import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, OrderStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken, hashPassword } from "../src/auth.js";
import { prisma } from "../src/db.js";
import { calendarDateAtTime, formatBusinessDate } from "../src/domain/booking-policy.js";
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
  let foreignAuditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let inactiveShowtimeId: string | undefined;
  let occupancyBoundaryShowtimeId: string | undefined;
  let occupancyCrossCinemaShowtimeId: string | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({ data: { name: `HTTP test ${fixture}`, city: "Test", address: "Isolated HTTP fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `HTTP room ${fixture}`, screenType: "TEST" } });
    auditoriumId = auditorium.id;
    await prisma.seat.createMany({ data: Array.from({ length: 9 }, (_, index) => ({ auditoriumId: auditorium.id, label: `T${index + 1}`, row: "T", column: index + 1, type: SeatType.STANDARD })) });
    const foreignAuditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `HTTP foreign room ${fixture}`, screenType: "TEST" } });
    foreignAuditoriumId = foreignAuditorium.id;
    await prisma.seat.create({ data: { auditoriumId: foreignAuditorium.id, label: "F1", row: "F", column: 1, type: SeatType.STANDARD } });
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
        await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
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
    if (occupancyBoundaryShowtimeId) await prisma.showtime.deleteMany({ where: { id: occupancyBoundaryShowtimeId } });
    if (occupancyCrossCinemaShowtimeId) await prisma.showtime.deleteMany({ where: { id: occupancyCrossCinemaShowtimeId } });
    if (staffId || adminId || userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: [...userIds, ...(staffId ? [staffId] : []), ...(adminId ? [adminId] : [])] } } });
    // Staff points at its assigned cinema; remove fixture users before deleting that cinema.
    if (staffId) await prisma.user.deleteMany({ where: { id: staffId } });
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (auditoriumId) await prisma.seat.deleteMany({ where: { auditoriumId } });
    if (adminAuditoriumId) await prisma.seat.deleteMany({ where: { auditoriumId: adminAuditoriumId } });
    if (foreignAuditoriumId) await prisma.seat.deleteMany({ where: { auditoriumId: foreignAuditoriumId } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (adminAuditoriumId) await prisma.auditorium.deleteMany({ where: { id: adminAuditoriumId } });
    if (foreignAuditoriumId) await prisma.auditorium.deleteMany({ where: { id: foreignAuditoriumId } });
    if (adminCinemaId) await prisma.cinema.deleteMany({ where: { id: adminCinemaId } });
    if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-API-01][TC-SEC-15][TC-SEC-16][TC-SEC-19][TC-SEC-34][TC-PLAN-01][TC-PLAN-02][TC-PLAN-03][TC-PLAN-04][TC-PLAN-05][TC-PLAN-09] enforces auth, booking boundaries, payment/report rules, concurrency, and one-use staff check-in", async () => {
    const guestHold = await request(app).post("/api/holds").send({ showtimeId, seatIds: ["missing"] });
    expect(guestHold.status).toBe(401);
    expectSafeError(guestHold);

    const registered = await request(app).post("/api/auth/register").send({ name: "HTTP Customer A", email: `customer-a-${fixture}@test.local`, password: "CustomerIntegration123!" });
    expect(registered.status).toBe(201);
    expect(registered.body.user.role).toBe("CUSTOMER");
    expect(registered.body.user).not.toHaveProperty("passwordHash");
    const duplicateRegistration = await request(app).post("/api/auth/register").send({ name: "Duplicate Customer", email: `customer-a-${fixture}@test.local`, password: "CustomerIntegration123!" });
    expect(duplicateRegistration.status).toBe(409);
    expect(duplicateRegistration.body.error).toBe("EMAIL_TAKEN");
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
    const foreignSeat = await prisma.seat.findFirstOrThrow({ where: { auditoriumId: foreignAuditoriumId }, select: { id: true } });
    const holdBoundarySnapshot = async () => ({
      holds: await prisma.seatHold.count({ where: { userId: customerAId, showtimeId } }),
      claims: await prisma.seatClaim.count({ where: { showtimeId } }),
      audit: await prisma.auditLog.count({ where: { actorId: customerAId, action: "SEATS_HELD" } }),
    });
    const beforeMixedAuditoriumAttempt = await holdBoundarySnapshot();
    const mixedAuditoriumHold = await request(app).post("/api/holds").set(authA).send({ showtimeId, seatIds: [seatIds[0], foreignSeat.id] });
    expect(mixedAuditoriumHold.status).toBe(422);
    expect(mixedAuditoriumHold.body.error).toBe("SEAT_NOT_FOUND");
    expect(await holdBoundarySnapshot()).toEqual(beforeMixedAuditoriumAttempt);

    const beforeOwnerSpoofAttempt = await holdBoundarySnapshot();
    const ownerSpoofHold = await request(app).post("/api/holds").set(authA).send({ showtimeId, seatIds: [seatIds[0]], userId: userIds[1] });
    expect(ownerSpoofHold.status).toBe(422);
    expect(await holdBoundarySnapshot()).toEqual(beforeOwnerSpoofAttempt);

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
    const summaryBeforeOrder = (await request(app).get("/api/admin/summary").set(adminAuth)).body as { orders: number; tickets: number; confirmedRevenueVnd: number };
    const orderResponse = await request(app).post("/api/orders").set(authA).send({ holdId: holdResponse.body.id });
    expect(orderResponse.status).toBe(201);
    expect(orderResponse.body.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect((await request(app).get(`/api/orders/${orderResponse.body.id}`).set(authB)).status).toBe(404);

    const summaryWhilePending = (await request(app).get("/api/admin/summary").set(adminAuth)).body as { orders: number; tickets: number; confirmedRevenueVnd: number };
    expect(summaryWhilePending.orders).toBe(summaryBeforeOrder.orders + 1);
    expect(summaryWhilePending.tickets).toBe(summaryBeforeOrder.tickets);
    expect(summaryWhilePending.confirmedRevenueVnd).toBe(summaryBeforeOrder.confirmedRevenueVnd);
    const payment = await request(app).post("/api/payments/mock/complete").set(authA).send({ orderId: orderResponse.body.id });
    expect(payment.status).toBe(200);
    expect(payment.body.tickets).toHaveLength(1);
    const retryPayment = await request(app).post("/api/payments/mock/complete").set(authA).send({ orderId: orderResponse.body.id });
    expect(retryPayment.status).toBe(200);
    expect(retryPayment.body.tickets[0].id).toBe(payment.body.tickets[0].id);
    expect(await prisma.ticket.count({ where: { orderId: orderResponse.body.id } })).toBe(1);
    const summaryAfterConfirmation = (await request(app).get("/api/admin/summary").set(adminAuth)).body as { orders: number; tickets: number; confirmedRevenueVnd: number };
    expect(summaryAfterConfirmation.orders).toBe(summaryWhilePending.orders);
    expect(summaryAfterConfirmation.tickets).toBe(summaryWhilePending.tickets + 1);
    expect(summaryAfterConfirmation.confirmedRevenueVnd).toBe(summaryWhilePending.confirmedRevenueVnd + orderResponse.body.totalVnd);
    const fixtureShowtime = await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeId! }, select: { startAt: true } });
    const fixtureDate = formatBusinessDate(fixtureShowtime.startAt);
    const nextCalendarDate = new Date(`${fixtureDate}T00:00:00.000Z`);
    nextCalendarDate.setUTCDate(nextCalendarDate.getUTCDate() + 1);
    const nextFixtureDate = nextCalendarDate.toISOString().slice(0, 10);
    const nextDayBoundary = calendarDateAtTime(nextFixtureDate, 0);
    const crossCinemaBoundaryStart = calendarDateAtTime(fixtureDate, 23, 59);
    const boundaryShowtime = await prisma.showtime.create({
      data: {
        movieId: movieId!,
        auditoriumId: foreignAuditoriumId!,
        startAt: nextDayBoundary,
        endAt: new Date(nextDayBoundary.getTime() + 90 * 60_000),
        priceVnd: 90_000
      }
    });
    occupancyBoundaryShowtimeId = boundaryShowtime.id;
    const crossCinemaBoundaryShowtime = await prisma.showtime.create({
      data: {
        movieId: movieId!,
        auditoriumId: adminAuditoriumId!,
        startAt: crossCinemaBoundaryStart,
        endAt: new Date(crossCinemaBoundaryStart.getTime() + 90 * 60_000),
        priceVnd: 90_000
      }
    });
    occupancyCrossCinemaShowtimeId = crossCinemaBoundaryShowtime.id;
    const heldOccupancyHold = await prisma.seatHold.create({
      data: { userId: customerAId, showtimeId: showtimeId!, expiresAt: new Date(Date.now() + 10 * 60_000) }
    });
    try {
      await prisma.seatClaim.create({
        data: { showtimeId: showtimeId!, seatId: seatIds[1]!, holdId: heldOccupancyHold.id, status: ClaimStatus.HELD, expiresAt: heldOccupancyHold.expiresAt, priceVnd: 90_000 }
      });
      const occupancyWithHeldClaim = await request(app).get(`/api/admin/reports/occupancy?from=${fixtureDate}&to=${fixtureDate}`).set(adminAuth);
      expect(occupancyWithHeldClaim.status).toBe(200);
      expect(occupancyWithHeldClaim.body.showtimeCount).toBe(2);
      expect(occupancyWithHeldClaim.body.soldSeats).toBe(1);
      expect(occupancyWithHeldClaim.body.capacitySeats).toBe(10);
      expect(occupancyWithHeldClaim.body.fillRatePercent).toBe(10);
      expect(occupancyWithHeldClaim.body.definition).toContain("SeatClaim SOLD");
    } finally {
      await prisma.seatClaim.deleteMany({ where: { holdId: heldOccupancyHold.id } });
      await prisma.seatHold.delete({ where: { id: heldOccupancyHold.id } });
    }

    const incompleteRange = await request(app).get("/api/admin/reports/occupancy").query({ from: fixtureDate }).set(adminAuth);
    expect(incompleteRange.status).toBe(422);
    expect(incompleteRange.body.error).toBe("VALIDATION_ERROR");
    const invalidCalendarDate = await request(app).get("/api/admin/reports/occupancy").query({ from: "2026-02-30", to: "2026-02-30" }).set(adminAuth);
    expect(invalidCalendarDate.status).toBe(422);
    expect(invalidCalendarDate.body.error).toBe("VALIDATION_ERROR");
    const unsupportedFilter = await request(app).get("/api/admin/reports/occupancy").query({ from: fixtureDate, to: fixtureDate, cinemaId }).set(adminAuth);
    expect(unsupportedFilter.status).toBe(422);
    expect(unsupportedFilter.body.error).toBe("VALIDATION_ERROR");
    const reversedRange = await request(app).get("/api/admin/reports/occupancy").query({ from: nextFixtureDate, to: fixtureDate }).set(adminAuth);
    expect(reversedRange.status).toBe(422);
    expect(reversedRange.body.error).toBe("INVALID_DATE_RANGE");

    const inclusiveEndDateRange = await request(app).get("/api/admin/reports/occupancy")
      .query({ from: fixtureDate, to: nextFixtureDate }).set(adminAuth);
    expect(inclusiveEndDateRange.status).toBe(200);
    expect(inclusiveEndDateRange.body).toMatchObject({ showtimeCount: 3, soldSeats: 1, capacitySeats: 11, fillRatePercent: 9.09 });
    const nextDateOnlyRange = await request(app).get("/api/admin/reports/occupancy")
      .query({ from: nextFixtureDate, to: nextFixtureDate }).set(adminAuth);
    expect(nextDateOnlyRange.status).toBe(200);
    expect(nextDateOnlyRange.body).toMatchObject({ showtimeCount: 1, soldSeats: 0, capacitySeats: 1, fillRatePercent: 0 });

    const emptyDate = "2099-12-30";
    const emptyRangeStart = calendarDateAtTime(emptyDate, 0);
    const emptyRangeEnd = calendarDateAtTime(emptyDate, 0);
    emptyRangeEnd.setUTCDate(emptyRangeEnd.getUTCDate() + 1);
    const activeShowtimesOnEmptyDate = await prisma.showtime.count({
      where: { status: RecordStatus.ACTIVE, startAt: { gte: emptyRangeStart, lt: emptyRangeEnd } }
    });
    expect(activeShowtimesOnEmptyDate).toBe(0);
    const emptyRange = await request(app).get("/api/admin/reports/occupancy")
      .query({ from: emptyDate, to: emptyDate }).set(adminAuth);
    expect(emptyRange.status).toBe(200);
    expect(emptyRange.body).toMatchObject({ showtimeCount: 0, soldSeats: 0, capacitySeats: 0, fillRatePercent: 0 });
    expect((await request(app).get("/api/admin/summary").set(adminAuth)).body.occupancy.capacitySeats).toBeGreaterThanOrEqual(9);

    const staffLogin = await request(app).post("/api/auth/login").send({ email: `staff-${fixture}@test.local`, password: "StaffIntegration123!" });
    expect(staffLogin.status).toBe(200);
    const staffAuth = { Authorization: `Bearer ${staffLogin.body.token as string}` };
    const ticketId = payment.body.tickets[0].id as string;
    const ticketQrToken = payment.body.tickets[0].qrToken as string;
    const ticketBeforeQrRace = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticketBeforeQrRace.checkedInAt).toBeNull();
    const checkInAuditCountBeforeQrRace = await prisma.auditLog.count({ where: { action: "TICKET_CHECKED_IN", entityId: ticketId } });
    const qrRaceResults = await Promise.all([
      request(app).post("/api/tickets/scan").set(staffAuth).send({ qrToken: ticketQrToken }),
      request(app).post("/api/tickets/scan").set(adminAuth).send({ qrToken: ticketQrToken })
    ]);
    expect(qrRaceResults.map((result) => result.status).sort()).toEqual([200, 409]);
    const successfulQrRace = qrRaceResults.find((result) => result.status === 200);
    expect(successfulQrRace?.body.ticketId).toBe(ticketId);
    expect(qrRaceResults.find((result) => result.status === 409)?.body.error).toBe("TICKET_ALREADY_USED");
    const ticketAfterQrRace = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticketAfterQrRace).toMatchObject({
      id: ticketBeforeQrRace.id,
      orderId: ticketBeforeQrRace.orderId,
      seatClaimId: ticketBeforeQrRace.seatClaimId,
      qrToken: ticketBeforeQrRace.qrToken,
      createdAt: ticketBeforeQrRace.createdAt
    });
    expect(ticketAfterQrRace.checkedInAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "TICKET_CHECKED_IN", entityId: ticketId } })).toBe(checkInAuditCountBeforeQrRace + 1);
    expect(await prisma.ticket.count({ where: { orderId: orderResponse.body.id, checkedInAt: { not: null } } })).toBe(1);
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

    const amountMismatchEvent = {
      eventId: `evt-amount-mismatch-${fixture}`,
      orderId: secondOrder.body.id as string,
      status: "SUCCEEDED" as const,
      amountVnd: (secondOrder.body.totalVnd as number) + 1,
      currency: "VND" as const
    };
    const paymentWebhookSecret = process.env.MOCK_PAYMENT_SECRET || "cinema-booking-local-mock-payment-secret-2026";
    const amountMismatchSnapshot = async () => ({
      order: await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: secondOrder.body.id as string } }),
      hold: await prisma.seatHold.findUniqueOrThrow({ where: { id: secondHold.body.id as string } }),
      payment: await prisma.payment.findUnique({ where: { orderId: secondOrder.body.id as string } }),
      claims: await prisma.seatClaim.findMany({ where: { orderId: secondOrder.body.id as string }, orderBy: { id: "asc" } }),
      tickets: await prisma.ticket.findMany({ where: { orderId: secondOrder.body.id as string }, orderBy: { id: "asc" } }),
      paymentEvents: await prisma.paymentEvent.findMany({ where: { orderId: secondOrder.body.id as string }, orderBy: { id: "asc" } }),
      outboxEvents: await prisma.outboxEvent.findMany({ where: { aggregateId: secondOrder.body.id as string }, orderBy: { id: "asc" } }),
      reconciliationCases: await prisma.reconciliationCase.findMany({ where: { orderId: secondOrder.body.id as string }, orderBy: { id: "asc" } }),
      audits: await prisma.auditLog.findMany({ where: { entityId: secondOrder.body.id as string }, orderBy: { id: "asc" } })
    });
    const beforeAmountMismatch = await amountMismatchSnapshot();
    const signedAmountMismatch = await request(app).post("/api/payments/mock/webhook")
      .set("x-mock-signature", signMockPaymentEvent(amountMismatchEvent, paymentWebhookSecret))
      .send(amountMismatchEvent);
    expect(signedAmountMismatch.status).toBe(422);
    expect(signedAmountMismatch.body.error).toBe("PAYMENT_AMOUNT_MISMATCH");
    expectSafeError(signedAmountMismatch);
    expect(await amountMismatchSnapshot()).toEqual(beforeAmountMismatch);

    const stillPending = await request(app).get(`/api/orders/${secondOrder.body.id}`).set(authA);
    expect(stillPending.body.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect(stillPending.body.tickets).toHaveLength(0);
    expect(await prisma.seatHold.count({ where: { id: secondHold.body.id } })).toBe(1);

    const revenueWithPending = (await request(app).get("/api/admin/summary").set(adminAuth)).body.confirmedRevenueVnd as number;
    expect(revenueWithPending).toBe(summaryAfterConfirmation.confirmedRevenueVnd);
    const failedPayment = await request(app).post("/api/payments/mock/complete").set(authA).send({ orderId: secondOrder.body.id, outcome: "FAILED" });
    expect(failedPayment.status).toBe(402);
    const failedOrder = await request(app).get(`/api/orders/${secondOrder.body.id}`).set(authA);
    expect(failedOrder.body.status).toBe(OrderStatus.PAYMENT_FAILED);
    expect(failedOrder.body.tickets).toHaveLength(0);
    const revenueWithFailed = (await request(app).get("/api/admin/summary").set(adminAuth)).body.confirmedRevenueVnd as number;
    expect(revenueWithFailed).toBe(summaryAfterConfirmation.confirmedRevenueVnd);

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

    const webhookSuccessOrder = await request(app).post("/api/orders").set(authB).send({ holdId: releasedLateSeat.body.id });
    expect(webhookSuccessOrder.status).toBe(201);
    const validWebhookEvent = {
      eventId: `evt-http-success-${fixture}`,
      orderId: webhookSuccessOrder.body.id as string,
      status: "SUCCEEDED" as const,
      amountVnd: webhookSuccessOrder.body.totalVnd as number,
      currency: "VND" as const
    };
    const validWebhookSignature = signMockPaymentEvent(validWebhookEvent, paymentWebhookSecret);
    const validWebhook = await request(app).post("/api/payments/mock/webhook")
      .set("x-mock-signature", validWebhookSignature)
      .send(validWebhookEvent);
    expect(validWebhook.status).toBe(200);
    expect(validWebhook.body).toEqual({ accepted: true, idempotent: false, orderId: webhookSuccessOrder.body.id });

    const successfulWebhookState = async () => ({
      order: await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: validWebhookEvent.orderId } }),
      payment: await prisma.payment.findUniqueOrThrow({ where: { orderId: validWebhookEvent.orderId } }),
      events: await prisma.paymentEvent.findMany({ where: { orderId: validWebhookEvent.orderId }, orderBy: { id: "asc" } }),
      tickets: await prisma.ticket.findMany({ where: { orderId: validWebhookEvent.orderId }, orderBy: { id: "asc" } }),
      audits: await prisma.auditLog.findMany({ where: { entityId: validWebhookEvent.orderId, action: "PAYMENT_CONFIRMED" }, orderBy: { id: "asc" } })
    });
    const afterWebhookSuccess = await successfulWebhookState();
    expect(afterWebhookSuccess.events).toHaveLength(1);
    expect(afterWebhookSuccess.tickets).toHaveLength(1);
    expect(afterWebhookSuccess.audits).toHaveLength(1);

    const identicalWebhookRetry = await request(app).post("/api/payments/mock/webhook")
      .set("x-mock-signature", validWebhookSignature)
      .send(validWebhookEvent);
    expect(identicalWebhookRetry.status).toBe(200);
    expect(identicalWebhookRetry.body.idempotent).toBe(true);
    expect(identicalWebhookRetry.body).toEqual({ accepted: true, idempotent: true, orderId: webhookSuccessOrder.body.id });
    expect(identicalWebhookRetry.body).not.toHaveProperty("tickets");
    expect(JSON.stringify(identicalWebhookRetry.body)).not.toContain(afterWebhookSuccess.tickets[0]!.qrToken);
    expect(await successfulWebhookState()).toEqual(afterWebhookSuccess);

    const changedReplayEvent = { ...validWebhookEvent, amountVnd: validWebhookEvent.amountVnd + 1 };
    const changedReplay = await request(app).post("/api/payments/mock/webhook")
      .set("x-mock-signature", signMockPaymentEvent(changedReplayEvent, paymentWebhookSecret))
      .send(changedReplayEvent);
    expect(changedReplay.status).toBe(409);
    expect(changedReplay.body.error).toBe("PAYMENT_EVENT_REPLAY");
    expectSafeError(changedReplay);
    expect(await successfulWebhookState()).toEqual(afterWebhookSuccess);

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
      .set({ Authorization: `Bearer ${createToken({ id: user.id, authVersion: 0 })}` })
      .send({ showtimeId, seatIds: [seatIds[4]] })));
    expect(raceResults.filter((result) => result.status === 201)).toHaveLength(1);
    expect(raceResults.filter((result) => result.status === 409)).toHaveLength(99);
    expect(raceResults.every((result) => result.status === 201 || result.status === 409)).toBe(true);
    const raceClaim = await prisma.seatClaim.findUniqueOrThrow({ where: { showtimeId_seatId: { showtimeId: showtimeId!, seatId: seatIds[4]! } } });
    expect(raceClaim.status).toBe("HELD");
    expect(await prisma.seatClaim.count({ where: { showtimeId, seatId: seatIds[4], status: "HELD" } })).toBe(1);
  }, 90_000);

  it("[TC-SEC-20] rejects a signed provider event replayed against a different order without side effects", async () => {
    const seats = await prisma.seat.findMany({ where: { auditoriumId }, orderBy: { column: "asc" }, select: { id: true } });
    const now = new Date();
    const existingClaims = await prisma.seatClaim.findMany({ where: { showtimeId }, select: { seatId: true, status: true, expiresAt: true } });
    const occupiedSeatIds = new Set(existingClaims
      .filter((claim) => claim.status === "SOLD" || (claim.status === "HELD" && claim.expiresAt !== null && claim.expiresAt > now))
      .map((claim) => claim.seatId));
    const availableSeatIds = seats.map((seat) => seat.id).filter((seatId) => !occupiedSeatIds.has(seatId));
    expect(availableSeatIds.length).toBeGreaterThanOrEqual(2);

    const customer = await prisma.user.create({
      data: {
        name: "Webhook Replay Customer",
        email: `webhook-replay-${fixture}@test.local`,
        passwordHash: "unused-in-webhook-replay-test",
        role: Role.CUSTOMER
      }
    });
    userIds.push(customer.id);
    const customerAuth = { Authorization: `Bearer ${createToken({ id: customer.id, authVersion: customer.authVersion })}` };
    const replayCustomer = await prisma.user.create({
      data: {
        name: "Webhook Replay Customer B",
        email: `webhook-replay-b-${fixture}@test.local`,
        passwordHash: "unused-in-webhook-replay-test",
        role: Role.CUSTOMER
      }
    });
    userIds.push(replayCustomer.id);
    const replayCustomerAuth = { Authorization: `Bearer ${createToken({ id: replayCustomer.id, authVersion: replayCustomer.authVersion })}` };
    const createPendingOrder = async (seatId: string, auth: typeof customerAuth) => {
      const hold = await request(app).post("/api/holds").set(auth).send({ showtimeId, seatIds: [seatId] });
      expect(hold.status).toBe(201);
      const order = await request(app).post("/api/orders").set(auth).send({ holdId: hold.body.id as string });
      expect(order.status).toBe(201);
      expect(order.body.status).toBe(OrderStatus.PAYMENT_PENDING);
      return {
        holdId: hold.body.id as string,
        orderId: order.body.id as string,
        totalVnd: order.body.totalVnd as number,
        seatId
      };
    };

    const original = await createPendingOrder(availableSeatIds[0]!, customerAuth);
    const second = await createPendingOrder(availableSeatIds[1]!, replayCustomerAuth);
    const eventId = `evt-cross-order-replay-${fixture}`;
    const webhookSecret = process.env.MOCK_PAYMENT_SECRET || "cinema-booking-local-mock-payment-secret-2026";
    const originalEvent = {
      eventId,
      orderId: original.orderId,
      status: "SUCCEEDED" as const,
      amountVnd: original.totalVnd,
      currency: "VND" as const
    };
    const originalCallback = await request(app).post("/api/payments/mock/webhook")
      .set("x-mock-signature", signMockPaymentEvent(originalEvent, webhookSecret))
      .send(originalEvent);
    expect(originalCallback.status).toBe(200);
    expect(originalCallback.body.idempotent).toBe(false);
    expect(originalCallback.body).toEqual({ accepted: true, idempotent: false, orderId: original.orderId });
    expect(originalCallback.body).not.toHaveProperty("tickets");

    const orderState = async (order: typeof original) => ({
      order: await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: order.orderId } }),
      hold: await prisma.seatHold.findUniqueOrThrow({ where: { id: order.holdId } }),
      payment: await prisma.payment.findUnique({ where: { orderId: order.orderId } }),
      claim: await prisma.seatClaim.findUniqueOrThrow({ where: { showtimeId_seatId: { showtimeId: showtimeId!, seatId: order.seatId } } }),
      tickets: await prisma.ticket.findMany({ where: { orderId: order.orderId }, orderBy: { id: "asc" } }),
      paymentEvents: await prisma.paymentEvent.findMany({ where: { orderId: order.orderId }, orderBy: { id: "asc" } }),
      outboxEvents: await prisma.outboxEvent.findMany({ where: { aggregateId: order.orderId }, orderBy: { id: "asc" } }),
      reconciliationCases: await prisma.reconciliationCase.findMany({ where: { orderId: order.orderId }, orderBy: { id: "asc" } }),
      audits: await prisma.auditLog.findMany({ where: { entityId: order.orderId }, orderBy: { id: "asc" } })
    });

    const originalBeforeReplay = await orderState(original);
    const secondBeforeReplay = await orderState(second);
    expect(originalBeforeReplay.order.status).toBe(OrderStatus.CONFIRMED);
    expect(originalBeforeReplay.paymentEvents).toHaveLength(1);
    expect(originalBeforeReplay.tickets).toHaveLength(1);
    expect(originalBeforeReplay.audits.map((auditEntry) => auditEntry.action)).toContain("PAYMENT_CONFIRMED");
    expect(secondBeforeReplay.order.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect(secondBeforeReplay.payment).toBeNull();
    expect(secondBeforeReplay.tickets).toHaveLength(0);
    expect(secondBeforeReplay.paymentEvents).toHaveLength(0);

    const replayAgainstSecondOrder = {
      ...originalEvent,
      orderId: second.orderId,
      amountVnd: second.totalVnd
    };
    const replay = await request(app).post("/api/payments/mock/webhook")
      .set("x-mock-signature", signMockPaymentEvent(replayAgainstSecondOrder, webhookSecret))
      .send(replayAgainstSecondOrder);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("PAYMENT_EVENT_REPLAY");
    expectSafeError(replay);
    expect(await orderState(second)).toEqual(secondBeforeReplay);
    expect(await orderState(original)).toEqual(originalBeforeReplay);
  }, 30_000);

  it("[TC-SEC-47] keeps expired-payment reconciliation required across late callback orderings", async () => {
    const customer = await prisma.user.create({
      data: {
        name: "Late Payment Reconciliation Customer",
        email: `late-reconciliation-${fixture}@test.local`,
        passwordHash: await hashPassword("LateReconciliation123!"),
        role: Role.CUSTOMER
      }
    });
    userIds.push(customer.id);
    const auth = { Authorization: `Bearer ${createToken({ id: customer.id, authVersion: customer.authVersion })}` };
    const webhookSecret = process.env.MOCK_PAYMENT_SECRET || "cinema-booking-local-mock-payment-secret-2026";
    const seats = await prisma.seat.findMany({ where: { auditoriumId }, orderBy: { column: "asc" }, select: { id: true } });
    const now = new Date();
    const claims = await prisma.seatClaim.findMany({ where: { showtimeId }, select: { seatId: true, status: true, expiresAt: true } });
    const occupiedSeatIds = new Set(claims
      .filter((claim) => claim.status === "SOLD" || (claim.status === "HELD" && claim.expiresAt !== null && claim.expiresAt > now))
      .map((claim) => claim.seatId));
    const availableSeatIds = seats.map((seat) => seat.id).filter((seatId) => !occupiedSeatIds.has(seatId));
    expect(availableSeatIds.length).toBeGreaterThanOrEqual(3);

    const createExpiredOrder = async (seatId: string) => {
      const hold = await request(app).post("/api/holds").set(auth).send({ showtimeId, seatIds: [seatId] });
      expect(hold.status).toBe(201);
      const order = await request(app).post("/api/orders").set(auth).send({ holdId: hold.body.id });
      expect(order.status).toBe(201);
      await prisma.seatHold.update({ where: { id: hold.body.id as string }, data: { expiresAt: new Date(Date.now() - 1) } });
      await prisma.seatClaim.updateMany({ where: { orderId: order.body.id as string, status: "HELD" }, data: { expiresAt: new Date(Date.now() - 1) } });
      return { holdId: hold.body.id as string, orderId: order.body.id as string, amountVnd: order.body.totalVnd as number };
    };
    const deliver = async (order: { orderId: string; amountVnd: number }, status: "SUCCEEDED" | "FAILED", eventId: string) => {
      const event = { eventId, orderId: order.orderId, status, amountVnd: order.amountVnd, currency: "VND" as const };
      const response = await request(app).post("/api/payments/mock/webhook")
        .set("x-mock-signature", signMockPaymentEvent(event, webhookSecret))
        .send(event);
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("PAYMENT_TOO_LATE");
      return event;
    };

    const successThenFailureOrder = await createExpiredOrder(availableSeatIds[0]!);
    const successEvent = await deliver(successThenFailureOrder, "SUCCEEDED", `evt-sticky-success-${fixture}`);
    await deliver(successThenFailureOrder, "FAILED", `evt-sticky-failure-${fixture}`);
    const afterSuccessThenFailure = await prisma.payment.findUniqueOrThrow({ where: { orderId: successThenFailureOrder.orderId } });
    expect(afterSuccessThenFailure.status).toBe("RECONCILIATION_REQUIRED");
    expect(afterSuccessThenFailure.providerEventId).toBe(successEvent.eventId);

    const failureThenSuccessOrder = await createExpiredOrder(availableSeatIds[1]!);
    await deliver(failureThenSuccessOrder, "FAILED", `evt-reverse-failure-${fixture}`);
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderId: failureThenSuccessOrder.orderId } }).then((payment) => payment.status)).toBe("FAILED");
    const reverseSuccessEvent = await deliver(failureThenSuccessOrder, "SUCCEEDED", `evt-reverse-success-${fixture}`);
    const afterFailureThenSuccess = await prisma.payment.findUniqueOrThrow({ where: { orderId: failureThenSuccessOrder.orderId } });
    expect(afterFailureThenSuccess.status).toBe("RECONCILIATION_REQUIRED");
    expect(afterFailureThenSuccess.providerEventId).toBe(reverseSuccessEvent.eventId);

    const concurrentOrder = await createExpiredOrder(availableSeatIds[2]!);
    const concurrentSuccess = { eventId: `evt-concurrent-success-${fixture}`, orderId: concurrentOrder.orderId, status: "SUCCEEDED" as const, amountVnd: concurrentOrder.amountVnd, currency: "VND" as const };
    const concurrentFailure = { eventId: `evt-concurrent-failure-${fixture}`, orderId: concurrentOrder.orderId, status: "FAILED" as const, amountVnd: concurrentOrder.amountVnd, currency: "VND" as const };
    const concurrentResponses = await Promise.all([concurrentSuccess, concurrentFailure].map((event) => request(app)
      .post("/api/payments/mock/webhook")
      .set("x-mock-signature", signMockPaymentEvent(event, webhookSecret))
      .send(event)));
    expect(concurrentResponses.every((response) => response.status === 409 && response.body.error === "PAYMENT_TOO_LATE")).toBe(true);
    const afterConcurrentCallbacks = await prisma.payment.findUniqueOrThrow({ where: { orderId: concurrentOrder.orderId } });
    expect(afterConcurrentCallbacks.status).toBe("RECONCILIATION_REQUIRED");
    expect(afterConcurrentCallbacks.providerEventId).toBe(concurrentSuccess.eventId);

    for (const order of [successThenFailureOrder, failureThenSuccessOrder, concurrentOrder]) {
      expect(await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: order.orderId } }).then((row) => row.status)).toBe(OrderStatus.EXPIRED);
      expect(await prisma.ticket.count({ where: { orderId: order.orderId } })).toBe(0);
      expect(await prisma.paymentEvent.count({ where: { orderId: order.orderId } })).toBe(2);
    }
    for (const event of [successEvent, reverseSuccessEvent, concurrentSuccess]) {
      expect(await prisma.outboxEvent.count({ where: { eventKey: `payment-reconciliation:${event.eventId}` } })).toBe(1);
    }
    await processOutboxBatch(prisma);
    for (const event of [successEvent, reverseSuccessEvent, concurrentSuccess]) {
      expect(await prisma.reconciliationCase.findUniqueOrThrow({ where: { providerEventId: event.eventId } }).then((row) => row.status)).toBe("OPEN");
    }
  }, 90_000);

  it("[TC-SEC-22] handles two parallel identical signed webhook HTTP requests idempotently", async () => {
    const customer = await prisma.user.create({
      data: {
        name: "Concurrent Webhook Customer",
        email: `webhook-concurrent-${fixture}@test.local`,
        passwordHash: "unused-in-concurrent-webhook-test",
        role: Role.CUSTOMER
      }
    });
    userIds.push(customer.id);
    const customerAuth = { Authorization: `Bearer ${createToken({ id: customer.id, authVersion: customer.authVersion })}` };
    const now = new Date();
    const claims = await prisma.seatClaim.findMany({ where: { showtimeId }, select: { seatId: true, status: true, expiresAt: true } });
    const occupiedSeatIds = new Set(claims
      .filter((claim) => claim.status === "SOLD" || (claim.status === "HELD" && claim.expiresAt !== null && claim.expiresAt > now))
      .map((claim) => claim.seatId));
    const availableSeat = await prisma.seat.findFirst({
      where: { auditoriumId, id: { notIn: [...occupiedSeatIds] } },
      orderBy: { column: "asc" },
      select: { id: true }
    });
    expect(availableSeat).not.toBeNull();

    const hold = await request(app).post("/api/holds").set(customerAuth).send({ showtimeId, seatIds: [availableSeat!.id] });
    expect(hold.status).toBe(201);
    const order = await request(app).post("/api/orders").set(customerAuth).send({ holdId: hold.body.id as string });
    expect(order.status).toBe(201);
    expect(order.body.status).toBe(OrderStatus.PAYMENT_PENDING);

    const event = {
      eventId: `evt-concurrent-webhook-${fixture}`,
      orderId: order.body.id as string,
      status: "SUCCEEDED" as const,
      amountVnd: order.body.totalVnd as number,
      currency: "VND" as const
    };
    const secret = process.env.MOCK_PAYMENT_SECRET || "cinema-booking-local-mock-payment-secret-2026";
    const signature = signMockPaymentEvent(event, secret);
    const [first, second] = await Promise.all([
      request(app).post("/api/payments/mock/webhook").set("x-mock-signature", signature).send(event),
      request(app).post("/api/payments/mock/webhook").set("x-mock-signature", signature).send(event)
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect([first.body.idempotent, second.body.idempotent].sort((left: boolean, right: boolean) => Number(left) - Number(right))).toEqual([false, true]);
    for (const response of [first, second]) {
      expect(response.body).toMatchObject({ accepted: true, orderId: event.orderId });
      expect(Object.keys(response.body).sort()).toEqual(["accepted", "idempotent", "orderId"]);
      expect(JSON.stringify(response.body)).not.toContain("qrToken");
    }

    expect(await prisma.paymentEvent.count({ where: { providerEventId: event.eventId, orderId: event.orderId } })).toBe(1);
    expect(await prisma.ticket.count({ where: { orderId: event.orderId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_CONFIRMED", entity: "CinemaOrder", entityId: event.orderId } })).toBe(1);
    expect(await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: event.orderId } }).then((item) => item.status)).toBe(OrderStatus.CONFIRMED);
  }, 30_000);
});
