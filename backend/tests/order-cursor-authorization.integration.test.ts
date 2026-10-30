import { ClaimStatus, HoldStatus, OrderStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const cursorAuthorizationDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

cursorAuthorizationDescribe("customer order cursor ownership", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  const holdIds: string[] = [];
  const orderIds: string[] = [];
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let seatId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let ticketId: string | undefined;
  let foreignTicketQr: string | undefined;
  let ownerAId: string;
  let ownerBId: string;
  let ownerAToken: string;
  let ownerBToken: string;
  let ownerAOrderId: string;
  let ownerBLastOrderId: string;

  beforeAll(async () => {
    await prisma.$connect();

    const cinema = await prisma.cinema.create({
      data: { name: `Cursor authorization ${fixture}`, city: "Test", address: "Foreign cursor BOLA fixture", status: RecordStatus.ACTIVE }
    });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId, name: `Cursor authorization room ${fixture}` } });
    auditoriumId = auditorium.id;
    const seat = await prisma.seat.create({
      data: { auditoriumId, label: "A1", row: "A", column: 1, type: SeatType.STANDARD }
    });
    seatId = seat.id;
    const movie = await prisma.movie.create({
      data: {
        slug: `cursor-authorization-${fixture}`,
        title: `Cursor authorization ${fixture}`,
        genre: "Test",
        synopsis: "Fixture for foreign-customer order cursor authorization.",
        runtimeMinutes: 90,
        ageRating: "P",
        status: RecordStatus.ACTIVE
      }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtime = await prisma.showtime.create({
      data: { movieId, auditoriumId, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE }
    });
    showtimeId = showtime.id;

    const owners = await prisma.user.createManyAndReturn({
      data: [
        { name: "Cursor owner A", email: `cursor-owner-a-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER },
        { name: "Cursor owner B", email: `cursor-owner-b-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER }
      ]
    });
    ownerAId = owners[0]!.id;
    ownerBId = owners[1]!.id;
    userIds.push(...owners.map((owner) => owner.id));
    ownerAToken = createToken({ id: ownerAId, authVersion: owners[0]!.authVersion });
    ownerBToken = createToken({ id: ownerBId, authVersion: owners[1]!.authVersion });

    const base = new Date("2020-01-01T00:00:00.000Z");
    for (let index = 0; index < 21; index += 1) {
      const createdAt = base;
      // Descending IDs place 20..01 on page one and 00 immediately after its cursor.
      const isLast = index === 0;
      const hold = await prisma.seatHold.create({
        data: {
          userId: ownerBId,
          showtimeId,
          status: isLast ? HoldStatus.CONFIRMED : HoldStatus.EXPIRED,
          expiresAt: new Date(createdAt.getTime() + 10 * 60_000),
          createdAt
        }
      });
      holdIds.push(hold.id);
      const order = await prisma.cinemaOrder.create({
        data: {
          id: `cursor-b-${fixture}-${String(index).padStart(2, "0")}`,
          userId: ownerBId,
          showtimeId,
          holdId: hold.id,
          status: isLast ? OrderStatus.CONFIRMED : OrderStatus.EXPIRED,
          totalVnd: 100_000,
          createdAt
        }
      });
      orderIds.push(order.id);
      if (isLast) {
        ownerBLastOrderId = order.id;
        const claim = await prisma.seatClaim.create({
          data: { showtimeId, seatId, holdId: hold.id, orderId: order.id, status: ClaimStatus.SOLD, priceVnd: 100_000 }
        });
        foreignTicketQr = randomBytes(32).toString("base64url");
        const ticket = await prisma.ticket.create({ data: { orderId: order.id, seatClaimId: claim.id, qrToken: foreignTicketQr } });
        ticketId = ticket.id;
      }
    }

    const ownerAHold = await prisma.seatHold.create({
      data: {
        userId: ownerAId,
        showtimeId,
        status: HoldStatus.EXPIRED,
        expiresAt: new Date(base.getTime() - 50 * 60_000),
        createdAt: new Date(base.getTime() - 60 * 60_000)
      }
    });
    holdIds.push(ownerAHold.id);
    const ownerAOrder = await prisma.cinemaOrder.create({
      data: {
        userId: ownerAId,
        showtimeId,
        holdId: ownerAHold.id,
        status: OrderStatus.EXPIRED,
        totalVnd: 100_000,
        createdAt: new Date(base.getTime() - 60 * 60_000)
      }
    });
    ownerAOrderId = ownerAOrder.id;
    orderIds.push(ownerAOrder.id);
  }, 30_000);

  afterAll(async () => {
    const fixtureOrderIds = orderIds;
    if (fixtureOrderIds.length) {
      await prisma.ticket.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
      await prisma.paymentEvent.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
      await prisma.seatClaim.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
      await prisma.cinemaOrder.deleteMany({ where: { id: { in: fixtureOrderIds } } });
    }
    if (showtimeId) {
      await prisma.seatClaim.deleteMany({ where: { showtimeId } });
      if (holdIds.length) await prisma.seatHold.deleteMany({ where: { id: { in: holdIds } } });
      await prisma.showtime.deleteMany({ where: { id: showtimeId } });
    }
    if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    if (seatId) await prisma.seat.deleteMany({ where: { id: seatId } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-SEC-50] does not expose another customer's order or ticket through a foreign cursor", async () => {
    const ownerBFirstPage = await request(app)
      .get("/api/orders/me")
      .set({ Authorization: `Bearer ${ownerBToken}` });
    expect(ownerBFirstPage.status).toBe(200);
    expect(ownerBFirstPage.body.items).toHaveLength(20);
    expect(typeof ownerBFirstPage.body.nextCursor).toBe("string");

    const ownerBSecondPage = await request(app)
      .get("/api/orders/me")
      .query({ cursor: ownerBFirstPage.body.nextCursor })
      .set({ Authorization: `Bearer ${ownerBToken}` });
    expect(ownerBSecondPage.status).toBe(200);
    expect(ownerBSecondPage.body.items.map((order: { id: string }) => order.id)).toEqual([ownerBLastOrderId]);
    expect(JSON.stringify(ownerBSecondPage.body)).toContain(ticketId);
    expect(JSON.stringify(ownerBSecondPage.body)).toContain(foreignTicketQr);

    const ownerAWithForeignCursor = await request(app)
      .get("/api/orders/me")
      .query({ cursor: ownerBFirstPage.body.nextCursor })
      .set({ Authorization: `Bearer ${ownerAToken}` });
    expect(ownerAWithForeignCursor.status).toBe(200);
    expect(ownerAWithForeignCursor.body.items.map((order: { id: string }) => order.id)).toEqual([ownerAOrderId]);
    expect(JSON.stringify(ownerAWithForeignCursor.body)).not.toContain(ownerBLastOrderId);
    expect(JSON.stringify(ownerAWithForeignCursor.body)).not.toContain(ticketId);
    expect(JSON.stringify(ownerAWithForeignCursor.body)).not.toContain(foreignTicketQr);
  }, 30_000);
});
