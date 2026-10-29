import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, OrderStatus, PaymentStatus, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const regressionDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

type GuardedRoute = { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown };

function sendAs(app: ReturnType<typeof createApp>, token: string | undefined, route: GuardedRoute) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (route.method === "GET") return request(app).get(route.path).set(headers);
  if (route.method === "POST") return request(app).post(route.path).set(headers).send(route.body ?? {});
  return request(app).patch(route.path).set(headers).send(route.body ?? {});
}

regressionDescribe("authorization regression coverage", () => {
  const app = createApp();
  const fixture = randomUUID();
  const userIds: string[] = [];
  const roleOrderIds: string[] = [];
  const roleSeatIds: string[] = [];
  const roleQrTokens = new Map<Role, string>();
  const roleOwnedOrderIds = new Map<Role, string>();
  let cinemaId: string | undefined;
  let foreignCinemaId: string | undefined;
  let inactiveCinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let foreignAuditoriumId: string | undefined;
  let foreignSeatId: string | undefined;
  let seatId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let userAId: string | undefined;
  let userBId: string | undefined;
  let staffId: string | undefined;
  let protectedStaffId: string | undefined;
  let adminId: string | undefined;
  let holdId: string | undefined;
  let orderId: string | undefined;
  let tokenB: string;
  let staffToken: string;
  let protectedStaffToken: string;
  let adminToken: string;
  const attemptedCinemaNames = [`Guest cinema ${fixture}`, `Denied cinema ${fixture}`];
  const attemptedMovieSlugs = [`guest-movie-${fixture}`, `denied-movie-${fixture}`];
  const attemptedRoomNames = [`Guest room ${fixture}`, `Denied room ${fixture}`, `Mass assignment room ${fixture}`];
  const attemptedShowtimeStarts: Date[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const cinema = await prisma.cinema.create({
      data: { name: `Authorization Regression ${fixture}`, city: "Test", address: "Isolated authorization fixture", status: RecordStatus.ACTIVE }
    });
    cinemaId = cinema.id;

    const foreignCinema = await prisma.cinema.create({
      data: { name: `Authorization Foreign Cinema ${fixture}`, city: "Test", address: "Cross-cinema assignment fixture", status: RecordStatus.ACTIVE }
    });
    foreignCinemaId = foreignCinema.id;
    const inactiveCinema = await prisma.cinema.create({
      data: { name: `Authorization Inactive Cinema ${fixture}`, city: "Test", address: "Inactive assignment fixture", status: RecordStatus.INACTIVE }
    });
    inactiveCinemaId = inactiveCinema.id;

    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `Regression Room ${fixture}` } });
    auditoriumId = auditorium.id;
    const foreignAuditorium = await prisma.auditorium.create({ data: { cinemaId: foreignCinema.id, name: `Foreign Room ${fixture}` } });
    foreignAuditoriumId = foreignAuditorium.id;
    const foreignSeat = await prisma.seat.create({
      data: { auditoriumId: foreignAuditorium.id, label: "F1", row: "F", column: 1, type: SeatType.STANDARD }
    });
    foreignSeatId = foreignSeat.id;
    const seat = await prisma.seat.create({
      data: { auditoriumId: auditorium.id, label: "R1", row: "R", column: 1, type: SeatType.STANDARD }
    });
    seatId = seat.id;
    const roleSeats = await Promise.all([
      prisma.seat.create({ data: { auditoriumId: auditorium.id, label: "R2", row: "R", column: 2, type: SeatType.STANDARD } }),
      prisma.seat.create({ data: { auditoriumId: auditorium.id, label: "R3", row: "R", column: 3, type: SeatType.STANDARD } })
    ]);
    roleSeatIds.push(...roleSeats.map((roleSeat) => roleSeat.id));

    const movie = await prisma.movie.create({
      data: {
        slug: `authorization-regression-${fixture}`,
        title: `Authorization Regression ${fixture}`,
        genre: "Test",
        synopsis: "Temporary fixture for payment ownership and profile mass-assignment regressions.",
        runtimeMinutes: 90,
        ageRating: "P",
        status: RecordStatus.ACTIVE
      }
    });
    movieId = movie.id;

    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtime = await prisma.showtime.create({
      data: {
        movieId: movie.id,
        auditoriumId: auditorium.id,
        startAt,
        endAt: new Date(startAt.getTime() + 90 * 60_000),
        priceVnd: 100_000,
        status: RecordStatus.ACTIVE
      }
    });
    showtimeId = showtime.id;

    const userA = await prisma.user.create({
      data: { name: "Payment Order Owner", email: `payment-owner-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER }
    });
    userAId = userA.id;
    userIds.push(userA.id);
    const userB = await prisma.user.create({
      data: { name: "Authorization Regression Customer", email: `regression-customer-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER }
    });
    userBId = userB.id;
    userIds.push(userB.id);
    const staff = await prisma.user.create({
      data: { name: "Authorization Regression Staff", email: `regression-staff-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.STAFF, assignedCinemaId: cinema.id }
    });
    staffId = staff.id;
    userIds.push(staff.id);
    const admin = await prisma.user.create({
      data: { name: "Authorization Regression Admin", email: `regression-admin-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN }
    });
    adminId = admin.id;
    userIds.push(admin.id);
    const protectedStaff = await prisma.user.create({
      data: { name: "Regression Protected Staff", email: `regression-protected-staff-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.STAFF, assignedCinemaId: cinema.id }
    });
    protectedStaffId = protectedStaff.id;
    userIds.push(protectedStaff.id);
    tokenB = createToken({ id: userB.id, authVersion: userB.authVersion });
    staffToken = createToken({ id: staff.id, authVersion: staff.authVersion });
    protectedStaffToken = createToken({ id: protectedStaff.id, authVersion: protectedStaff.authVersion });
    adminToken = createToken({ id: admin.id, authVersion: admin.authVersion });

    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const hold = await prisma.seatHold.create({
      data: { userId: userAId, showtimeId: showtime.id, status: HoldStatus.PAYMENT_PENDING, expiresAt }
    });
    holdId = hold.id;

    const order = await prisma.cinemaOrder.create({
      data: { userId: userAId, showtimeId: showtime.id, holdId: hold.id, status: OrderStatus.PAYMENT_PENDING, totalVnd: 100_000 }
    });
    orderId = order.id;

    await prisma.seatClaim.create({
      data: { showtimeId: showtime.id, seatId: seat.id, holdId: hold.id, orderId: order.id, status: ClaimStatus.HELD, expiresAt, priceVnd: 100_000 }
    });
    await prisma.payment.create({ data: { orderId: order.id, status: PaymentStatus.PENDING, amountVnd: 100_000 } });

    for (const [index, actor] of [
      { role: Role.STAFF, userId: staff.id },
      { role: Role.ADMIN, userId: admin.id }
    ].entries()) {
      const roleHold = await prisma.seatHold.create({
        data: { userId: actor.userId, showtimeId: showtime.id, status: HoldStatus.CONFIRMED, expiresAt }
      });
      const roleOrder = await prisma.cinemaOrder.create({
        data: { userId: actor.userId, showtimeId: showtime.id, holdId: roleHold.id, status: OrderStatus.CONFIRMED, totalVnd: 100_000 }
      });
      roleOrderIds.push(roleOrder.id);
      roleOwnedOrderIds.set(actor.role, roleOrder.id);
      const roleClaim = await prisma.seatClaim.create({
        data: {
          showtimeId: showtime.id,
          seatId: roleSeats[index]!.id,
          holdId: roleHold.id,
          orderId: roleOrder.id,
          status: ClaimStatus.SOLD,
          priceVnd: 100_000
        }
      });
      const qrToken = `role-order-qr-${fixture}-${actor.role.toLowerCase()}`;
      await prisma.payment.create({ data: { orderId: roleOrder.id, status: PaymentStatus.SUCCEEDED, amountVnd: 100_000 } });
      await prisma.ticket.create({ data: { orderId: roleOrder.id, seatClaimId: roleClaim.id, qrToken } });
      roleQrTokens.set(actor.role, qrToken);
    }
  }, 30_000);

  afterAll(async () => {
    try {
      if (attemptedShowtimeStarts.length && movieId && auditoriumId) {
        const attemptedShowtimes = await prisma.showtime.findMany({
          where: { movieId, auditoriumId, startAt: { in: attemptedShowtimeStarts } },
          select: { id: true }
        });
        if (attemptedShowtimes.length) await prisma.showtime.deleteMany({ where: { id: { in: attemptedShowtimes.map((item) => item.id) } } });
      }
      if (cinemaId) {
        const attemptedRooms = await prisma.auditorium.findMany({
          where: { cinemaId, name: { in: attemptedRoomNames } },
          select: { id: true }
        });
        const attemptedRoomIds = attemptedRooms.map((item) => item.id);
        if (attemptedRoomIds.length) {
          await prisma.seat.deleteMany({ where: { auditoriumId: { in: attemptedRoomIds } } });
          await prisma.auditorium.deleteMany({ where: { id: { in: attemptedRoomIds } } });
        }
      }
      await prisma.movie.deleteMany({ where: { slug: { in: attemptedMovieSlugs } } });
      await prisma.cinema.deleteMany({ where: { name: { in: attemptedCinemaNames } } });
      const fixtureOrderIds = [...(orderId ? [orderId] : []), ...roleOrderIds];
      if (fixtureOrderIds.length) {
        await prisma.reconciliationCase.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: fixtureOrderIds } } });
        await prisma.ticket.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
        await prisma.paymentEvent.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
        await prisma.seatClaim.deleteMany({ where: { orderId: { in: fixtureOrderIds } } });
        await prisma.cinemaOrder.deleteMany({ where: { id: { in: fixtureOrderIds } } });
      }
      if (showtimeId) {
        await prisma.seatClaim.deleteMany({ where: { showtimeId } });
        await prisma.seatHold.deleteMany({ where: { showtimeId } });
        await prisma.showtime.deleteMany({ where: { id: showtimeId } });
      } else if (holdId) {
        await prisma.seatHold.deleteMany({ where: { id: holdId } });
      }
      if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      if (seatId) await prisma.seat.deleteMany({ where: { id: seatId } });
      if (roleSeatIds.length) await prisma.seat.deleteMany({ where: { id: { in: roleSeatIds } } });
      if (foreignSeatId) await prisma.seat.deleteMany({ where: { id: foreignSeatId } });
      if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
      if (foreignAuditoriumId) await prisma.auditorium.deleteMany({ where: { id: foreignAuditoriumId } });
      if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (inactiveCinemaId) await prisma.cinema.deleteMany({ where: { id: inactiveCinemaId } });
      if (foreignCinemaId) await prisma.cinema.deleteMany({ where: { id: foreignCinemaId } });
      if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  const protectedOrderState = async () => ({
    hold: await prisma.seatHold.findUniqueOrThrow({ where: { id: holdId! } }),
    order: await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: orderId! } }),
    payment: await prisma.payment.findUniqueOrThrow({ where: { orderId: orderId! } }),
    claims: await prisma.seatClaim.findMany({ where: { holdId: holdId! }, orderBy: { id: "asc" } }),
    tickets: await prisma.ticket.findMany({ where: { orderId: orderId! }, orderBy: { id: "asc" } }),
    paymentEvents: await prisma.paymentEvent.findMany({ where: { orderId: orderId! }, orderBy: { id: "asc" } }),
    outboxEvents: await prisma.outboxEvent.findMany({ where: { aggregateId: orderId! }, orderBy: { id: "asc" } }),
    reconciliationCases: await prisma.reconciliationCase.findMany({ where: { orderId: orderId! }, orderBy: { id: "asc" } }),
    orderAudits: await prisma.auditLog.findMany({ where: { entityId: orderId! }, orderBy: { id: "asc" } }),
    actorAudits: await prisma.auditLog.findMany({ where: { actorId: userBId! }, orderBy: { id: "asc" } })
  });

  it("[TC-SEC-04][TC-SEC-11] prevents a customer from completing another customer's payment", async () => {
    const relatedBefore = await protectedOrderState();
    const orderBefore = await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: orderId! } });
    const paymentBefore = await prisma.payment.findUniqueOrThrow({ where: { orderId: orderId! } });
    const ticketsBefore = await prisma.ticket.findMany({ where: { orderId: orderId! }, orderBy: { id: "asc" } });
    const paymentEventsBefore = await prisma.paymentEvent.count({ where: { orderId: orderId! } });
    expect(orderBefore.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect(paymentBefore.status).toBe(PaymentStatus.PENDING);
    expect(ticketsBefore).toHaveLength(0);

    const attempt = await request(app)
      .post("/api/payments/mock/complete")
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ orderId });

    expect(attempt.status).toBe(404);
    expect(attempt.body.error).toBe("ORDER_NOT_FOUND");
    expect(await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: orderId! } })).toEqual(orderBefore);
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderId: orderId! } })).toEqual(paymentBefore);
    expect(await prisma.ticket.findMany({ where: { orderId: orderId! }, orderBy: { id: "asc" } })).toEqual(ticketsBefore);
    expect(await prisma.paymentEvent.count({ where: { orderId: orderId! } })).toBe(paymentEventsBefore);
    expect(await protectedOrderState()).toEqual(relatedBefore);
  }, 30_000);

  it("[TC-SEC-05] rejects role and cinema assignment mass assignment on the current profile", async () => {
    const profileBefore = await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${tokenB}` });
    expect(profileBefore.status).toBe(200);
    expect(profileBefore.body).toMatchObject({ id: userBId, role: Role.CUSTOMER, assignedCinemaId: null });

    const roleAttempt = await request(app)
      .patch("/api/auth/me")
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ role: Role.ADMIN });
    expect(roleAttempt.status).toBe(422);
    expect(roleAttempt.body.error).toBe("VALIDATION_ERROR");

    const assignmentAttempt = await request(app)
      .patch("/api/auth/me")
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ assignedCinemaId: cinemaId });
    expect(assignmentAttempt.status).toBe(422);
    expect(assignmentAttempt.body.error).toBe("VALIDATION_ERROR");

    const profileAfter = await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${tokenB}` });
    expect(profileAfter.status).toBe(200);
    expect(profileAfter.body).toEqual(profileBefore.body);
    expect(profileAfter.body).toMatchObject({ role: Role.CUSTOMER, assignedCinemaId: null });
  }, 30_000);

  it("[TC-SEC-23] rejects auditorium and seat ownership mass assignment and blocks mutation of held or sold seats", async () => {
    const adminAuth = { Authorization: `Bearer ${adminToken}` };
    const snapshot = async () => ({
      auditoriums: await prisma.auditorium.findMany({
        where: { cinemaId: { in: [cinemaId!, foreignCinemaId!] } },
        orderBy: { id: "asc" },
        select: { id: true, cinemaId: true, name: true, screenType: true }
      }),
      seats: await prisma.seat.findMany({
        where: { auditoriumId: { in: [auditoriumId!, foreignAuditoriumId!] } },
        orderBy: { id: "asc" },
        select: { id: true, auditoriumId: true, label: true, row: true, column: true, type: true, isAccessible: true }
      }),
      claims: await prisma.seatClaim.findMany({
        where: { showtimeId, seatId: { in: [seatId!, roleSeatIds[0]!] } },
        orderBy: { seatId: "asc" }
      }),
      createAudits: await prisma.auditLog.count({ where: { actorId: adminId, action: "AUDITORIUM_CREATED" } }),
      auditoriumUpdateAudits: await prisma.auditLog.count({ where: { actorId: adminId, action: "AUDITORIUM_UPDATED" } }),
      seatUpdateAudits: await prisma.auditLog.count({ where: { actorId: adminId, action: "SEAT_UPDATED" } })
    });
    const before = await snapshot();

    const nestedSeatOwnership = await request(app).post("/api/admin/auditoriums").set(adminAuth).send({
      cinemaId,
      name: attemptedRoomNames[2],
      seats: [{ label: "M1", row: "M", column: 1, type: SeatType.STANDARD, auditoriumId: foreignAuditoriumId }]
    });
    expect(nestedSeatOwnership.status).toBe(422);
    expect(nestedSeatOwnership.body.error).toBe("VALIDATION_ERROR");
    expect(await snapshot()).toEqual(before);

    const auditoriumOwnership = await request(app).patch(`/api/admin/auditoriums/${auditoriumId!}`).set(adminAuth)
      .send({ cinemaId: foreignCinemaId });
    expect(auditoriumOwnership.status).toBe(422);
    expect(auditoriumOwnership.body.error).toBe("VALIDATION_ERROR");
    expect(await snapshot()).toEqual(before);

    const seatOwnership = await request(app).patch(`/api/admin/seats/${seatId!}`).set(adminAuth)
      .send({ auditoriumId: foreignAuditoriumId });
    expect(seatOwnership.status).toBe(422);
    expect(seatOwnership.body.error).toBe("VALIDATION_ERROR");
    expect(await snapshot()).toEqual(before);

    const heldSeatMutation = await request(app).patch(`/api/admin/seats/${seatId!}`).set(adminAuth).send({ label: "R2" });
    expect(heldSeatMutation.status).toBe(409);
    expect(heldSeatMutation.body.error).toBe("SEAT_HAS_BOOKINGS");
    expect(await snapshot()).toEqual(before);

    const soldSeatMutation = await request(app).patch(`/api/admin/seats/${roleSeatIds[0]!}`).set(adminAuth).send({ label: "R4" });
    expect(soldSeatMutation.status).toBe(409);
    expect(soldSeatMutation.body.error).toBe("SEAT_HAS_BOOKINGS");
    expect(await snapshot()).toEqual(before);
  }, 30_000);

  it("[TC-SEC-24] rejects Admin self-demotion and assignment of Staff to an inactive cinema without writes", async () => {
    const adminAuth = { Authorization: `Bearer ${adminToken}` };
    const adminBefore = await prisma.user.findUniqueOrThrow({
      where: { id: adminId! },
      select: { id: true, role: true, authVersion: true, assignedCinemaId: true }
    });
    const selfDemotionAuditsBefore = await prisma.auditLog.count({
      where: { actorId: adminId, action: "USER_ROLE_CHANGED", entity: "User", entityId: adminId }
    });

    const selfDemotion = await request(app).patch(`/api/admin/users/${adminId!}/role`).set(adminAuth).send({ role: Role.CUSTOMER });
    expect(selfDemotion.status).toBe(422);
    expect(selfDemotion.body.error).toBe("SELF_DEMOTION_FORBIDDEN");
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: adminId! },
      select: { id: true, role: true, authVersion: true, assignedCinemaId: true }
    })).toEqual(adminBefore);
    expect(await prisma.auditLog.count({
      where: { actorId: adminId, action: "USER_ROLE_CHANGED", entity: "User", entityId: adminId }
    })).toBe(selfDemotionAuditsBefore);

    const staffBefore = await prisma.user.findUniqueOrThrow({
      where: { id: protectedStaffId! },
      select: { id: true, role: true, authVersion: true, assignedCinemaId: true }
    });
    expect(staffBefore).toMatchObject({ role: Role.STAFF, assignedCinemaId: cinemaId });
    const assignmentAuditsBefore = await prisma.auditLog.count({
      where: { actorId: adminId, action: "STAFF_CINEMA_ASSIGNED", entity: "User", entityId: protectedStaffId }
    });

    const inactiveAssignment = await request(app).patch(`/api/admin/users/${protectedStaffId!}/assigned-cinema`).set(adminAuth)
      .send({ cinemaId: inactiveCinemaId });
    expect(inactiveAssignment.status).toBe(404);
    expect(inactiveAssignment.body.error).toBe("CINEMA_NOT_FOUND");
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: protectedStaffId! },
      select: { id: true, role: true, authVersion: true, assignedCinemaId: true }
    })).toEqual(staffBefore);
    expect(await prisma.auditLog.count({
      where: { actorId: adminId, action: "STAFF_CINEMA_ASSIGNED", entity: "User", entityId: protectedStaffId }
    })).toBe(assignmentAuditsBefore);
  }, 30_000);

  it("[TC-SEC-29] does not assign a cinema after a concurrent Staff demotion", async () => {
    const raceStaff = await prisma.user.create({
      data: {
        name: "Concurrent Staff Assignment Regression",
        email: `concurrent-staff-assignment-${fixture}@test.local`,
        passwordHash: "unused-in-concurrent-assignment-test",
        role: Role.STAFF,
        assignedCinemaId: cinemaId
      }
    });
    userIds.push(raceStaff.id);

    const assignmentAuditsBefore = await prisma.auditLog.count({
      where: { actorId: adminId, action: "STAFF_CINEMA_ASSIGNED", entity: "User", entityId: raceStaff.id }
    });
    let signalRowLocked!: () => void;
    let releaseDemotion!: () => void;
    const rowLocked = new Promise<void>((resolve) => { signalRowLocked = resolve; });
    const waitForDemotion = new Promise<void>((resolve) => { releaseDemotion = resolve; });

    const demotionTransaction = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${raceStaff.id} FOR UPDATE`;
      signalRowLocked();
      await waitForDemotion;
      await tx.user.update({
        where: { id: raceStaff.id },
        data: { role: Role.CUSTOMER, assignedCinemaId: null, authVersion: { increment: 1 } }
      });
    }, { timeout: 15_000 });

    let assignmentPromise: Promise<{ status: number; body: Record<string, unknown> }> | undefined;
    try {
      await rowLocked;
      assignmentPromise = request(app)
        .patch(`/api/admin/users/${raceStaff.id}/assigned-cinema`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ cinemaId: foreignCinemaId })
        .then((response) => ({ status: response.status, body: response.body as Record<string, unknown> }));

      let updateIsBlockedOnTheLockedStaffRow = false;
      const deadline = Date.now() + 8_000;
      while (!updateIsBlockedOnTheLockedStaffRow && Date.now() < deadline) {
        const blockedUpdates = await prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT pid::int AS pid
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
            AND wait_event_type = 'Lock'
            AND query ILIKE 'UPDATE%'
            AND query ILIKE '%assignedCinemaId%'
        `;
        updateIsBlockedOnTheLockedStaffRow = blockedUpdates.length > 0;
        if (!updateIsBlockedOnTheLockedStaffRow) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(updateIsBlockedOnTheLockedStaffRow).toBe(true);

      releaseDemotion();
      await demotionTransaction;
      const assignment = await assignmentPromise;
      expect(assignment.status).toBe(422);
      expect(assignment.body.error).toBe("STAFF_REQUIRED");

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: raceStaff.id },
        select: { role: true, assignedCinemaId: true, authVersion: true }
      });
      expect(after).toMatchObject({ role: Role.CUSTOMER, assignedCinemaId: null, authVersion: raceStaff.authVersion + 1 });
      expect(await prisma.auditLog.count({
        where: { actorId: adminId, action: "STAFF_CINEMA_ASSIGNED", entity: "User", entityId: raceStaff.id }
      })).toBe(assignmentAuditsBefore);
    } finally {
      releaseDemotion();
      await demotionTransaction.catch(() => undefined);
      await assignmentPromise?.catch(() => undefined);
    }
  }, 30_000);

  it("[TC-SEC-25] exposes only the allowlisted fields in Admin users and nested cinema responses", async () => {
    const response = await request(app).get("/api/admin/users").set({ Authorization: `Bearer ${adminToken}` });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    const expectedUserKeys = ["assignedCinema", "assignedCinemaId", "createdAt", "email", "id", "name", "role"].sort();
    const expectedCinemaKeys = ["id", "name"].sort();

    for (const user of response.body as Array<Record<string, unknown>>) {
      expect(Object.keys(user).sort()).toEqual(expectedUserKeys);
      if (user.assignedCinema !== null) {
        expect(user.assignedCinema).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String) }));
        expect(Object.keys(user.assignedCinema as Record<string, unknown>).sort()).toEqual(expectedCinemaKeys);
      }
    }

    const protectedStaff = (response.body as Array<Record<string, unknown>>).find((user) => user.id === protectedStaffId);
    expect(protectedStaff?.assignedCinema).toMatchObject({ id: cinemaId, name: `Authorization Regression ${fixture}` });
    expect((response.body as Array<Record<string, unknown>>).some((user) => user.assignedCinema === null)).toBe(true);
  }, 30_000);

  it("[TC-SEC-26] rejects short and unknown QR scans without tickets, check-in state, or audit writes", async () => {
    const staffAuth = { Authorization: `Bearer ${protectedStaffToken}` };
    const ticketState = async () => ({
      tickets: await prisma.ticket.findMany({
        where: { orderId: orderId! },
        orderBy: { id: "asc" },
        select: { id: true, orderId: true, seatClaimId: true, qrToken: true, checkedInAt: true }
      }),
      checkInAudits: await prisma.auditLog.findMany({
        where: { actorId: protectedStaffId, action: "TICKET_CHECKED_IN", entity: "Ticket" },
        orderBy: { id: "asc" },
        select: { id: true, entityId: true, metadata: true }
      })
    });
    const before = await ticketState();

    const malformed = await request(app).post("/api/tickets/scan").set(staffAuth).send({ qrToken: "short" });
    expect(malformed.status).toBe(422);
    expect(malformed.body.error).toBe("VALIDATION_ERROR");
    expect(await ticketState()).toEqual(before);

    const unknownQrToken = randomUUID().replaceAll("-", "");
    const unknown = await request(app).post("/api/tickets/scan").set(staffAuth).send({ qrToken: unknownQrToken });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("TICKET_NOT_FOUND");
    expect(await prisma.ticket.findUnique({ where: { qrToken: unknownQrToken } })).toBeNull();
    expect(await ticketState()).toEqual(before);
  }, 30_000);

  it("[TC-SEC-08] requires authentication on every protected route family", async () => {
    const freshShowtimeAt = new Date(Date.now() + 1_000 * 86_400_000).toISOString();
    attemptedShowtimeStarts.push(new Date(freshShowtimeAt));
    const protectedRoutes: GuardedRoute[] = [
      { method: "GET", path: "/api/auth/me" },
      { method: "PATCH", path: "/api/auth/me", body: { name: "Guest profile mutation" } },
      { method: "POST", path: "/api/holds", body: { showtimeId, seatIds: [seatId] } },
      { method: "POST", path: "/api/orders", body: { holdId } },
      { method: "POST", path: "/api/payments/mock/complete", body: { orderId } },
      { method: "GET", path: "/api/orders/me" },
      { method: "GET", path: `/api/orders/${orderId!}` },
      { method: "POST", path: `/api/tickets/${randomUUID()}/check-in` },
      { method: "POST", path: "/api/tickets/scan", body: { qrToken: "G".repeat(32) } },
      { method: "GET", path: "/api/admin/summary" },
      { method: "GET", path: "/api/admin/reports/occupancy" },
      { method: "GET", path: "/api/admin/cinemas" },
      { method: "POST", path: "/api/admin/cinemas", body: { name: `Guest cinema ${fixture}`, city: "Test City", address: "Guest mutation attempt" } },
      { method: "PATCH", path: `/api/admin/cinemas/${cinemaId!}`, body: { name: `Guest edit ${fixture}` } },
      { method: "GET", path: "/api/admin/movies" },
      { method: "POST", path: "/api/admin/movies", body: { title: "Guest Movie", slug: `guest-movie-${fixture}`, genre: "Test", synopsis: "Guest mutation attempt for authorization test.", runtimeMinutes: 90, ageRating: "P" } },
      { method: "PATCH", path: `/api/admin/movies/${movieId!}`, body: { title: `Guest edit ${fixture}` } },
      { method: "GET", path: "/api/admin/auditoriums" },
      { method: "POST", path: "/api/admin/auditoriums", body: { cinemaId, name: `Guest room ${fixture}`, seats: [{ label: "G1", row: "G", column: 1 }] } },
      { method: "PATCH", path: `/api/admin/auditoriums/${auditoriumId!}`, body: { name: `Guest room edit ${fixture}` } },
      { method: "PATCH", path: `/api/admin/seats/${seatId!}`, body: { label: "G2" } },
      { method: "GET", path: "/api/admin/showtimes" },
      { method: "POST", path: "/api/admin/showtimes", body: { movieId, auditoriumId, startAt: freshShowtimeAt, priceVnd: 100_000 } },
      { method: "PATCH", path: `/api/admin/showtimes/${showtimeId!}`, body: { priceVnd: 125_000 } },
      { method: "GET", path: "/api/admin/users" },
      { method: "PATCH", path: `/api/admin/users/${userAId!}/role`, body: { role: Role.ADMIN } },
      { method: "PATCH", path: `/api/admin/users/${staffId!}/assigned-cinema`, body: { cinemaId: null } }
    ];
    expect(protectedRoutes).toHaveLength(27);

    for (const route of protectedRoutes) {
      const response = await sendAs(app, undefined, route);
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
      expect(response.body.error, `${route.method} ${route.path}`).toBe("AUTH_REQUIRED");
    }

    expect(await prisma.cinema.findFirst({ where: { name: `Guest cinema ${fixture}` } })).toBeNull();
    expect(await prisma.movie.findFirst({ where: { slug: `guest-movie-${fixture}` } })).toBeNull();
    expect(await prisma.auditorium.findFirst({ where: { name: `Guest room ${fixture}` } })).toBeNull();
    expect(await prisma.showtime.findFirst({ where: { movieId: movieId!, auditoriumId: auditoriumId!, startAt: new Date(freshShowtimeAt) } })).toBeNull();
    expect((await prisma.cinema.findUniqueOrThrow({ where: { id: cinemaId! } })).name).not.toBe(`Guest edit ${fixture}`);
    expect((await prisma.movie.findUniqueOrThrow({ where: { id: movieId! } })).title).not.toBe(`Guest edit ${fixture}`);
    expect((await prisma.auditorium.findUniqueOrThrow({ where: { id: auditoriumId! } })).name).not.toBe(`Guest room edit ${fixture}`);
    expect((await prisma.seat.findUniqueOrThrow({ where: { id: seatId! } })).label).toBe("R1");
    expect((await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeId! } })).priceVnd).toBe(100_000);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userAId! } })).role).toBe(Role.CUSTOMER);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId! } })).assignedCinemaId).toBe(cinemaId);
    expect(await prisma.seatHold.count({ where: { userId: userBId! } })).toBe(0);
  }, 30_000);

  it("[TC-SEC-06][TC-SEC-09] denies Customer and Staff on all 18 Admin routes without mutations", async () => {
    const freshShowtimeAt = new Date(Date.now() + 1_001 * 86_400_000);
    attemptedShowtimeStarts.push(freshShowtimeAt);
    const createdCinemaName = `Denied cinema ${fixture}`;
    const createdMovieSlug = `denied-movie-${fixture}`;
    const createdRoomName = `Denied room ${fixture}`;
    const adminRoutes: GuardedRoute[] = [
      { method: "GET", path: "/api/admin/summary" },
      { method: "GET", path: "/api/admin/reports/occupancy" },
      { method: "GET", path: "/api/admin/cinemas" },
      { method: "POST", path: "/api/admin/cinemas", body: { name: createdCinemaName, city: "Test City", address: "Valid denied create payload" } },
      { method: "PATCH", path: `/api/admin/cinemas/${cinemaId!}`, body: { name: `Denied edit cinema ${fixture}` } },
      { method: "GET", path: "/api/admin/movies" },
      { method: "POST", path: "/api/admin/movies", body: { title: "Denied Movie", slug: createdMovieSlug, genre: "Test", synopsis: "A valid payload for role matrix authorization.", runtimeMinutes: 90, ageRating: "P" } },
      { method: "PATCH", path: `/api/admin/movies/${movieId!}`, body: { title: `Denied edit movie ${fixture}` } },
      { method: "GET", path: "/api/admin/auditoriums" },
      { method: "POST", path: "/api/admin/auditoriums", body: { cinemaId, name: createdRoomName, seats: [{ label: "D1", row: "D", column: 1 }] } },
      { method: "PATCH", path: `/api/admin/auditoriums/${auditoriumId!}`, body: { name: `Denied edit room ${fixture}` } },
      { method: "PATCH", path: `/api/admin/seats/${seatId!}`, body: { label: "D2" } },
      { method: "GET", path: "/api/admin/showtimes" },
      { method: "POST", path: "/api/admin/showtimes", body: { movieId, auditoriumId, startAt: freshShowtimeAt.toISOString(), priceVnd: 100_000 } },
      { method: "PATCH", path: `/api/admin/showtimes/${showtimeId!}`, body: { priceVnd: 125_000 } },
      { method: "GET", path: "/api/admin/users" },
      { method: "PATCH", path: `/api/admin/users/${userAId!}/role`, body: { role: Role.ADMIN } },
      { method: "PATCH", path: `/api/admin/users/${staffId!}/assigned-cinema`, body: { cinemaId: null } }
    ];
    expect(adminRoutes).toHaveLength(18);

    const snapshot = async () => ({
      cinema: await prisma.cinema.findUniqueOrThrow({ where: { id: cinemaId! } }),
      movie: await prisma.movie.findUniqueOrThrow({ where: { id: movieId! } }),
      auditorium: await prisma.auditorium.findUniqueOrThrow({ where: { id: auditoriumId! } }),
      seat: await prisma.seat.findUniqueOrThrow({ where: { id: seatId! } }),
      showtime: await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeId! } }),
      customer: await prisma.user.findUniqueOrThrow({ where: { id: userAId! }, select: { id: true, role: true, assignedCinemaId: true, authVersion: true } }),
      staff: await prisma.user.findUniqueOrThrow({ where: { id: staffId! }, select: { id: true, role: true, assignedCinemaId: true, authVersion: true } }),
      createdCinema: await prisma.cinema.findFirst({ where: { name: createdCinemaName } }),
      createdMovie: await prisma.movie.findFirst({ where: { slug: createdMovieSlug } }),
      createdAuditorium: await prisma.auditorium.findFirst({ where: { cinemaId: cinemaId!, name: createdRoomName }, include: { seats: true } }),
      createdShowtime: await prisma.showtime.findFirst({ where: { movieId: movieId!, auditoriumId: auditoriumId!, startAt: freshShowtimeAt } }),
      actorAudits: await prisma.auditLog.findMany({ where: { actorId: { in: [userBId!, staffId!] } }, orderBy: { id: "asc" } })
    });

    for (const actor of [
      { name: "Customer", token: tokenB },
      { name: "Staff", token: staffToken }
    ]) {
      const before = await snapshot();
      for (const route of adminRoutes) {
        const response = await sendAs(app, actor.token, route);
        expect(response.status, `${actor.name}: ${route.method} ${route.path}`).toBe(403);
        expect(response.body.error, `${actor.name}: ${route.method} ${route.path}`).toBe("ROLE_FORBIDDEN");
      }
      expect(await snapshot(), `${actor.name} Admin-route side effects`).toEqual(before);
    }
  }, 30_000);

  it("[TC-SEC-07][TC-SEC-11] prevents a customer from reading or using another customer's hold/order", async () => {
    const relatedBefore = await protectedOrderState();
    const holdBefore = await prisma.seatHold.findUniqueOrThrow({ where: { id: holdId! } });
    const orderBefore = await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: orderId! } });
    const paymentBefore = await prisma.payment.findUniqueOrThrow({ where: { orderId: orderId! } });
    const claimsBefore = await prisma.seatClaim.findMany({ where: { holdId: holdId! }, orderBy: { id: "asc" } });
    const ownerAuditBefore = await prisma.auditLog.count({
      where: { actorId: userBId!, action: "ORDER_CREATED", entityId: orderId! }
    });

    const foreignOrderRead = await request(app)
      .get(`/api/orders/${orderId!}`)
      .set({ Authorization: `Bearer ${tokenB}` });
    expect(foreignOrderRead.status).toBe(404);
    expect(foreignOrderRead.body.error).toBe("ORDER_NOT_FOUND");
    expect(JSON.stringify(foreignOrderRead.body)).not.toContain(orderId);

    const ownOrderList = await request(app)
      .get("/api/orders/me")
      .set({ Authorization: `Bearer ${tokenB}` });
    expect(ownOrderList.status).toBe(200);
    expect(JSON.stringify(ownOrderList.body)).not.toContain(orderId);

    const attempt = await request(app)
      .post("/api/orders")
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ holdId });

    expect(attempt.status).toBe(404);
    expect(attempt.body.error).toBe("HOLD_NOT_FOUND");
    expect(JSON.stringify(attempt.body)).not.toContain(orderId);
    expect(await prisma.seatHold.findUniqueOrThrow({ where: { id: holdId! } })).toEqual(holdBefore);
    expect(await prisma.cinemaOrder.findUniqueOrThrow({ where: { id: orderId! } })).toEqual(orderBefore);
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderId: orderId! } })).toEqual(paymentBefore);
    expect(await prisma.seatClaim.findMany({ where: { holdId: holdId! }, orderBy: { id: "asc" } })).toEqual(claimsBefore);
    expect(await prisma.ticket.count({ where: { orderId: orderId! } })).toBe(0);
    expect(await prisma.paymentEvent.count({ where: { orderId: orderId! } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: orderId! } })).toBe(0);
    expect(await prisma.reconciliationCase.count({ where: { orderId: orderId! } })).toBe(0);
    expect(await prisma.auditLog.count({
      where: { actorId: userBId!, action: "ORDER_CREATED", entityId: orderId! }
    })).toBe(ownerAuditBefore);
    expect(await protectedOrderState()).toEqual(relatedBefore);
  }, 30_000);

  it("[TC-SEC-21] denies Staff and Admin from Customer-only booking/payment APIs without side effects", async () => {
    const stateBefore = await protectedOrderState();
    const holdCountBefore = await prisma.seatHold.count({ where: { showtimeId } });
    const claimCountBefore = await prisma.seatClaim.count({ where: { showtimeId } });
    const staffAuditsBefore = await prisma.auditLog.findMany({ where: { actorId: staffId! }, orderBy: { id: "asc" } });
    const adminAuditsBefore = await prisma.auditLog.findMany({ where: { actorId: adminId! }, orderBy: { id: "asc" } });
    const ownedBookingsBefore = {
      orders: await prisma.cinemaOrder.findMany({ where: { id: { in: roleOrderIds } }, orderBy: { id: "asc" } }),
      holds: await prisma.seatHold.findMany({ where: { showtimeId, userId: { in: [staffId!, adminId!] } }, orderBy: { id: "asc" } }),
      claims: await prisma.seatClaim.findMany({ where: { orderId: { in: roleOrderIds } }, orderBy: { id: "asc" } }),
      payments: await prisma.payment.findMany({ where: { orderId: { in: roleOrderIds } }, orderBy: { orderId: "asc" } }),
      tickets: await prisma.ticket.findMany({ where: { orderId: { in: roleOrderIds } }, orderBy: { orderId: "asc" } })
    };

    for (const actor of [
      { role: "Staff", roleKey: Role.STAFF, token: staffToken },
      { role: "Admin", roleKey: Role.ADMIN, token: adminToken }
    ]) {
      const ownOrderId = roleOwnedOrderIds.get(actor.roleKey)!;
      const ownQrToken = roleQrTokens.get(actor.roleKey)!;
      expect(ownedBookingsBefore.orders).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: ownOrderId,
          userId: actor.roleKey === Role.STAFF ? staffId : adminId,
          status: OrderStatus.CONFIRMED
        })
      ]));
      expect(ownedBookingsBefore.tickets).toEqual(expect.arrayContaining([
        expect.objectContaining({ orderId: ownOrderId, qrToken: ownQrToken })
      ]));
      for (const route of [
        { method: "POST" as const, path: "/api/holds", body: { showtimeId, seatIds: [seatId] } },
        { method: "POST" as const, path: "/api/orders", body: { holdId } },
        { method: "POST" as const, path: "/api/payments/mock/complete", body: { orderId } },
        { method: "GET" as const, path: "/api/orders/me" },
        { method: "GET" as const, path: `/api/orders/${ownOrderId}` }
      ]) {
        const response = await sendAs(app, actor.token, route);
        expect(response.status, `${actor.role}: ${route.path}`).toBe(403);
        expect(response.body.error, `${actor.role}: ${route.path}`).toBe("ROLE_FORBIDDEN");
        expect(JSON.stringify(response.body)).not.toContain(ownOrderId);
        expect(JSON.stringify(response.body)).not.toContain(ownQrToken);
      }
    }

    expect(await protectedOrderState()).toEqual(stateBefore);
    expect(await prisma.seatHold.count({ where: { showtimeId } })).toBe(holdCountBefore);
    expect(await prisma.seatClaim.count({ where: { showtimeId } })).toBe(claimCountBefore);
    expect(await prisma.auditLog.findMany({ where: { actorId: staffId! }, orderBy: { id: "asc" } })).toEqual(staffAuditsBefore);
    expect(await prisma.auditLog.findMany({ where: { actorId: adminId! }, orderBy: { id: "asc" } })).toEqual(adminAuditsBefore);
    expect({
      orders: await prisma.cinemaOrder.findMany({ where: { id: { in: roleOrderIds } }, orderBy: { id: "asc" } }),
      holds: await prisma.seatHold.findMany({ where: { showtimeId, userId: { in: [staffId!, adminId!] } }, orderBy: { id: "asc" } }),
      claims: await prisma.seatClaim.findMany({ where: { orderId: { in: roleOrderIds } }, orderBy: { id: "asc" } }),
      payments: await prisma.payment.findMany({ where: { orderId: { in: roleOrderIds } }, orderBy: { orderId: "asc" } }),
      tickets: await prisma.ticket.findMany({ where: { orderId: { in: roleOrderIds } }, orderBy: { orderId: "asc" } })
    }).toEqual(ownedBookingsBefore);
  }, 30_000);

  it("[TC-API-01][TC-SEC-12] lets Admin inspect users and change a Staff role with audit and immediate permission update", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: staffId! } });
    expect(before.role).toBe(Role.STAFF);
    expect(before.assignedCinemaId).toBe(cinemaId);

    const list = await request(app).get("/api/admin/users").set({ Authorization: `Bearer ${adminToken}` });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: staffId, role: Role.STAFF, assignedCinemaId: cinemaId }),
      expect.objectContaining({ id: userBId, role: Role.CUSTOMER, assignedCinemaId: null })
    ]));
    expect(list.body.every((user: Record<string, unknown>) => !("passwordHash" in user))).toBe(true);

    const change = await request(app)
      .patch(`/api/admin/users/${staffId!}/role`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ role: Role.CUSTOMER });
    expect(change.status).toBe(200);
    expect(change.body).toMatchObject({ id: staffId, role: Role.CUSTOMER, assignedCinemaId: null });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: staffId! } });
    expect(after.authVersion).toBe(before.authVersion + 1);
    expect(await prisma.auditLog.count({ where: { actorId: adminId!, action: "USER_ROLE_CHANGED", entityId: staffId! } })).toBe(1);

    const staleRoleToken = await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${staffToken}` });
    expect(staleRoleToken.status).toBe(401);
    expect(staleRoleToken.body.error).toBe("INVALID_TOKEN");
    const updatedToken = createToken({ id: staffId!, authVersion: after.authVersion });
    const updatedProfile = await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${updatedToken}` });
    expect(updatedProfile.status).toBe(200);
    expect(updatedProfile.body).toMatchObject({ role: Role.CUSTOMER, assignedCinemaId: null });
    const revokedAdminAccess = await request(app).get("/api/admin/users").set({ Authorization: `Bearer ${updatedToken}` });
    expect(revokedAdminAccess.status).toBe(403);
    expect(revokedAdminAccess.body.error).toBe("ROLE_FORBIDDEN");
  }, 30_000);
});
