import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, OrderStatus, PrismaClient, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { applyMockPaymentEvent } from "../src/app.js";

const databaseUrl = process.env.DATABASE_URL_TEST;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("REQ-BOOK-02: PostgreSQL seat claim uniqueness", () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const tag = randomUUID();
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let seatId: string | undefined;
  let paymentSeatId: string | undefined;
  let userId: string | undefined;
  let holdId: string | undefined;
  let orderId: string | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    const cinema = await prisma.cinema.create({ data: { name: `Test cinema ${tag}`, city: "Test", address: "Test", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Test room ${tag}` } });
    auditoriumId = auditorium.id;
    const movie = await prisma.movie.create({ data: { slug: `test-${tag}`, title: `Test movie ${tag}`, genre: "Test", synopsis: "Dedicated integration test fixture.", runtimeMinutes: 90, ageRating: "P" } });
    movieId = movie.id;
    const seat = await prisma.seat.create({ data: { auditoriumId: auditorium.id, label: "A1", row: "A", column: 1, type: SeatType.STANDARD } });
    seatId = seat.id;
    const paymentSeat = await prisma.seat.create({ data: { auditoriumId: auditorium.id, label: "A2", row: "A", column: 2, type: SeatType.STANDARD } });
    paymentSeatId = paymentSeat.id;
    const user = await prisma.user.create({ data: { name: "Integration Customer", email: `customer-${tag}@test.local`, passwordHash: "not-used-in-test", role: Role.CUSTOMER } });
    userId = user.id;
    const showtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000), priceVnd: 90_000 } });
    showtimeId = showtime.id;
  });

  afterAll(async () => {
    if (orderId) {
      await prisma.ticket.deleteMany({ where: { orderId } });
      await prisma.paymentEvent.deleteMany({ where: { orderId } });
      await prisma.payment.deleteMany({ where: { orderId } });
      await prisma.seatClaim.deleteMany({ where: { orderId } });
      await prisma.cinemaOrder.deleteMany({ where: { id: orderId } });
    }
    if (holdId) await prisma.seatHold.deleteMany({ where: { id: holdId } });
    if (showtimeId) await prisma.seatClaim.deleteMany({ where: { showtimeId } });
    if (showtimeId) await prisma.showtime.deleteMany({ where: { id: showtimeId } });
    if (seatId) await prisma.seat.deleteMany({ where: { id: seatId } });
    if (paymentSeatId) await prisma.seat.deleteMany({ where: { id: paymentSeatId } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("[TC-DB-01] allows one claim and rejects a second claim for the same showtime and seat", async () => {
    await prisma.seatClaim.create({ data: { showtimeId: showtimeId!, seatId: seatId!, status: ClaimStatus.HELD, priceVnd: 90_000, expiresAt: new Date(Date.now() + 300_000) } });
    await expect(prisma.seatClaim.create({ data: { showtimeId: showtimeId!, seatId: seatId!, status: ClaimStatus.HELD, priceVnd: 90_000, expiresAt: new Date(Date.now() + 300_000) } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("[TC-DB-02] processes concurrent duplicate payment callbacks exactly once", async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const hold = await prisma.seatHold.create({ data: { userId: userId!, showtimeId: showtimeId!, status: HoldStatus.PAYMENT_PENDING, expiresAt } });
    holdId = hold.id;
    const order = await prisma.cinemaOrder.create({ data: { userId: userId!, showtimeId: showtimeId!, holdId: hold.id, totalVnd: 90_000, status: OrderStatus.PAYMENT_PENDING } });
    orderId = order.id;
    await prisma.seatClaim.create({ data: { showtimeId: showtimeId!, seatId: paymentSeatId!, holdId: hold.id, orderId: order.id, status: ClaimStatus.HELD, expiresAt, priceVnd: 90_000 } });
    const event = { eventId: `evt-${tag}`, orderId: order.id, status: "SUCCEEDED" as const, amountVnd: 90_000, currency: "VND" as const };

    const results = await Promise.all([
      applyMockPaymentEvent(event, undefined, prisma),
      applyMockPaymentEvent(event, undefined, prisma)
    ]);
    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true]);
    expect(await prisma.paymentEvent.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(1);
    await expect(applyMockPaymentEvent({ ...event, amountVnd: 91_000 }, undefined, prisma)).rejects.toMatchObject({ code: "PAYMENT_EVENT_REPLAY" });
  });
});
