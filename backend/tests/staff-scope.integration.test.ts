import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaimStatus, HoldStatus, OrderStatus, PaymentStatus, Prisma, RecordStatus, Role, SeatType } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const staffScopeDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

staffScopeDescribe("REQ-TICKET-03: staff cinema-scoped check-in", () => {
  const app = createApp();
  const fixture = randomUUID();
  const showtimeIds: string[] = [];
  const seatIds: string[] = [];
  const userIds: string[] = [];
  const ticketIds: string[] = [];
  let cinemaAId: string | undefined;
  let cinemaBId: string | undefined;
  let auditoriumAId: string | undefined;
  let auditoriumBId: string | undefined;
  let bufferAuditoriumId: string | undefined;
  let movieId: string | undefined;
  let buyerId: string | undefined;
  let staffAId: string | undefined;
  let unassignedStaffId: string | undefined;
  let adminId: string | undefined;
  let ticketA1: { id: string; qrToken: string };
  let ticketA2: { id: string; qrToken: string };
  let ticketA3: { id: string; qrToken: string };
  let ticketB1: { id: string; qrToken: string };
  let ticketB2: { id: string; qrToken: string };
  let ticketB3: { id: string; qrToken: string };
  let ticketB4: { id: string; qrToken: string };
  let staffAToken: string;
  let unassignedStaffToken: string;
  let adminToken: string;
  let buyerToken: string;

  beforeAll(async () => {
    await prisma.$connect();
    const cinemaA = await prisma.cinema.create({ data: { name: `Scope A ${fixture}`, city: "Test", address: "Scope fixture A" } });
    cinemaAId = cinemaA.id;
    const cinemaB = await prisma.cinema.create({ data: { name: `Scope B ${fixture}`, city: "Test", address: "Scope fixture B" } });
    cinemaBId = cinemaB.id;
    const auditoriumA = await prisma.auditorium.create({ data: { cinemaId: cinemaA.id, name: `Scope A room ${fixture}` } });
    auditoriumAId = auditoriumA.id;
    const auditoriumB = await prisma.auditorium.create({ data: { cinemaId: cinemaB.id, name: `Scope B room ${fixture}` } });
    auditoriumBId = auditoriumB.id;
    const bufferAuditorium = await prisma.auditorium.create({ data: { cinemaId: cinemaA.id, name: `Scope buffer room ${fixture}` } });
    bufferAuditoriumId = bufferAuditorium.id;
    const seatsA = await prisma.seat.createManyAndReturn({ data: [1, 2, 3].map((column) => ({ auditoriumId: auditoriumA.id, label: `A${column}`, row: "A", column, type: SeatType.STANDARD })) });
    const seatsB = await prisma.seat.createManyAndReturn({ data: [1, 2, 3, 4].map((column) => ({ auditoriumId: auditoriumB.id, label: `B${column}`, row: "B", column, type: SeatType.STANDARD })) });
    seatIds.push(...seatsA.map((seat) => seat.id), ...seatsB.map((seat) => seat.id));
    const movie = await prisma.movie.create({ data: { slug: `scope-${fixture}`, title: `Scope test ${fixture}`, genre: "Test", synopsis: "Isolated staff permission fixture.", runtimeMinutes: 90, ageRating: "P" } });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 365 * 86_400_000);
    const showtimeA = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditoriumA.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000 } });
    const showtimeB = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditoriumB.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000 } });
    const bufferStart = new Date(startAt.getTime() + 8 * 60 * 60_000);
    const bufferShowtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: bufferAuditorium.id, startAt: bufferStart, endAt: new Date(bufferStart.getTime() + 90 * 60_000), priceVnd: 100_000 } });
    showtimeIds.push(showtimeA.id, showtimeB.id, bufferShowtime.id);

    const buyer = await prisma.user.create({ data: { name: "Scope Buyer", email: `buyer-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    buyerId = buyer.id;
    buyerToken = createToken({ id: buyer.id, authVersion: buyer.authVersion });
    const staffA = await prisma.user.create({ data: { name: "Assigned Staff", email: `staff-a-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.STAFF, assignedCinemaId: cinemaA.id } });
    staffAId = staffA.id;
    const unassignedStaff = await prisma.user.create({ data: { name: "Unassigned Staff", email: `staff-none-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.STAFF } });
    unassignedStaffId = unassignedStaff.id;
    const admin = await prisma.user.create({ data: { name: "Scope Admin", email: `admin-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.ADMIN } });
    adminId = admin.id;
    userIds.push(buyer.id, staffA.id, unassignedStaff.id, admin.id);
    staffAToken = createToken({ id: staffA.id, authVersion: staffA.authVersion });
    unassignedStaffToken = createToken({ id: unassignedStaff.id, authVersion: unassignedStaff.authVersion });
    adminToken = createToken({ id: admin.id, authVersion: admin.authVersion });

    async function createTicket(showtimeId: string, seatId: string, suffix: string) {
      const expiresAt = new Date(Date.now() + 600_000);
      const hold = await prisma.seatHold.create({ data: { userId: buyer.id, showtimeId, status: HoldStatus.CONFIRMED, expiresAt } });
      const order = await prisma.cinemaOrder.create({ data: { userId: buyer.id, showtimeId, holdId: hold.id, totalVnd: 100_000, status: OrderStatus.CONFIRMED } });
      const claim = await prisma.seatClaim.create({ data: { showtimeId, seatId, holdId: hold.id, orderId: order.id, status: ClaimStatus.SOLD, priceVnd: 100_000 } });
      await prisma.payment.create({ data: { orderId: order.id, amountVnd: 100_000, status: PaymentStatus.SUCCEEDED } });
      const ticket = await prisma.ticket.create({ data: { orderId: order.id, seatClaimId: claim.id, qrToken: randomBytes(32).toString("base64url") } });
      ticketIds.push(ticket.id);
      return { id: ticket.id, qrToken: ticket.qrToken, suffix };
    }

    ticketA1 = await createTicket(showtimeA.id, seatsA[0]!.id, "a1");
    ticketA2 = await createTicket(showtimeA.id, seatsA[1]!.id, "a2");
    ticketA3 = await createTicket(showtimeA.id, seatsA[2]!.id, "a3");
    ticketB1 = await createTicket(showtimeB.id, seatsB[0]!.id, "b1");
    ticketB2 = await createTicket(showtimeB.id, seatsB[1]!.id, "b2");
    ticketB3 = await createTicket(showtimeB.id, seatsB[2]!.id, "b3");
    ticketB4 = await createTicket(showtimeB.id, seatsB[3]!.id, "b4");
  }, 30_000);

  afterAll(async () => {
    const orders = showtimeIds.length ? await prisma.cinemaOrder.findMany({ where: { showtimeId: { in: showtimeIds } }, select: { id: true } }) : [];
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length) {
      await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
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
    if (userIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    if (seatIds.length) await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
    if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
    if (auditoriumAId) await prisma.auditorium.deleteMany({ where: { id: auditoriumAId } });
    if (auditoriumBId) await prisma.auditorium.deleteMany({ where: { id: auditoriumBId } });
    if (bufferAuditoriumId) await prisma.auditorium.deleteMany({ where: { id: bufferAuditoriumId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (cinemaAId) await prisma.cinema.deleteMany({ where: { id: cinemaAId } });
    if (cinemaBId) await prisma.cinema.deleteMany({ where: { id: cinemaBId } });
    await prisma.$disconnect();
  }, 30_000);

  it("[TC-STAFF-01][TC-SEC-10][TC-SEC-12][TC-CAT-04][TC-AUTH-03] scopes both check-in routes, profile edits, and overlapping showtime changes", async () => {
    const staffAuth = { Authorization: `Bearer ${staffAToken}` };
    let unassignedAuth = { Authorization: `Bearer ${unassignedStaffToken}` };
    const adminAuth = { Authorization: `Bearer ${adminToken}` };
    const startAt = (await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeIds[0] }, select: { startAt: true } })).startAt;
    const overlapStart = new Date(startAt.getTime() + 90 * 60_000);
    const adjacentStart = new Date(startAt.getTime() + 110 * 60_000);

    const rejectedPost = await request(app).post("/api/admin/showtimes").set(adminAuth).send({ movieId, auditoriumId: auditoriumAId, startAt: overlapStart.toISOString(), priceVnd: 100_000 });
    expect(rejectedPost.status).toBe(409);
    expect(rejectedPost.body.error).toBe("SHOWTIME_OVERLAP");
    const adjacentPost = await request(app).post("/api/admin/showtimes").set(adminAuth).send({ movieId, auditoriumId: auditoriumAId, startAt: adjacentStart.toISOString(), priceVnd: 100_000 });
    expect(adjacentPost.status).toBe(201);
    showtimeIds.push(adjacentPost.body.id as string);

    const rejectedPatch = await request(app).patch(`/api/admin/showtimes/${showtimeIds[2]}`).set(adminAuth).send({ auditoriumId: auditoriumAId, startAt: overlapStart.toISOString() });
    expect(rejectedPatch.status).toBe(409);
    expect(rejectedPatch.body.error).toBe("SHOWTIME_OVERLAP");
    const separatedPatch = await request(app).patch(`/api/admin/showtimes/${showtimeIds[2]}`).set(adminAuth).send({ auditoriumId: auditoriumAId, startAt: new Date(startAt.getTime() + 5 * 60 * 60_000).toISOString() });
    expect(separatedPatch.status).toBe(200);

    const meResponse = await request(app).get("/api/auth/me").set(staffAuth);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.assignedCinemaId).toBe(cinemaAId);
    expect(meResponse.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
    const profileBeforeEmptyPatch = await prisma.user.findUniqueOrThrow({ where: { id: staffAId }, select: { name: true, email: true } });
    const profileAuditBeforeEmptyPatch = await prisma.auditLog.count({ where: { actorId: staffAId, action: "PROFILE_UPDATED" } });
    const emptyProfilePatch = await request(app).patch("/api/auth/me").set(staffAuth).send({});
    expect(emptyProfilePatch.status).toBe(422);
    expect(emptyProfilePatch.body.error).toBe("VALIDATION_ERROR");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: staffAId }, select: { name: true, email: true } })).toEqual(profileBeforeEmptyPatch);
    expect(await prisma.auditLog.count({ where: { actorId: staffAId, action: "PROFILE_UPDATED" } })).toBe(profileAuditBeforeEmptyPatch);
    const profilePatch = await request(app).patch("/api/auth/me").set(staffAuth).send({ name: "Updated Assigned Staff" });
    expect(profilePatch.status).toBe(200);
    expect(profilePatch.body.name).toBe("Updated Assigned Staff");
    expect(profilePatch.body.assignedCinemaId).toBe(cinemaAId);
    expect(profilePatch.body).not.toHaveProperty("passwordHash");
    expect(profilePatch.body).not.toHaveProperty("token");
    const profileAudit = await prisma.auditLog.findFirst({ where: { actorId: staffAId, action: "PROFILE_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(profileAudit?.metadata).toMatchObject({ correlationId: profilePatch.headers["x-request-id"] });
    const updatedEmail = `staff-updated-${fixture}@test.local`;
    const emailPatch = await request(app).patch("/api/auth/me").set(staffAuth).send({ email: updatedEmail });
    expect(emailPatch.status).toBe(200);
    expect(emailPatch.body.email).toBe(updatedEmail);
    expect(emailPatch.body.name).toBe("Updated Assigned Staff");
    expect((await request(app).get("/api/auth/me").set(staffAuth)).body.email).toBe(updatedEmail);
    const duplicateEmail = await request(app).patch("/api/auth/me").set(staffAuth).send({ email: `admin-${fixture}@test.local` });
    expect(duplicateEmail.status).toBe(409);

    const expectForbiddenWithoutCheckInSideEffects = async (
      actorId: string,
      token: string | undefined,
      ticket: { id: string; qrToken: string },
      route: "id" | "qr",
      expectedError: string
    ) => {
      const ticketBefore = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { id: true, orderId: true, checkedInAt: true } });
      const auditBefore = await prisma.auditLog.count({ where: { actorId, action: "TICKET_CHECKED_IN", entityId: ticket.id } });
      const pending = route === "id"
        ? request(app).post(`/api/tickets/${ticket.id}/check-in`)
        : request(app).post("/api/tickets/scan");
      const authorized = token ? pending.set({ Authorization: `Bearer ${token}` }) : pending;
      const response = route === "id"
        ? await authorized.send({})
        : await authorized.send({ qrToken: ticket.qrToken });
      expect(response.status, `${route} check-in for ${actorId}`).toBe(expectedError === "AUTH_REQUIRED" ? 401 : 403);
      expect(response.body.error).toBe(expectedError);
      expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { id: true, orderId: true, checkedInAt: true } })).toEqual(ticketBefore);
      expect(await prisma.auditLog.count({ where: { actorId, action: "TICKET_CHECKED_IN", entityId: ticket.id } })).toBe(auditBefore);
    };

    expect((await request(app).post(`/api/tickets/${ticketA1.id}/check-in`).set(staffAuth).send({})).status).toBe(200);
    await expectForbiddenWithoutCheckInSideEffects(staffAId!, staffAToken, ticketB1, "id", "CINEMA_FORBIDDEN");
    await expectForbiddenWithoutCheckInSideEffects(unassignedStaffId!, unassignedStaffToken, ticketA2, "id", "CINEMA_FORBIDDEN");
    await expectForbiddenWithoutCheckInSideEffects(unassignedStaffId!, unassignedStaffToken, ticketA3, "qr", "CINEMA_FORBIDDEN");
    await expectForbiddenWithoutCheckInSideEffects(staffAId!, staffAToken, ticketB2, "qr", "CINEMA_FORBIDDEN");
    await expectForbiddenWithoutCheckInSideEffects(buyerId!, buyerToken, ticketA3, "id", "ROLE_FORBIDDEN");
    await expectForbiddenWithoutCheckInSideEffects(buyerId!, buyerToken, ticketB2, "qr", "ROLE_FORBIDDEN");
    await expectForbiddenWithoutCheckInSideEffects("guest", undefined, ticketB1, "id", "AUTH_REQUIRED");
    await expectForbiddenWithoutCheckInSideEffects("guest", undefined, ticketA2, "qr", "AUTH_REQUIRED");

    const reassignment = await request(app).patch(`/api/admin/users/${staffAId}/assigned-cinema`).set(adminAuth).send({ cinemaId: cinemaBId });
    expect(reassignment.status).toBe(200);
    expect(reassignment.body.assignedCinemaId).toBe(cinemaBId);
    const staleReassignedStaffToken = await request(app).get("/api/auth/me").set(staffAuth);
    expect(staleReassignedStaffToken.status).toBe(401);
    expect(staleReassignedStaffToken.body.error).toBe("INVALID_TOKEN");
    const reassignedStaff = await prisma.user.findUniqueOrThrow({ where: { id: staffAId! }, select: { id: true, authVersion: true } });
    const reassignedStaffToken = createToken({ id: reassignedStaff.id, authVersion: reassignedStaff.authVersion });
    const reassignedStaffAuth = { Authorization: `Bearer ${reassignedStaffToken}` };
    expect((await request(app).get("/api/auth/me").set(reassignedStaffAuth)).body.assignedCinemaId).toBe(cinemaBId);
    await expectForbiddenWithoutCheckInSideEffects(staffAId!, reassignedStaffToken, ticketA2, "id", "CINEMA_FORBIDDEN");
    await expectForbiddenWithoutCheckInSideEffects(staffAId!, reassignedStaffToken, ticketA3, "qr", "CINEMA_FORBIDDEN");
    expect((await request(app).post(`/api/tickets/${ticketB3.id}/check-in`).set(reassignedStaffAuth).send({})).status).toBe(200);
    expect((await request(app).post("/api/tickets/scan").set(reassignedStaffAuth).send({ qrToken: ticketB4.qrToken })).status).toBe(200);
    const reassignmentCheckins = await prisma.auditLog.findMany({ where: { actorId: staffAId, action: "TICKET_CHECKED_IN", entityId: { in: [ticketB3.id, ticketB4.id] } }, select: { entityId: true } });
    expect(reassignmentCheckins.map((entry) => entry.entityId).sort()).toEqual([ticketB3.id, ticketB4.id].sort());
    for (const ticket of [ticketB3, ticketB4]) {
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { checkedInAt: true } })).checkedInAt).not.toBeNull();
    }

    const assigned = await request(app).patch(`/api/admin/users/${unassignedStaffId}/assigned-cinema`).set(adminAuth).send({ cinemaId: cinemaAId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.assignedCinemaId).toBe(cinemaAId);
    const staleAssignmentToken = await request(app).get("/api/auth/me").set(unassignedAuth);
    expect(staleAssignmentToken.status).toBe(401);
    expect(staleAssignmentToken.body.error).toBe("INVALID_TOKEN");
    const assignedStaff = await prisma.user.findUniqueOrThrow({ where: { id: unassignedStaffId! }, select: { id: true, authVersion: true } });
    unassignedStaffToken = createToken({ id: assignedStaff.id, authVersion: assignedStaff.authVersion });
    unassignedAuth = { Authorization: `Bearer ${unassignedStaffToken}` };
    expect((await request(app).get("/api/auth/me").set(unassignedAuth)).body.assignedCinemaId).toBe(cinemaAId);
    expect((await request(app).post("/api/tickets/scan").set(unassignedAuth).send({ qrToken: ticketA2.qrToken })).status).toBe(200);
    const unassignedAgain = await request(app).patch(`/api/admin/users/${unassignedStaffId}/assigned-cinema`).set(adminAuth).send({ cinemaId: null });
    expect(unassignedAgain.status).toBe(200);
    expect(unassignedAgain.body.assignedCinemaId).toBeNull();
    const staleUnassignmentToken = await request(app).get("/api/auth/me").set(unassignedAuth);
    expect(staleUnassignmentToken.status).toBe(401);
    expect(staleUnassignmentToken.body.error).toBe("INVALID_TOKEN");

    expect((await request(app).post(`/api/tickets/${ticketB1.id}/check-in`).set(adminAuth).send({})).status).toBe(200);
    expect((await request(app).post("/api/tickets/scan").set(adminAuth).send({ qrToken: ticketB2.qrToken })).status).toBe(200);
    expect((await request(app).post(`/api/tickets/${ticketA3.id}/check-in`).set(adminAuth).send({})).status).toBe(200);
    const checkedIn = await prisma.ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, checkedInAt: true } });
    expect(checkedIn.filter((ticket) => ticket.checkedInAt !== null)).toHaveLength(7);
    const staffCheckins = await prisma.auditLog.count({ where: { actorId: staffAId, action: "TICKET_CHECKED_IN" } });
    const newlyAssignedStaffCheckins = await prisma.auditLog.count({ where: { actorId: unassignedStaffId, action: "TICKET_CHECKED_IN" } });
    const adminCheckins = await prisma.auditLog.count({ where: { actorId: adminId, action: "TICKET_CHECKED_IN" } });
    expect(staffCheckins).toBe(3);
    expect(newlyAssignedStaffCheckins).toBe(1);
    expect(adminCheckins).toBe(3);
    expect(await prisma.auditLog.count({ where: { actorId: adminId, action: "STAFF_CINEMA_ASSIGNED" } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { actorId: staffAId, action: "PROFILE_UPDATED" } })).toBe(2);
  }, 60_000);
});
