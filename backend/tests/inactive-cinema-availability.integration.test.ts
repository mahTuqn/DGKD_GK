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
  const rejectedAuditoriumName = `Rejected inactive-cinema room ${fixture}`;
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

    const movieA = await prisma.movie.create({ data: { slug: `inactive-gate-a-${fixture}`, title: `Inactive gate A ${fixture}`, genre: `Genre-${fixture}`, synopsis: "Active movie for inactive cinema availability checks.", runtimeMinutes: 90, ageRating: "P", status: RecordStatus.ACTIVE } });
    movieIds.push(movieA.id);
    const movieB = await prisma.movie.create({ data: { slug: `inactive-gate-b-${fixture}`, title: `Inactive gate B ${fixture}`, genre: "Test", synopsis: "Movie for catalog status mutation checks.", runtimeMinutes: 90, ageRating: "P", status: RecordStatus.ACTIVE } });
    movieAId = movieA.id;
    movieBId = movieB.id;
    movieIds.push(movieB.id);

    // Both fixtures must share the queried business date. A rolling start
    // near 23:00 in Vietnam would put the second showtime on the next day.
    const fixtureDate = formatBusinessDate(new Date(Date.now() + 4 * 86_400_000));
    showtimeStart = new Date(`${fixtureDate}T12:00:00+07:00`);
    const showtimeA = await prisma.showtime.create({ data: { movieId: movieA.id, auditoriumId: auditoriumA.id, startAt: showtimeStart, endAt: new Date(showtimeStart.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE } });
    showtimeIds.push(showtimeA.id);
    const showtimeBStart = new Date(showtimeStart.getTime() + 60 * 60_000);
    expect(formatBusinessDate(showtimeBStart)).toBe(fixtureDate);
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
      const unexpectedlyCreatedAuditoriums = await prisma.auditorium.findMany({ where: { name: rejectedAuditoriumName }, select: { id: true } });
      const cleanupAuditoriumIds = [...new Set([...auditoriumIds, ...unexpectedlyCreatedAuditoriums.map((item) => item.id)])];
      const orders = showtimeIds.length
        ? await prisma.cinemaOrder.findMany({ where: { showtimeId: { in: showtimeIds } }, select: { id: true } })
        : [];
      const orderIds = orders.map((order) => order.id);
      const holds = showtimeIds.length
        ? await prisma.seatHold.findMany({ where: { showtimeId: { in: showtimeIds } }, select: { id: true } })
        : [];
      const holdIds = holds.map((hold) => hold.id);
      const auditEntityIds = [...showtimeIds, ...orderIds, ...holdIds, ...unexpectedlyCreatedAuditoriums.map((item) => item.id)];
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
      if (cleanupAuditoriumIds.length) await prisma.seat.deleteMany({ where: { auditoriumId: { in: cleanupAuditoriumIds } } });
      if (movieIds.length) await prisma.movie.deleteMany({ where: { id: { in: movieIds } } });
      if (cleanupAuditoriumIds.length) await prisma.auditorium.deleteMany({ where: { id: { in: cleanupAuditoriumIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (cinemaIds.length) await prisma.cinema.deleteMany({ where: { id: { in: cinemaIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it("[TC-CAT-07] validates scalar public-catalog filters and exercises movie search", async () => {
    const titleSearch = await request(app).get("/api/movies").query({ q: `  INACTIVE GATE A ${fixture}  ` });
    expect(titleSearch.status).toBe(200);
    expect(titleSearch.body.map((movie: { id: string }) => movie.id)).toEqual([movieAId]);

    const genreSearch = await request(app).get("/api/movies").query({ q: `  genre-${fixture.toUpperCase()}  ` });
    expect(genreSearch.status).toBe(200);
    expect(genreSearch.body.map((movie: { id: string }) => movie.id)).toEqual([movieAId]);

    const noMatch = await request(app).get("/api/movies").query({ q: `no-such-movie-${fixture}` });
    expect(noMatch.status).toBe(200);
    expect(noMatch.body).toEqual([]);

    const maxLengthSearch = await request(app).get("/api/movies").query({ q: "x".repeat(120) });
    expect(maxLengthSearch.status).toBe(200);
    const overlongSearch = await request(app).get("/api/movies").query({ q: "x".repeat(121) });
    expect(overlongSearch.status).toBe(422);
    expect(overlongSearch.body.error).toBe("VALIDATION_ERROR");

    const repeatedSearch = await request(app).get("/api/movies?q=first&q=second");
    expect(repeatedSearch.status).toBe(422);
    expect(repeatedSearch.body.error).toBe("VALIDATION_ERROR");
    const unsupportedMovieQuery = await request(app).get("/api/movies?unexpected=value");
    expect(unsupportedMovieQuery.status).toBe(422);
    expect(unsupportedMovieQuery.body.error).toBe("VALIDATION_ERROR");

    const cinemas = await request(app).get("/api/cinemas");
    expect(cinemas.status).toBe(200);
    for (const [id, name] of [[cinemaAId, `Inactive gate A ${fixture}`], [cinemaBId, `Inactive gate B ${fixture}`]]) {
      const cinema = cinemas.body.find((item: { id: string }) => item.id === id);
      expect(cinema).toBeDefined();
      expect(Object.keys(cinema).sort()).toEqual(["_count", "address", "city", "createdAt", "id", "name", "status"]);
      expect(cinema).toMatchObject({ id, name, city: "Test", status: "ACTIVE", _count: { auditoriums: 1 } });
      expect(typeof cinema.createdAt).toBe("string");
      expect(Object.keys(cinema._count)).toEqual(["auditoriums"]);
    }
    const unsupportedCinemaQuery = await request(app).get("/api/cinemas?city=Test");
    expect(unsupportedCinemaQuery.status).toBe(422);
    expect(unsupportedCinemaQuery.body.error).toBe("VALIDATION_ERROR");

    const invalidCalendarDate = await request(app).get("/api/showtimes?date=2026-02-30");
    expect(invalidCalendarDate.status).toBe(422);
    expect(invalidCalendarDate.body.error).toBe("VALIDATION_ERROR");

    const repeatedDateFilter = await request(app).get(`/api/showtimes?date=${formatBusinessDate(showtimeStart)}&date=${formatBusinessDate(showtimeStart)}`);
    expect(repeatedDateFilter.status).toBe(422);
    expect(repeatedDateFilter.body.error).toBe("VALIDATION_ERROR");
    const repeatedMovieFilter = await request(app).get(`/api/showtimes?date=${formatBusinessDate(showtimeStart)}&movieId=first&movieId=second`);
    expect(repeatedMovieFilter.status).toBe(422);
    expect(repeatedMovieFilter.body.error).toBe("VALIDATION_ERROR");

    const repeatedCinemaFilter = await request(app).get(`/api/showtimes?date=${formatBusinessDate(showtimeStart)}&cinemaId=first&cinemaId=second`);
    expect(repeatedCinemaFilter.status).toBe(422);
    expect(repeatedCinemaFilter.body.error).toBe("VALIDATION_ERROR");
    const unsupportedShowtimeQuery = await request(app).get(`/api/showtimes?date=${formatBusinessDate(showtimeStart)}&unexpected=value`);
    expect(unsupportedShowtimeQuery.status).toBe(422);
    expect(unsupportedShowtimeQuery.body.error).toBe("VALIDATION_ERROR");
  }, 30_000);

  it("hides a deactivated cinema's showtime and rejects direct seat, hold, create, and patch attempts without side effects", async () => {
    const date = formatBusinessDate(showtimeStart);
    const publicCatalogBefore = await request(app).get(`/api/showtimes?date=${date}`);
    expect(publicCatalogBefore.status).toBe(200);
    expect(publicCatalogBefore.body.map((showtime: { id: string }) => showtime.id)).toContain(showtimeAId);

    await prisma.cinema.update({ where: { id: cinemaAId }, data: { status: RecordStatus.INACTIVE } });
    const activeCinemasAfterDeactivation = await request(app).get("/api/cinemas");
    expect(activeCinemasAfterDeactivation.status).toBe(200);
    expect(activeCinemasAfterDeactivation.body.map((cinema: { id: string }) => cinema.id)).not.toContain(cinemaAId);
    expect(activeCinemasAfterDeactivation.body.map((cinema: { id: string }) => cinema.id)).toContain(cinemaBId);

    const showtimesAfterCinemaDeactivation = await request(app).get(`/api/showtimes?date=${date}`);
    expect(showtimesAfterCinemaDeactivation.status).toBe(200);
    expect(showtimesAfterCinemaDeactivation.body.map((showtime: { id: string }) => showtime.id)).not.toContain(showtimeAId);
    expect(showtimesAfterCinemaDeactivation.body.map((showtime: { id: string }) => showtime.id)).toContain(showtimeBId);

    await prisma.movie.update({ where: { id: movieBId }, data: { status: RecordStatus.INACTIVE } });

    const inactiveMovieSearch = await request(app).get("/api/movies").query({ q: `Inactive gate B ${fixture}` });
    expect(inactiveMovieSearch.status).toBe(200);
    expect(inactiveMovieSearch.body.map((movie: { id: string }) => movie.id)).not.toContain(movieBId);
    const activeMovieSearch = await request(app).get("/api/movies").query({ q: `Inactive gate A ${fixture}` });
    expect(activeMovieSearch.status).toBe(200);
    expect(activeMovieSearch.body.map((movie: { id: string }) => movie.id)).toEqual([movieAId]);

    const publicCatalogAfter = await request(app).get(`/api/showtimes?date=${date}`);
    expect(publicCatalogAfter.status).toBe(200);
    expect(publicCatalogAfter.body.map((showtime: { id: string }) => showtime.id)).not.toContain(showtimeAId);
    expect(publicCatalogAfter.body.map((showtime: { id: string }) => showtime.id)).not.toContain(showtimeBId);

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

  it("[TC-CAT-06] rejects auditorium creation under an inactive cinema without auditorium, seat, or audit changes", async () => {
    expect((await prisma.cinema.findUniqueOrThrow({ where: { id: cinemaAId } })).status).toBe(RecordStatus.INACTIVE);
    const snapshot = async () => ({
      auditoriums: await prisma.auditorium.count({ where: { cinemaId: cinemaAId } }),
      seats: await prisma.seat.count({ where: { auditorium: { cinemaId: cinemaAId } } }),
      createAudits: await prisma.auditLog.count({ where: { actorId: adminId, action: "AUDITORIUM_CREATED" } })
    });
    const before = await snapshot();

    const response = await request(app).post("/api/admin/auditoriums")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({
        cinemaId: cinemaAId,
        name: rejectedAuditoriumName,
        seats: [{ label: "Z1", row: "Z", column: 1, type: SeatType.STANDARD }]
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("CINEMA_NOT_FOUND");
    expect(await snapshot()).toEqual(before);
    expect(await prisma.auditorium.findFirst({ where: { cinemaId: cinemaAId, name: rejectedAuditoriumName } })).toBeNull();
  }, 30_000);
});
