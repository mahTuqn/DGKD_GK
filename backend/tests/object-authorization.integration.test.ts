import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, OrderStatus, PaymentStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const authorizationDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

authorizationDescribe("REQ-BOOK ownership: order and nested ticket object isolation", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  const seatIds: string[] = [];
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let orderAId: string | undefined;
  let orderBId: string | undefined;
  let userAId: string | undefined;
  let userBId: string | undefined;
  let tokenA: string;
  let tokenB: string;
  let ticketAId: string;
  let ticketBId: string;
  let qrA: string;
  let qrB: string;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({ data: { name: `Authorization ${fixture}`, city: "Test", address: "Object authorization fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Authorization room ${fixture}` } });
    auditoriumId = auditorium.id;
    const seats = await prisma.seat.createManyAndReturn({
      data: [1, 2].map((column) => ({ auditoriumId: auditorium.id, label: `A${column}`, row: "A", column, type: SeatType.STANDARD }))
    });
    seatIds.push(...seats.map((seat) => seat.id));
    const movie = await prisma.movie.create({
      data: { slug: `authorization-${fixture}`, title: `Authorization ${fixture}`, genre: "Test", synopsis: "Isolated object authorization fixtures.", runtimeMinutes: 90, ageRating: "P" }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtime = await prisma.showtime.create({
      data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000 }
    });
    showtimeId = showtime.id;

    const users = await prisma.user.createManyAndReturn({
      data: [
        { name: "Order Owner A", email: `owner-a-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER },
        { name: "Order Owner B", email: `owner-b-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER }
      ]
    });
    userAId = users[0]!.id;
    userBId = users[1]!.id;
    userIds.push(...users.map((user) => user.id));
    tokenA = createToken({ id: users[0]!.id, authVersion: users[0]!.authVersion });
    tokenB = createToken({ id: users[1]!.id, authVersion: users[1]!.authVersion });

    async function createConfirmedOrder(userId: string, seatId: string) {
      const expiresAt = new Date(Date.now() + 600_000);
      const hold = await prisma.seatHold.create({ data: { userId, showtimeId: showtime.id, status: HoldStatus.CONFIRMED, expiresAt } });
      const order = await prisma.cinemaOrder.create({ data: { userId, showtimeId: showtime.id, holdId: hold.id, totalVnd: 100_000, status: OrderStatus.CONFIRMED } });
      const claim = await prisma.seatClaim.create({ data: { showtimeId: showtime.id, seatId, holdId: hold.id, orderId: order.id, status: ClaimStatus.SOLD, priceVnd: 100_000 } });
      await prisma.payment.create({ data: { orderId: order.id, amountVnd: 100_000, status: PaymentStatus.SUCCEEDED } });
      const qrToken = randomBytes(32).toString("base64url");
      const ticket = await prisma.ticket.create({ data: { orderId: order.id, seatClaimId: claim.id, qrToken } });
      return { orderId: order.id, ticketId: ticket.id, qrToken };
    }

    const orderA = await createConfirmedOrder(userAId, seats[0]!.id);
    orderAId = orderA.orderId;
    ticketAId = orderA.ticketId;
    qrA = orderA.qrToken;
    const orderB = await createConfirmedOrder(userBId, seats[1]!.id);
    orderBId = orderB.orderId;
    ticketBId = orderB.ticketId;
    qrB = orderB.qrToken;
  }, 30_000);

  afterAll(async () => {
    const orderIds = [orderAId, orderBId].filter((id): id is string => Boolean(id));
    if (orderIds.length) {
      await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
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

  it("[TC-SEC-03] isolates order lists and nested ticket data by customer ownership", async () => {
    const guestOrders = await request(app).get("/api/orders/me");
    expect(guestOrders.status).toBe(401);
    const guestOrder = await request(app).get(`/api/orders/${orderAId}`);
    expect(guestOrder.status).toBe(401);

    const ownerAList = await request(app).get("/api/orders/me").set({ Authorization: `Bearer ${tokenA}` });
    expect(ownerAList.status).toBe(200);
    expect(ownerAList.body.map((order: { id: string }) => order.id)).toEqual([orderAId]);
    expect(ownerAList.body[0].tickets.map((ticket: { id: string }) => ticket.id)).toEqual([ticketAId]);
    expect(JSON.stringify(ownerAList.body)).toContain(qrA);
    expect(JSON.stringify(ownerAList.body)).not.toContain(orderBId);
    expect(JSON.stringify(ownerAList.body)).not.toContain(ticketBId);
    expect(JSON.stringify(ownerAList.body)).not.toContain(qrB);

    const ownerBList = await request(app).get("/api/orders/me").set({ Authorization: `Bearer ${tokenB}` });
    expect(ownerBList.status).toBe(200);
    expect(ownerBList.body.map((order: { id: string }) => order.id)).toEqual([orderBId]);
    expect(ownerBList.body[0].tickets.map((ticket: { id: string }) => ticket.id)).toEqual([ticketBId]);
    expect(JSON.stringify(ownerBList.body)).toContain(qrB);
    expect(JSON.stringify(ownerBList.body)).not.toContain(orderAId);
    expect(JSON.stringify(ownerBList.body)).not.toContain(ticketAId);
    expect(JSON.stringify(ownerBList.body)).not.toContain(qrA);

    const ownerAOrder = await request(app).get(`/api/orders/${orderAId}`).set({ Authorization: `Bearer ${tokenA}` });
    expect(ownerAOrder.status).toBe(200);
    expect(ownerAOrder.body.tickets.map((ticket: { id: string }) => ticket.id)).toEqual([ticketAId]);
    expect(ownerAOrder.body.tickets[0].qrToken).toBe(qrA);

    const crossCustomerOrder = await request(app).get(`/api/orders/${orderAId}`).set({ Authorization: `Bearer ${tokenB}` });
    expect(crossCustomerOrder.status).toBe(404);
    expect(crossCustomerOrder.body.error).toBe("ORDER_NOT_FOUND");
    expect(JSON.stringify(crossCustomerOrder.body)).not.toContain(qrA);
    expect(JSON.stringify(crossCustomerOrder.body)).not.toContain(ticketAId);
  }, 30_000);
});
