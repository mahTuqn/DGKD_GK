import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, OrderStatus, PaymentStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const databaseDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

databaseDescribe("ticket check-in mixed-route race", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let seatId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let holdId: string | undefined;
  let orderId: string | undefined;
  let ticketId: string | undefined;
  let staffToken: string;
  let ticket: { id: string; qrToken: string };

  beforeAll(async () => {
    await prisma.$connect();

    const cinema = await prisma.cinema.create({
      data: { name: `Mixed check-in ${fixture}`, city: "Test", address: "Isolated mixed-route race fixture", status: RecordStatus.ACTIVE }
    });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId, name: `Mixed check-in room ${fixture}` } });
    auditoriumId = auditorium.id;
    const seat = await prisma.seat.create({
      data: { auditoriumId, label: "A1", row: "A", column: 1, type: SeatType.STANDARD }
    });
    seatId = seat.id;
    const movie = await prisma.movie.create({
      data: {
        slug: `mixed-checkin-${fixture}`,
        title: `Mixed check-in ${fixture}`,
        genre: "Test",
        synopsis: "Fixture for mixed ID and QR ticket check-in concurrency.",
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

    const users = await prisma.user.createManyAndReturn({
      data: [
        { name: "Mixed check-in buyer", email: `mixed-buyer-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER },
        { name: "Mixed check-in staff", email: `mixed-staff-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.STAFF, assignedCinemaId: cinema.id }
      ]
    });
    const buyer = users[0]!;
    const staff = users[1]!;
    userIds.push(buyer.id, staff.id);
    staffToken = createToken({ id: staff.id, authVersion: staff.authVersion });

    const hold = await prisma.seatHold.create({
      data: { userId: buyer.id, showtimeId, status: HoldStatus.CONFIRMED, expiresAt: new Date(Date.now() + 60 * 60_000) }
    });
    holdId = hold.id;
    const order = await prisma.cinemaOrder.create({
      data: { userId: buyer.id, showtimeId, holdId: hold.id, totalVnd: 100_000, status: OrderStatus.CONFIRMED }
    });
    orderId = order.id;
    const claim = await prisma.seatClaim.create({
      data: { showtimeId, seatId, holdId: hold.id, orderId: order.id, status: ClaimStatus.SOLD, priceVnd: 100_000 }
    });
    await prisma.payment.create({ data: { orderId: order.id, amountVnd: 100_000, status: PaymentStatus.SUCCEEDED } });
    const createdTicket = await prisma.ticket.create({
      data: { orderId: order.id, seatClaimId: claim.id, qrToken: randomBytes(32).toString("base64url") }
    });
    ticketId = createdTicket.id;
    ticket = { id: createdTicket.id, qrToken: createdTicket.qrToken };
  }, 30_000);

  afterAll(async () => {
    if (ticketId) await prisma.auditLog.deleteMany({ where: { entity: "Ticket", entityId: ticketId } });
    if (orderId) {
      await prisma.ticket.deleteMany({ where: { orderId } });
      await prisma.paymentEvent.deleteMany({ where: { orderId } });
      await prisma.reconciliationCase.deleteMany({ where: { orderId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: orderId } });
      await prisma.payment.deleteMany({ where: { orderId } });
      await prisma.seatClaim.deleteMany({ where: { orderId } });
      await prisma.cinemaOrder.deleteMany({ where: { id: orderId } });
    }
    if (showtimeId) {
      await prisma.seatClaim.deleteMany({ where: { showtimeId } });
      await prisma.seatHold.deleteMany({ where: { showtimeId } });
      await prisma.showtime.deleteMany({ where: { id: showtimeId } });
    }
    if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    if (seatId) await prisma.seat.deleteMany({ where: { id: seatId } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-SEC-52] atomically handles simultaneous ID and QR check-in requests for one ticket", async () => {
    const authorization = { Authorization: `Bearer ${staffToken}` };
    const before = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { id: true, checkedInAt: true, orderId: true, seatClaimId: true, qrToken: true }
    });
    expect(before.checkedInAt).toBeNull();
    const auditCountBefore = await prisma.auditLog.count({
      where: { action: "TICKET_CHECKED_IN", entity: "Ticket", entityId: ticket.id }
    });

    const [idResponse, qrResponse] = await Promise.all([
      request(app).post(`/api/tickets/${ticket.id}/check-in`).set(authorization).send({}),
      request(app).post("/api/tickets/scan").set(authorization).send({ qrToken: ticket.qrToken })
    ]);

    expect([idResponse.status, qrResponse.status].sort()).toEqual([200, 409]);
    const winner = idResponse.status === 200 ? idResponse : qrResponse;
    const loser = idResponse.status === 409 ? idResponse : qrResponse;
    expect(winner.body).toMatchObject({ ticketId: ticket.id, seat: "A1" });
    expect(typeof winner.body.checkedInAt).toBe("string");
    expect(loser.body.error).toBe("TICKET_ALREADY_USED");

    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { id: true, checkedInAt: true, orderId: true, seatClaimId: true, qrToken: true }
    });
    expect(after).toEqual({ ...before, checkedInAt: new Date(String(winner.body.checkedInAt)) });
    expect(await prisma.auditLog.count({
      where: { action: "TICKET_CHECKED_IN", entity: "Ticket", entityId: ticket.id }
    })).toBe(auditCountBefore + 1);
  }, 30_000);
});
