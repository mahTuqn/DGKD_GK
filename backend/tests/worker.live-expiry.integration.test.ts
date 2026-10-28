import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { HoldStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { HOLD_TTL_SECONDS } from "../src/domain/booking-policy.js";
import { startWorker, type StartWorkerOptions } from "../src/worker.js";

const databaseUrl = process.env.DATABASE_URL_WORKER_PROCESS_TEST;
const liveDescribe = databaseUrl ? describe.sequential : describe.skip;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type RegisteredCustomer = { id: string; token: string };

liveDescribe("plan phase 5: live five-minute hold expiry over HTTP", () => {
  const fixture = randomUUID();
  const userIds: string[] = [];
  const holdIds: string[] = [];
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let seatId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let server: Server | undefined;
  let apiUrl: string | undefined;
  let worker: ReturnType<typeof startWorker> | undefined;
  const workerErrors: unknown[] = [];

  const registerCustomer = async (label: string): Promise<RegisteredCustomer> => {
    const response = await fetch(`${apiUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Live expiry ${label}`, email: `live-expiry-${label}-${fixture}@test.local`, password: "LiveExpiryQa123!" })
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { user: { id: string }; token: string };
    userIds.push(body.user.id);
    return { id: body.user.id, token: body.token };
  };

  const requestHold = async (customer: RegisteredCustomer) => fetch(`${apiUrl}/api/holds`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${customer.token}` },
    body: JSON.stringify({ showtimeId, seatIds: [seatId] })
  });

  const readSeatStatus = async () => {
    const response = await fetch(`${apiUrl}/api/showtimes/${showtimeId}/seats`);
    expect(response.status).toBe(200);
    const body = await response.json() as { seats: Array<{ id: string; status: string }> };
    return body.seats.find((seat) => seat.id === seatId)?.status;
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_TEST || process.env.DATABASE_URL_TEST !== databaseUrl) {
      throw new Error("For isolation, DATABASE_URL_TEST and DATABASE_URL_WORKER_PROCESS_TEST must target the same dedicated live-expiry database.");
    }
    if (HOLD_TTL_SECONDS !== 300) throw new Error(`The live expiry rehearsal requires HOLD_TTL_SECONDS=300; received ${HOLD_TTL_SECONDS}.`);
    await prisma.$connect();

    const cinema = await prisma.cinema.create({ data: { name: `Live Expiry ${fixture}`, city: "Test", address: "Isolated HTTP expiry fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Live Expiry Room ${fixture}` } });
    auditoriumId = auditorium.id;
    const seat = await prisma.seat.create({ data: { auditoriumId: auditorium.id, label: "L1", row: "L", column: 1, type: SeatType.STANDARD } });
    seatId = seat.id;
    const movie = await prisma.movie.create({
      data: { slug: `live-expiry-${fixture}`, title: `Live Expiry ${fixture}`, genre: "Test", synopsis: "Dedicated five-minute HTTP expiry fixture.", runtimeMinutes: 90, ageRating: "P", status: RecordStatus.ACTIVE }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 2 * 60 * 60_000);
    const showtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE } });
    showtimeId = showtime.id;

    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not resolve the live-expiry API listener address.");
    apiUrl = `http://127.0.0.1:${address.port}`;
    worker = startWorker({ database: prisma, intervalMs: 250, batchSize: 100, onError: (error) => workerErrors.push(error) } satisfies StartWorkerOptions);
  }, 30_000);

  afterAll(async () => {
    await worker?.stop();
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (holdIds.length) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: holdIds } } });
      await prisma.seatClaim.deleteMany({ where: { holdId: { in: holdIds } } });
      await prisma.seatHold.deleteMany({ where: { id: { in: holdIds } } });
    }
    if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    if (showtimeId) await prisma.seatClaim.deleteMany({ where: { showtimeId } });
    if (showtimeId) await prisma.showtime.deleteMany({ where: { id: showtimeId } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (seatId) await prisma.seat.deleteMany({ where: { id: seatId } });
    if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-WORKER-03] keeps the seat unavailable before expiry, then releases it over HTTP after the worker sweep", async () => {
    const firstCustomer = await registerCustomer("first");
    const secondCustomer = await registerCustomer("second");
    const firstHoldResponse = await requestHold(firstCustomer);
    expect(firstHoldResponse.status).toBe(201);
    const firstHold = await firstHoldResponse.json() as { id: string; expiresAt: string };
    holdIds.push(firstHold.id);

    const firstHoldRow = await prisma.seatHold.findUniqueOrThrow({ where: { id: firstHold.id } });
    const actualTtlMs = new Date(firstHold.expiresAt).getTime() - firstHoldRow.createdAt.getTime();
    expect(actualTtlMs).toBeGreaterThanOrEqual(299_000);
    expect(actualTtlMs).toBeLessThanOrEqual(301_000);
    expect(await readSeatStatus()).toBe("HELD");

    const beforeDeadlineAt = new Date(firstHold.expiresAt).getTime() - 5_000;
    await wait(Math.max(0, beforeDeadlineAt - Date.now()));
    expect(Date.now()).toBeLessThan(new Date(firstHold.expiresAt).getTime());
    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: firstHold.id } })).status).toBe(HoldStatus.HELD);
    expect(await readSeatStatus()).toBe("HELD");
    const beforeExpiryConflict = await requestHold(secondCustomer);
    expect(beforeExpiryConflict.status).toBe(409);

    const expiryDeadline = Date.now() + 15_000;
    let firstHoldStatus = (await prisma.seatHold.findUniqueOrThrow({ where: { id: firstHold.id } })).status;
    while (firstHoldStatus !== HoldStatus.EXPIRED && Date.now() < expiryDeadline) {
      await wait(100);
      firstHoldStatus = (await prisma.seatHold.findUniqueOrThrow({ where: { id: firstHold.id } })).status;
    }
    expect(firstHoldStatus).toBe(HoldStatus.EXPIRED);
    expect(workerErrors).toEqual([]);
    const releasedClaim = await prisma.seatClaim.findUniqueOrThrow({ where: { showtimeId_seatId: { showtimeId: showtimeId!, seatId: seatId! } } });
    expect(releasedClaim.status).toBe("EXPIRED");
    expect(releasedClaim.holdId).toBeNull();
    expect(releasedClaim.orderId).toBeNull();
    expect(releasedClaim.expiresAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "SEAT_HOLD_EXPIRED", entity: "SeatHold", entityId: firstHold.id } })).toBe(1);
    expect(await readSeatStatus()).toBe("AVAILABLE");

    const afterExpiryHoldResponse = await requestHold(secondCustomer);
    expect(afterExpiryHoldResponse.status).toBe(201);
    const afterExpiryHold = await afterExpiryHoldResponse.json() as { id: string };
    holdIds.push(afterExpiryHold.id);
    expect(await prisma.seatHold.count({ where: { id: afterExpiryHold.id, userId: secondCustomer.id, status: HoldStatus.HELD } })).toBe(1);
  }, 390_000);
});
