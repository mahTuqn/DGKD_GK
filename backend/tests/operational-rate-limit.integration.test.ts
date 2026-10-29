import { randomUUID } from "node:crypto";
import { RecordStatus, Role, SeatType } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

async function withActionLimit<T>(limit: number, callback: () => Promise<T>) {
  const keys = ["NODE_ENV", "JWT_SECRET", "E2E_MUTATION_RATE_LIMIT"] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "mutation-rate-limit-test-secret-32chars";
  process.env.E2E_MUTATION_RATE_LIMIT = String(limit);
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("TC-SEC-37: rate limits for sensitive mutation routes", () => {
  it("returns a stable 429 for repeated hold, order, payment, webhook and check-in requests", async () => {
    await withActionLimit(2, async () => {
      const app = createApp();
      const routes = [
        { path: "/api/holds", body: {}, firstStatus: 401 },
        { path: "/api/orders", body: {}, firstStatus: 401 },
        { path: "/api/payments/mock/complete", body: {}, firstStatus: 401 },
        { path: "/api/payments/mock/webhook", body: {}, firstStatus: 422 },
        { path: "/api/tickets/test-ticket/check-in", body: {}, firstStatus: 401 },
        { path: "/api/tickets/scan", body: {}, firstStatus: 401 }
      ];

      for (const route of routes) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const allowed = await request(app).post(route.path).send(route.body);
          expect(allowed.status).toBe(route.firstStatus);
        }

        const limited = await request(app).post(route.path).send(route.body);
        expect(limited.status).toBe(429);
        expect(limited.body.error).toBe("ACTION_RATE_LIMITED");
        expect(limited.headers["ratelimit-policy"]).toBeDefined();
      }
    });
  });

  const databaseDescribe = process.env.DATABASE_URL_TEST ? describe : describe.skip;
  databaseDescribe("authenticated database side effects", () => {
    const fixture = randomUUID();
    const userIds: string[] = [];
    const seatIds: string[] = [];
    let cinemaId: string | undefined;
    let auditoriumId: string | undefined;
    let movieId: string | undefined;
    let showtimeId: string | undefined;

    afterAll(async () => {
      if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      if (showtimeId) {
        await prisma.seatClaim.deleteMany({ where: { showtimeId } });
        await prisma.seatHold.deleteMany({ where: { showtimeId } });
        await prisma.showtime.deleteMany({ where: { id: showtimeId } });
      }
      if (seatIds.length) await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
      if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
      if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
      await prisma.$disconnect();
    });

    it("blocks over-limit Customer hold requests before creating another hold or audit", async () => {
      await withActionLimit(2, async () => {
        await prisma.$connect();
        const cinema = await prisma.cinema.create({ data: { name: `Rate limit ${fixture}`, city: "Test", address: "Rate limit fixture", status: RecordStatus.ACTIVE } });
        cinemaId = cinema.id;
        const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Rate limit room ${fixture}` } });
        auditoriumId = auditorium.id;
        const seats = await prisma.seat.createManyAndReturn({
          data: [1, 2].map((column) => ({ auditoriumId: auditorium.id, label: `R${column}`, row: "R", column, type: SeatType.STANDARD }))
        });
        seatIds.push(...seats.map((seat) => seat.id));
        const movie = await prisma.movie.create({ data: { slug: `rate-limit-${fixture}`, title: "Rate limit fixture", genre: "Test", synopsis: "Temporary rate limit integration fixture.", runtimeMinutes: 90, ageRating: "P" } });
        movieId = movie.id;
        const startAt = new Date(Date.now() + 365 * 86_400_000);
        const showtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE } });
        const createdShowtimeId = showtime.id;
        showtimeId = createdShowtimeId;
        const users = await Promise.all([1, 2].map((index) => prisma.user.create({
          data: { name: `Rate Limit Customer ${index}`, email: `rate-limit-${index}-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER }
        })));
        userIds.push(...users.map((user) => user.id));
        const app = createApp();
        const before = {
          holds: await prisma.seatHold.count({ where: { showtimeId: createdShowtimeId } }),
          audits: await prisma.auditLog.count({ where: { actorId: { in: userIds }, action: "SEATS_HELD" } })
        };

        for (let index = 0; index < users.length; index += 1) {
          const allowed = await request(app)
            .post("/api/holds")
            .set({ Authorization: `Bearer ${createToken(users[index]!)}` })
            .send({ showtimeId: createdShowtimeId, seatIds: [seatIds[index]!] });
          expect(allowed.status).toBe(201);
        }

        const limited = await request(app)
          .post("/api/holds")
          .set({ Authorization: `Bearer ${createToken(users[0]!)}` })
          .send({ showtimeId: createdShowtimeId, seatIds: [seatIds[0]!] });
        expect(limited.status).toBe(429);
        expect(limited.body.error).toBe("ACTION_RATE_LIMITED");
        expect(await prisma.seatHold.count({ where: { showtimeId: createdShowtimeId } })).toBe(before.holds + 2);
        expect(await prisma.auditLog.count({ where: { actorId: { in: userIds }, action: "SEATS_HELD" } })).toBe(before.audits + 2);
      });
    });
  });
});
