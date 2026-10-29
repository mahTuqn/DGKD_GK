import { HoldStatus, OrderStatus, RecordStatus, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const paginationDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

paginationDescribe("collection pagination", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  const customerOrderIds: string[] = [];
  const customerHoldIds: string[] = [];
  const fixtureEmails: string[] = [];
  let customerId: string;
  let adminToken: string;
  let customerToken: string;
  let cinemaId: string;
  let auditoriumId: string;
  let movieId: string;
  let showtimeId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({ data: { name: `Pagination ${fixture}`, city: "Test", address: "Pagination fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId, name: `Pagination room ${fixture}` } });
    auditoriumId = auditorium.id;
    const movie = await prisma.movie.create({
      data: { slug: `pagination-${fixture}`, title: `Pagination ${fixture}`, genre: "Test", synopsis: "Fixture for cursor pagination integration coverage.", runtimeMinutes: 90, ageRating: "P", status: RecordStatus.ACTIVE }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtime = await prisma.showtime.create({ data: { movieId, auditoriumId, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE } });
    showtimeId = showtime.id;

    const createdAt = new Date(Date.now() - 60_000);
    const customer = await prisma.user.create({ data: { name: "Pagination owner", email: `pagination-owner-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER, createdAt } });
    customerId = customer.id;
    userIds.push(customer.id);
    customerToken = createToken({ id: customer.id, authVersion: customer.authVersion });
    const admin = await prisma.user.create({ data: { name: "Pagination admin", email: `pagination-admin-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN, createdAt } });
    userIds.push(admin.id);
    adminToken = createToken({ id: admin.id, authVersion: admin.authVersion });

    for (let index = 0; index < 23; index += 1) {
      const email = `pagination-user-${fixture}-${index}@test.local`;
      fixtureEmails.push(email);
      const user = await prisma.user.create({ data: { name: `Pagination user ${index}`, email, passwordHash: "unused-test-only", role: Role.CUSTOMER, createdAt } });
      userIds.push(user.id);
    }

    for (let index = 0; index < 24; index += 1) {
      const hold = await prisma.seatHold.create({ data: { userId: customerId, showtimeId, status: HoldStatus.EXPIRED, expiresAt: createdAt, createdAt } });
      customerHoldIds.push(hold.id);
      const order = await prisma.cinemaOrder.create({ data: { userId: customerId, showtimeId, holdId: hold.id, status: OrderStatus.EXPIRED, totalVnd: 100_000, createdAt } });
      customerOrderIds.push(order.id);
    }
  }, 30_000);

  afterAll(async () => {
    if (customerOrderIds.length) await prisma.cinemaOrder.deleteMany({ where: { id: { in: customerOrderIds } } });
    if (customerHoldIds.length) await prisma.seatHold.deleteMany({ where: { id: { in: customerHoldIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (showtimeId) await prisma.showtime.deleteMany({ where: { id: showtimeId } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-SEC-35] bounds order history pages and returns every owned order once in stable cursor order", async () => {
    const expected = await prisma.cinemaOrder.findMany({ where: { userId: customerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    const first = await request(app).get("/api/orders/me").set({ Authorization: `Bearer ${customerToken}` });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(20);
    expect(typeof first.body.nextCursor).toBe("string");

    const second = await request(app).get("/api/orders/me").query({ cursor: first.body.nextCursor }).set({ Authorization: `Bearer ${customerToken}` });
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(4);
    expect(second.body.nextCursor).toBeNull();
    expect([...first.body.items, ...second.body.items].map((order: { id: string }) => order.id)).toEqual(expected.map((order) => order.id));
    expect((await request(app).get("/api/orders/me?limit=51").set({ Authorization: `Bearer ${customerToken}` })).status).toBe(422);
    expect((await request(app).get("/api/orders/me?cursor=invalid").set({ Authorization: `Bearer ${customerToken}` })).body.error).toBe("INVALID_CURSOR");
  }, 30_000);

  it("[TC-SEC-36] bounds Admin user pages, preserves the safe field allowlist, and reaches every user", async () => {
    const ids = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const response = await request(app).get("/api/admin/users").query({ ...(cursor ? { cursor } : {}) }).set({ Authorization: `Bearer ${adminToken}` });
      expect(response.status).toBe(200);
      expect(response.body.items.length).toBeLessThanOrEqual(20);
      expect(response.body.items.length).toBeGreaterThan(0);
      for (const user of response.body.items as Array<Record<string, unknown>>) {
        expect(Object.keys(user).sort()).toEqual(["assignedCinema", "assignedCinemaId", "createdAt", "email", "id", "name", "role"].sort());
        expect(ids.has(String(user.id))).toBe(false);
        ids.add(String(user.id));
      }
      cursor = response.body.nextCursor ?? undefined;
      pageCount += 1;
      expect(pageCount).toBeLessThan(100);
    } while (cursor);

    expect(pageCount).toBeGreaterThan(1);
    const fixtureUserEmails = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
    expect(fixtureEmails.every((email) => fixtureUserEmails.some((user) => user.email === email))).toBe(true);
    const fixtureUsers = await prisma.user.findMany({ where: { email: { in: fixtureEmails } }, select: { id: true } });
    expect(fixtureUsers.every((user) => ids.has(user.id))).toBe(true);
    expect((await request(app).get("/api/admin/users?limit=51").set({ Authorization: `Bearer ${adminToken}` })).status).toBe(422);
  }, 30_000);
});
