import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";
import { formatBusinessDate } from "../src/domain/booking-policy.js";

const availabilityDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

availabilityDescribe("TC-CAT-05 inactive catalog availability gate", () => {
  const app = createApp();
  const fixture = randomUUID();
  const cinemaIds: string[] = [];
  const auditoriumIds: string[] = [];
  const seatIds: string[] = [];
  const movieIds: string[] = [];
  const showtimeIds: string[] = [];
  const userIds: string[] = [];
  let cinemaAId: string;
  let cinemaBId: string;
  let auditoriumAId: string;
  let auditoriumBId: string;
  let seatAId: string;
  let movieAId: string;
  let movieBId: string;
  let showtimeAId: string;
  let showtimeBId: string;
  let adminId: string;
  let customerId: string;
  let adminToken: string;
  let customerToken: string;
  let showtimeStart: Date;

  beforeAll(async () => {
    await prisma.$connect();
    const cinemaA = await prisma.cinema.create({ data: { name: `Inactive gate A ${fixture}`, city: "Test", address: "Availability fixture A", status: RecordStatus.ACTIVE } });
    cinemaIds.push(cinemaA.id);
    const cinemaB = await prisma.cinema.create({ data: { name: `Inactive gate B ${fixture}`, city: "Test", address: "Availability fixture B", status: RecordStatus.ACTIVE } });
    cinemaIds.push(cinemaB.id);
    cinemaAId = cinemaA.id;
    cinemaBId = cinemaB.id;

    const auditoriumA = await prisma.auditorium.create({ data: { cinemaId: cinemaA.id, name: `Inactive gate room A ${fixture}` } });
    auditoriumIds.push(auditoriumA.id);
    const auditoriumB = await prisma.auditorium.create({ data: { cinemaId: cinemaB.id, name: `Inactive gate room B ${fixture}` } });
    auditoriumIds.push(auditoriumB.id);
    auditoriumAId = auditoriumA.id;
    auditoriumBId = auditoriumB.id;
    const seatA = await prisma.seat.create({ data: { auditoriumId: auditoriumA.id, label: "A1", row: "A", column: 1, type: SeatType.STANDARD } });
    seatIds.push(seatA.id);
    const seatB = await prisma.seat.create({ data: { auditoriumId: auditoriumB.id, label: "B1", row: "B", column: 1, type: SeatType.STANDARD } });
    seatAId = seatA.id;
    seatIds.push(seatB.id);

    const movieA = await prisma.movie.create({ data: { slug: `inactive-gate-a-${fixture}`, title: `Inactive gate A ${fixture}`, genre: "Test", synopsis: "Active movie for inactive cinema availability checks.", runtimeMinutes: 90, ageRating: "P", status: RecordStatus.ACTIVE } });
    movieIds.push(movieA.id);
    const movieB = await prisma.movie.create({ data: { slug: `inactive-gate-b-${fixture}`, title: `Inactive gate B ${fixture}`, genre: "Test", synopsis: "Movie for catalog status mutation checks.", runtimeMinutes: 90, ageRating: "P", status: RecordStatus.ACTIVE } });
    movieAId = movieA.id;
    movieBId = movieB.id;
    movieIds.push(movieB.id);

    showtimeStart = new Date(Date.now() + 4 * 86_400_000);
    const showtimeA = await prisma.showtime.create({ data: { movieId: movieA.id, auditoriumId: auditoriumA.id, startAt: showtimeStart, endAt: new Date(showtimeStart.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE } });
    showtimeIds.push(showtimeA.id);
    const showtimeBStart = new Date(showtimeStart.getTime() + 60 * 60_000);
    const showtimeB = await prisma.showtime.create({ data: { movieId: movieB.id, auditoriumId: auditoriumB.id, startAt: showtimeBStart, endAt: new Date(showtimeBStart.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE } });
    showtimeAId = showtimeA.id;
    showtimeBId = showtimeB.id;
    showtimeIds.push(showtimeB.id);

    const admin = await prisma.user.create({ data: { name: "Inactive Gate Admin", email: `inactive-gate-admin-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN } });
    userIds.push(admin.id);
    const customer = await prisma.user.create({ data: { name: "Inactive Gate Customer", email: `inactive-gate-customer-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    adminId = admin.id;
    customerId = customer.id;
    userIds.push(customer.id);
    adminToken = createToken({ id: admin.id, authVersion: admin.authVersion });
    customerToken = createToken({ id: customer.id, authVersion: customer.authVersion });
  }, 30_000);

  afterAll(async () => {
    try {
      const orders = showtimeIds.length
        ? await prisma.cinemaOrder.findMany({ where: { showtimeId: { in: showtimeIds } }, select: { id: true } })
        : [];
      const orderIds = orders.map((order) => order.id);
      const holds = showtimeIds.length
        ? await prisma.seatHold.findMany({ where: { showtimeId: { in: showtimeIds } }, select: { id: true } })
        : [];
      const holdIds = holds.map((hold) => hold.id);
      const auditEntityIds = [...showtimeIds, ...orderIds, ...holdIds];
      if (userIds.length || auditEntityIds.length) {
        await prisma.auditLog.deleteMany({ where: { OR: [
          ...(userIds.length ? [{ actorId: { in: userIds } }] : []),
          ...(auditEntityIds.length ? [{ entityId: { in: auditEntityIds } }] : [])
        ] } });
      }
      if (orderIds.length) {
        await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.reconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
        await prisma.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.seatClaim.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.cinemaOrder.deleteMany({ where: { id: { in: orderIds } } });
      }
      if (showtimeIds.length) {
        await prisma.seatClaim.deleteMany({ where: { showtimeId: { in: showtimeIds } } });
        await prisma.seatHold.deleteMany({ where: { showtimeId: { in: showtimeIds } } });
        await prisma.showtime.deleteMany({ where: { id: { in: showtimeIds } } });
      }
      if (seatIds.length) await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
      if (movieIds.length) await prisma.movie.deleteMany({ where: { id: { in: movieIds } } });
      if (auditoriumIds.length) await prisma.auditorium.deleteMany({ where: { id: { in: auditoriumIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (cinemaIds.length) await prisma.cinema.deleteMany({ where: { id: { in: cinemaIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it("hides a deactivated cinema's showtime and rejects direct seat, hold, create, and patch attempts without side effects", async () => {
    const date = formatBusinessDate(showtimeStart);
    const publicCatalogBefore = await request(app).get(`/api/showtimes?date=${date}`);
    expect(publicCatalogBefore.status).toBe(200);
    expect(publicCatalogBefore.body.map((showtime: { id: string }) => showtime.id)).toContain(showtimeAId);

    await prisma.cinema.update({ where: { id: cinemaAId }, data: { status: RecordStatus.INACTIVE } });
    await prisma.movie.update({ where: { id: movieBId }, data: { status: RecordStatus.INACTIVE } });

    const publicCatalogAfter = await request(app).get(`/api/showtimes?date=${date}`);
    expect(publicCatalogAfter.status).toBe(200);
    expect(publicCatalogAfter.body.map((showtime: { id: string }) => showtime.id)).not.toContain(showtimeAId);

    const seatMap = await request(app).get(`/api/showtimes/${showtimeAId}/seats`);
    expect(seatMap.status).toBe(404);
    expect(seatMap.body.error).toBe("SHOWTIME_NOT_FOUND");

    const holdsBefore = await prisma.seatHold.count({ where: { showtimeId: showtimeAId } });
    const claimsBefore = await prisma.seatClaim.count({ where: { showtimeId: showtimeAId } });
    const holdAuditsBefore = await prisma.auditLog.count({ where: { actorId: customerId, action: "SEATS_HELD" } });
    const holdAttempt = await request(app).post("/api/holds")
      .set({ Authorization: `Bearer ${customerToken}` })
      .send({ showtimeId: showtimeAId, seatIds: [seatAId] });
    expect(holdAttempt.status).toBe(404);
    expect(holdAttempt.body.error).toBe("SHOWTIME_UNAVAILABLE");
    expect(await prisma.seatHold.count({ where: { showtimeId: showtimeAId } })).toBe(holdsBefore);
    expect(await prisma.seatClaim.count({ where: { showtimeId: showtimeAId } })).toBe(claimsBefore);
    expect(await prisma.auditLog.count({ where: { actorId: customerId, action: "SEATS_HELD" } })).toBe(holdAuditsBefore);

    const showtimesBefore = await prisma.showtime.count({ where: { auditoriumId: { in: auditoriumIds } } });
    const createAuditsBefore = await prisma.auditLog.count({ where: { actorId: adminId, action: "SHOWTIME_CREATED" } });
    const updateAuditsBefore = await prisma.auditLog.count({ where: { actorId: adminId, action: "SHOWTIME_UPDATED" } });
    const inactiveCinemaCreate = await request(app).post("/api/admin/showtimes").set({ Authorization: `Bearer ${adminToken}` }).send({
      movieId: movieAId,
      auditoriumId: auditoriumAId,
      startAt: new Date(showtimeStart.getTime() + 14 * 86_400_000).toISOString(),
      priceVnd: 100_000
    });
    expect(inactiveCinemaCreate.status).toBe(422);
    expect(inactiveCinemaCreate.body.error).toBe("INACTIVE_CATALOG");

    const inactiveMovieCreate = await request(app).post("/api/admin/showtimes").set({ Authorization: `Bearer ${adminToken}` }).send({
      movieId: movieBId,
      auditoriumId: auditoriumBId,
      startAt: new Date(showtimeStart.getTime() + 15 * 86_400_000).toISOString(),
      priceVnd: 100_000
    });
    expect(inactiveMovieCreate.status).toBe(422);
    expect(inactiveMovieCreate.body.error).toBe("INACTIVE_CATALOG");

    const inactiveCinemaPatch = await request(app).patch(`/api/admin/showtimes/${showtimeAId}`)
      .set({ Authorization: `Bearer ${adminToken}` }).send({ priceVnd: 125_000 });
    expect(inactiveCinemaPatch.status).toBe(422);
    expect(inactiveCinemaPatch.body.error).toBe("INACTIVE_CATALOG");

    const inactiveMoviePatch = await request(app).patch(`/api/admin/showtimes/${showtimeBId}`)
      .set({ Authorization: `Bearer ${adminToken}` }).send({ priceVnd: 125_000 });
    expect(inactiveMoviePatch.status).toBe(422);
    expect(inactiveMoviePatch.body.error).toBe("INACTIVE_CATALOG");

    expect(await prisma.showtime.count({ where: { auditoriumId: { in: auditoriumIds } } })).toBe(showtimesBefore);
    expect(await prisma.auditLog.count({ where: { actorId: adminId, action: "SHOWTIME_CREATED" } })).toBe(createAuditsBefore);
    expect(await prisma.auditLog.count({ where: { actorId: adminId, action: "SHOWTIME_UPDATED" } })).toBe(updateAuditsBefore);
    expect(await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeAId } })).toMatchObject({ priceVnd: 100_000, status: RecordStatus.ACTIVE });
    expect(await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeBId } })).toMatchObject({ priceVnd: 100_000, status: RecordStatus.ACTIVE });
  }, 30_000);
});
