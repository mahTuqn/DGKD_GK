import { randomBytes } from "node:crypto";
import { ClaimStatus, HoldStatus, OrderStatus, PaymentStatus, Prisma, RecordStatus, Role, SeatType } from "@prisma/client";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { z } from "zod";
import { createToken, hashPassword, requireAuth, requireRole, verifyPassword } from "./auth.js";
import { prisma } from "./db.js";
import { calculateFillRatePercent, calendarDateAtTime, computeSeatPrice, DomainError, formatBusinessDate, HOLD_TTL_SECONDS, isHoldActive, uniqueSeatIds } from "./domain/booking-policy.js";
import { mockPaymentPayloadHash, signMockPaymentEvent, verifyMockPaymentSignature, type MockPaymentEvent } from "./domain/mock-payment-signature.js";
import { enqueueOutboxEvent } from "./worker.js";

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  try { calendarDateAtTime(value, 0); return true; } catch { return false; }
}, "Ngày lịch không tồn tại.");
const apiContentSecurityPolicy = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; img-src 'self' data: https:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:4000 http://127.0.0.1:4000";
const staffRoles = [Role.STAFF, Role.ADMIN] as const;
const developmentMockPaymentSecret = "cinema-booking-local-mock-payment-secret-2026";
const publicMockPaymentSecrets = new Set([
  developmentMockPaymentSecret,
  "local-mock-webhook-secret-change-before-deployment-2026",
  "ci-only-webhook-secret"
]);
const mockPaymentEventSchema = z.object({
  eventId: z.string().trim().min(8).max(128),
  orderId: z.string().min(1),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  amountVnd: z.number().int().positive().max(100_000_000),
  currency: z.literal("VND")
}).strict();

function getMockPaymentSecret() {
  const configured = process.env.MOCK_PAYMENT_SECRET;
  const isLocalEnvironment = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  if (!isLocalEnvironment) {
    if (!configured) throw new Error("MOCK_PAYMENT_SECRET must be configured with at least 32 characters outside development and test.");
    if (publicMockPaymentSecrets.has(configured)) throw new Error("MOCK_PAYMENT_SECRET must not use a published development or CI value outside development and test.");
    if (configured.length < 32) throw new Error("MOCK_PAYMENT_SECRET must be configured with at least 32 characters outside development and test.");
    return configured;
  }
  return configured || developmentMockPaymentSecret;
}

function trustedProxyHops() {
  const configured = process.env.TRUST_PROXY_HOPS;
  if (configured === undefined || configured.trim() === "") return 0;
  if (!/^(0|[1-9]\d*)$/.test(configured)) throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
  const hops = Number(configured);
  if (!Number.isSafeInteger(hops)) throw new Error("TRUST_PROXY_HOPS must be a safe integer.");
  return hops;
}

export function assertMockPaymentConfiguration() {
  getMockPaymentSecret();
}

export function getRegistrationRateLimit(environment: { NODE_ENV?: string; E2E_REGISTRATION_RATE_LIMIT?: string } = process.env) {
  const secureDefault = 5;
  // E2E raises the local test server's ceiling so one browser suite can create
  // many isolated accounts. Production always keeps the lower abuse limit.
  if (environment.NODE_ENV === "production") return secureDefault;

  const configured = environment.E2E_REGISTRATION_RATE_LIMIT;
  if (configured === undefined || configured.trim() === "") return secureDefault;
  if (!/^[1-9]\d*$/.test(configured)) throw new Error("E2E_REGISTRATION_RATE_LIMIT must be a positive integer no greater than 1000 outside production.");
  const limit = Number(configured);
  if (!Number.isSafeInteger(limit) || limit > 1000) throw new Error("E2E_REGISTRATION_RATE_LIMIT must be a positive integer no greater than 1000 outside production.");
  return limit;
}

export async function applyMockPaymentEvent(event: MockPaymentEvent, actorId?: string, client: typeof prisma = prisma) {
  const payloadHash = mockPaymentPayloadHash(event);
  return client.$transaction(async (tx) => {
    const priorEvent = await tx.paymentEvent.findUnique({ where: { providerEventId: event.eventId } });
    if (priorEvent) {
      if (priorEvent.orderId !== event.orderId || priorEvent.payloadHash !== payloadHash) {
        throw new DomainError("PAYMENT_EVENT_REPLAY", "Mã sự kiện thanh toán đã được dùng cho dữ liệu khác.", 409);
      }
      return { orderId: event.orderId, outcome: priorEvent.outcome, idempotent: true };
    }

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "CinemaOrder" WHERE "id" = ${event.orderId} FOR UPDATE`);
    // Re-check after taking the order lock: concurrent deliveries of the same event
    // may both pass the optimistic lookup above before either transaction commits.
    const lockedPriorEvent = await tx.paymentEvent.findUnique({ where: { providerEventId: event.eventId } });
    if (lockedPriorEvent) {
      if (lockedPriorEvent.orderId !== event.orderId || lockedPriorEvent.payloadHash !== payloadHash) {
        throw new DomainError("PAYMENT_EVENT_REPLAY", "Mã sự kiện thanh toán đã được dùng cho dữ liệu khác.", 409);
      }
      return { orderId: event.orderId, outcome: lockedPriorEvent.outcome, idempotent: true };
    }
    const order = await tx.cinemaOrder.findUnique({ where: { id: event.orderId }, include: { hold: true, claims: true } });
    if (!order) throw new DomainError("ORDER_NOT_FOUND", "Không tìm thấy đơn đặt vé.", 404);
    if (order.totalVnd !== event.amountVnd || event.currency !== "VND") {
      throw new DomainError("PAYMENT_AMOUNT_MISMATCH", "Số tiền hoặc đơn vị tiền tệ không khớp với đơn hàng.", 422);
    }
    if (order.status === OrderStatus.CONFIRMED && event.status === "SUCCEEDED") {
      await tx.paymentEvent.create({ data: { providerEventId: event.eventId, orderId: order.id, status: PaymentStatus.SUCCEEDED, amountVnd: event.amountVnd, currency: event.currency, payloadHash, outcome: "CONFIRMED" } });
      return { orderId: order.id, outcome: "CONFIRMED", idempotent: true };
    }
    if (order.status === OrderStatus.EXPIRED) {
      const reconciliationRequired = event.status === "SUCCEEDED";
      const paymentStatus = reconciliationRequired ? PaymentStatus.RECONCILIATION_REQUIRED : PaymentStatus.FAILED;
      await tx.payment.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, providerEventId: event.eventId, amountVnd: order.totalVnd, status: paymentStatus },
        update: { providerEventId: event.eventId, amountVnd: order.totalVnd, status: paymentStatus }
      });
      await tx.paymentEvent.create({ data: { providerEventId: event.eventId, orderId: order.id, status: event.status === "SUCCEEDED" ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED, amountVnd: event.amountVnd, currency: event.currency, payloadHash, outcome: "EXPIRED" } });
      if (reconciliationRequired) {
        await enqueueOutboxEvent(tx, {
          eventKey: `payment-reconciliation:${event.eventId}`,
          eventType: "PAYMENT_RECONCILIATION_REQUIRED",
          aggregateId: order.id,
          payload: { providerEventId: event.eventId, orderId: order.id, amountVnd: event.amountVnd, currency: event.currency, reason: "PAYMENT_AFTER_EXPIRY" }
        });
      }
      await audit(tx, actorId, "PAYMENT_EVENT_EXPIRED", "CinemaOrder", order.id, { providerEventId: event.eventId, amountVnd: event.amountVnd, reconciliationRequired });
      return { orderId: order.id, outcome: "EXPIRED", idempotent: false };
    }
    if (order.status !== OrderStatus.PAYMENT_PENDING) throw new DomainError("INVALID_ORDER_STATE", "Đơn hàng không còn chờ thanh toán.", 409);

    const now = new Date();
    const stillHeld = order.hold.status === HoldStatus.PAYMENT_PENDING && isHoldActive(order.hold.expiresAt, now) && order.claims.length > 0 && order.claims.every((claim) => claim.status === ClaimStatus.HELD && claim.expiresAt && isHoldActive(claim.expiresAt, now));
    if (!stillHeld) {
      await tx.cinemaOrder.update({ where: { id: order.id }, data: { status: OrderStatus.EXPIRED } });
      await tx.seatHold.update({ where: { id: order.holdId }, data: { status: HoldStatus.EXPIRED } });
      await tx.seatClaim.updateMany({ where: { orderId: order.id, status: ClaimStatus.HELD }, data: { status: ClaimStatus.EXPIRED, holdId: null, orderId: null, expiresAt: null } });
      const reconciliationRequired = event.status === "SUCCEEDED";
      await tx.payment.upsert({ where: { orderId: order.id }, create: { orderId: order.id, providerEventId: event.eventId, amountVnd: order.totalVnd, status: reconciliationRequired ? PaymentStatus.RECONCILIATION_REQUIRED : PaymentStatus.FAILED }, update: { providerEventId: event.eventId, amountVnd: order.totalVnd, status: reconciliationRequired ? PaymentStatus.RECONCILIATION_REQUIRED : PaymentStatus.FAILED } });
      await tx.paymentEvent.create({ data: { providerEventId: event.eventId, orderId: order.id, status: event.status === "SUCCEEDED" ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED, amountVnd: event.amountVnd, currency: event.currency, payloadHash, outcome: "EXPIRED" } });
      if (reconciliationRequired) {
        await enqueueOutboxEvent(tx, {
          eventKey: `payment-reconciliation:${event.eventId}`,
          eventType: "PAYMENT_RECONCILIATION_REQUIRED",
          aggregateId: order.id,
          payload: { providerEventId: event.eventId, orderId: order.id, amountVnd: event.amountVnd, currency: event.currency, reason: "PAYMENT_AFTER_EXPIRY" }
        });
      }
      await audit(tx, actorId, "PAYMENT_EVENT_EXPIRED", "CinemaOrder", order.id, { providerEventId: event.eventId, amountVnd: event.amountVnd, reconciliationRequired });
      return { orderId: order.id, outcome: "EXPIRED", idempotent: false };
    }

    if (event.status === "FAILED") {
      await tx.cinemaOrder.update({ where: { id: order.id }, data: { status: OrderStatus.PAYMENT_FAILED } });
      await tx.seatHold.update({ where: { id: order.holdId }, data: { status: HoldStatus.RELEASED } });
      await tx.seatClaim.updateMany({ where: { orderId: order.id, status: ClaimStatus.HELD }, data: { status: ClaimStatus.RELEASED, holdId: null, orderId: null, expiresAt: null } });
      await tx.payment.upsert({ where: { orderId: order.id }, create: { orderId: order.id, providerEventId: event.eventId, amountVnd: order.totalVnd, status: PaymentStatus.FAILED }, update: { providerEventId: event.eventId, status: PaymentStatus.FAILED } });
      await tx.paymentEvent.create({ data: { providerEventId: event.eventId, orderId: order.id, status: PaymentStatus.FAILED, amountVnd: event.amountVnd, currency: event.currency, payloadHash, outcome: "FAILED" } });
      await audit(tx, actorId, "PAYMENT_FAILED", "CinemaOrder", order.id, { providerEventId: event.eventId, amountVnd: order.totalVnd });
      return { orderId: order.id, outcome: "FAILED", idempotent: false };
    }

    await tx.payment.upsert({ where: { orderId: order.id }, create: { orderId: order.id, providerEventId: event.eventId, amountVnd: order.totalVnd, status: PaymentStatus.SUCCEEDED }, update: { providerEventId: event.eventId, amountVnd: order.totalVnd, status: PaymentStatus.SUCCEEDED } });
    await tx.cinemaOrder.update({ where: { id: order.id }, data: { status: OrderStatus.CONFIRMED } });
    await tx.seatHold.update({ where: { id: order.holdId }, data: { status: HoldStatus.CONFIRMED } });
    await tx.seatClaim.updateMany({ where: { orderId: order.id, status: ClaimStatus.HELD }, data: { status: ClaimStatus.SOLD, expiresAt: null } });
    for (const claim of order.claims) {
      await tx.ticket.upsert({ where: { seatClaimId: claim.id }, create: { orderId: order.id, seatClaimId: claim.id, qrToken: randomBytes(32).toString("base64url") }, update: {} });
    }
    await tx.paymentEvent.create({ data: { providerEventId: event.eventId, orderId: order.id, status: PaymentStatus.SUCCEEDED, amountVnd: event.amountVnd, currency: event.currency, payloadHash, outcome: "CONFIRMED" } });
    await audit(tx, actorId, "PAYMENT_CONFIRMED", "CinemaOrder", order.id, { providerEventId: event.eventId, amountVnd: order.totalVnd, provider: "MOCK" });
    return { orderId: order.id, outcome: "CONFIRMED", idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function audit(client: Prisma.TransactionClient, actorId: string | undefined, action: string, entity: string, entityId: string, metadata?: Prisma.InputJsonValue) {
  return client.auditLog.create({ data: { actorId, action, entity, entityId, metadata } });
}

function assertStaffCinemaScope(user: NonNullable<express.Request["user"]>, ticketCinemaId: string) {
  if (user.role === Role.STAFF && user.assignedCinemaId !== ticketCinemaId) {
    throw new DomainError("CINEMA_FORBIDDEN", "Nhân viên chỉ được soát vé tại rạp được phân công.", 403);
  }
}

function toMovie(movie: { id: string; title: string; slug: string; genre: string; synopsis: string; runtimeMinutes: number; ageRating: string; posterUrl: string | null; releaseDate: Date | null }) {
  return { id: movie.id, title: movie.title, slug: movie.slug, genre: movie.genre, synopsis: movie.synopsis, runtimeMinutes: movie.runtimeMinutes, ageRating: movie.ageRating, posterUrl: movie.posterUrl, releaseDate: movie.releaseDate?.toISOString().slice(0, 10) ?? null };
}

function toShowtime(showtime: { id: string; movieId: string; startAt: Date; endAt: Date; priceVnd: number; premiumSurchargeVnd: number; status: RecordStatus; auditorium: { name: string; screenType: string; cinema: { id: string; name: string; city: string } }; movie: { title: string } }) {
  return {
    id: showtime.id,
    movieId: showtime.movieId,
    movieTitle: showtime.movie.title,
    cinemaId: showtime.auditorium.cinema.id,
    cinemaName: showtime.auditorium.cinema.name,
    city: showtime.auditorium.cinema.city,
    auditoriumName: showtime.auditorium.name,
    startAt: showtime.startAt.toISOString(),
    endAt: showtime.endAt.toISOString(),
    date: formatBusinessDate(showtime.startAt),
    priceVnd: showtime.priceVnd,
    premiumSurchargeVnd: showtime.premiumSurchargeVnd,
    status: showtime.status,
    screenType: showtime.auditorium.screenType
  };
}

async function getOccupancy(periodStart: Date, periodEnd?: Date) {
  const showtimes = await prisma.showtime.findMany({
    where: { status: RecordStatus.ACTIVE, startAt: { gte: periodStart, ...(periodEnd ? { lt: periodEnd } : {}) } },
    select: { id: true, auditorium: { select: { _count: { select: { seats: true } } } } }
  });
  const capacitySeats = showtimes.reduce((sum, showtime) => sum + showtime.auditorium._count.seats, 0);
  const soldSeats = showtimes.length === 0 ? 0 : await prisma.seatClaim.count({ where: { showtimeId: { in: showtimes.map((showtime) => showtime.id) }, status: ClaimStatus.SOLD } });
  return {
    showtimeCount: showtimes.length,
    soldSeats,
    capacitySeats,
    fillRatePercent: calculateFillRatePercent(soldSeats, capacitySeats),
    definition: "Tử số là số ghế SeatClaim SOLD; mẫu số là tổng số ghế của từng suất ACTIVE trong khoảng [periodStart, periodEnd). Tỉ lệ = tử số / mẫu số; mặc định chỉ tính suất chưa bắt đầu."
  };
}

function toOrder(order: Prisma.CinemaOrderGetPayload<{ include: { showtime: { include: { movie: true; auditorium: { include: { cinema: true } } } }; claims: { include: { seat: true } }; tickets: true } }>) {
  return {
    id: order.id,
    status: order.status,
    totalVnd: order.totalVnd,
    createdAt: order.createdAt.toISOString(),
    showtime: toShowtime({ ...order.showtime, auditorium: { ...order.showtime.auditorium, cinema: order.showtime.auditorium.cinema } }),
    seats: order.claims.map((claim) => ({ seatId: claim.seatId, label: claim.seat.label, row: claim.seat.row, column: claim.seat.column, type: claim.seat.type, priceVnd: claim.priceVnd })),
    tickets: order.tickets.map((ticket) => ({ id: ticket.id, qrToken: ticket.qrToken, checkedInAt: ticket.checkedInAt?.toISOString() ?? null }))
  };
}

export function createApp() {
  const app = express();
  // Trust only the configured number of proxy hops. Compose sets one because
  // the API receives public requests through the Nginx web container.
  app.set("trust proxy", trustedProxyHops());
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", apiContentSecurityPolicy);
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((item) => item.trim()).filter(Boolean);
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
  app.use(express.json({ limit: "64kb" }));
  app.use(morgan("tiny"));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => res.status(429).json({ error: "AUTH_RATE_LIMITED", message: "Có quá nhiều lần đăng nhập không thành công. Vui lòng thử lại sau." })
  });
  const registrationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: getRegistrationRateLimit(),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: "REGISTRATION_RATE_LIMITED", message: "Có quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau." })
  });

  app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "cinema-booking-api" }));

  app.post("/api/auth/register", registrationLimiter, asyncRoute(async (req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), password: z.string().min(8).max(72) }).strict().parse(req.body);
    let user;
    try {
      user = await prisma.user.create({ data: { name: input.name, email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password) }, select: { id: true, name: true, email: true, role: true, assignedCinemaId: true, authVersion: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "EMAIL_TAKEN", message: "Email này đã được đăng ký." });
      }
      throw error;
    }
    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, assignedCinemaId: user.assignedCinemaId };
    res.status(201).json({ token: createToken({ id: user.id, authVersion: user.authVersion }), user: publicUser });
  }));

  app.post("/api/auth/login", loginLimiter, asyncRoute(async (req, res) => {
    const input = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(72) }).strict().parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Email hoặc mật khẩu không chính xác." });
    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, assignedCinemaId: user.assignedCinemaId };
    res.json({ token: createToken({ id: user.id, authVersion: user.authVersion }), user: publicUser });
  }));

  app.get("/api/auth/me", requireAuth, (req, res) => res.json(req.user));

  app.patch("/api/auth/me", requireAuth, asyncRoute(async (req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254) }).partial().strict()
      .refine((value) => Object.keys(value).length > 0, "Cần ít nhất một trường để cập nhật.").parse(req.body);
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: req.user!.id },
        data: { ...input, ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}) },
        select: { id: true, name: true, email: true, role: true, assignedCinemaId: true }
      });
      await audit(tx, req.user!.id, "PROFILE_UPDATED", "User", updated.id, { changedFields: Object.keys(input) });
      return updated;
    });
    res.json(user);
  }));

  app.get("/api/movies", asyncRoute(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const movies = await prisma.movie.findMany({
      where: { status: RecordStatus.ACTIVE, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { genre: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: [{ releaseDate: "desc" }, { title: "asc" }]
    });
    res.json(movies.map(toMovie));
  }));

  app.get("/api/cinemas", asyncRoute(async (_req, res) => {
    res.json(await prisma.cinema.findMany({ where: { status: RecordStatus.ACTIVE }, include: { _count: { select: { auditoriums: true } } }, orderBy: [{ city: "asc" }, { name: "asc" }] }));
  }));

  app.get("/api/showtimes", asyncRoute(async (req, res) => {
    const date = businessDateSchema.parse(req.query.date ?? formatBusinessDate(new Date()));
    const start = calendarDateAtTime(date, 0);
    const end = calendarDateAtTime(date, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    const movieId = typeof req.query.movieId === "string" ? req.query.movieId : undefined;
    const cinemaId = typeof req.query.cinemaId === "string" ? req.query.cinemaId : undefined;
    const showtimes = await prisma.showtime.findMany({
      where: {
        status: RecordStatus.ACTIVE,
        startAt: { gte: start, lt: end },
        movie: { status: RecordStatus.ACTIVE },
        auditorium: { cinema: { status: RecordStatus.ACTIVE, ...(cinemaId ? { id: cinemaId } : {}) } },
        ...(movieId ? { movieId } : {})
      },
      include: { movie: true, auditorium: { include: { cinema: true } } },
      orderBy: { startAt: "asc" }
    });
    res.json(showtimes.map(toShowtime));
  }));

  app.get("/api/showtimes/:id/seats", asyncRoute(async (req, res) => {
    const showtime = await prisma.showtime.findFirst({
      where: { id: String(req.params.id), status: RecordStatus.ACTIVE, movie: { status: RecordStatus.ACTIVE }, auditorium: { cinema: { status: RecordStatus.ACTIVE } } },
      include: { movie: true, auditorium: { include: { cinema: true, seats: { orderBy: [{ row: "asc" }, { column: "asc" }] } } }, claims: true }
    });
    if (!showtime) throw new DomainError("SHOWTIME_NOT_FOUND", "Không tìm thấy suất chiếu.", 404);
    const claims = new Map(showtime.claims.map((claim) => [`${claim.seatId}`, claim]));
    const now = new Date();
    res.json({
      showtime: toShowtime({ ...showtime, auditorium: { ...showtime.auditorium, cinema: showtime.auditorium.cinema } }),
      seats: showtime.auditorium.seats.map((seat) => {
        const claim = claims.get(seat.id);
        const isHeld = claim?.status === ClaimStatus.HELD && Boolean(claim.expiresAt && isHoldActive(claim.expiresAt, now));
        const status = claim?.status === ClaimStatus.SOLD ? "SOLD" : isHeld ? "HELD" : "AVAILABLE";
        return { id: seat.id, label: seat.label, row: seat.row, column: seat.column, type: seat.type, isAccessible: seat.isAccessible, status, priceVnd: computeSeatPrice(showtime.priceVnd, showtime.premiumSurchargeVnd, seat.type) };
      })
    });
  }));

  app.post("/api/holds", requireAuth, requireRole(Role.CUSTOMER), asyncRoute(async (req, res) => {
    const input = z.object({ showtimeId: z.string().min(1), seatIds: z.array(z.string().min(1)).min(1).max(8) }).strict().parse(req.body);
    const seatIds = uniqueSeatIds(input.seatIds);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + HOLD_TTL_SECONDS * 1000);
    const hold = await prisma.$transaction(async (tx) => {
      const showtime = await tx.showtime.findFirst({ where: { id: input.showtimeId, status: RecordStatus.ACTIVE, startAt: { gt: now }, movie: { status: RecordStatus.ACTIVE }, auditorium: { cinema: { status: RecordStatus.ACTIVE } } }, include: { auditorium: { include: { seats: { where: { id: { in: seatIds } } } } } } });
      if (!showtime) throw new DomainError("SHOWTIME_UNAVAILABLE", "Suất chiếu không còn mở bán.", 404);
      if (showtime.auditorium.seats.length !== seatIds.length) throw new DomainError("SEAT_NOT_FOUND", "Một hoặc nhiều ghế không thuộc phòng chiếu này.", 422);

      // Lock existing claims. A concurrent first insert is still protected by the composite unique constraint.
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "SeatClaim" WHERE "showtimeId" = ${input.showtimeId} AND "seatId" IN (${Prisma.join(seatIds)}) FOR UPDATE`);
      const existing = await tx.seatClaim.findMany({ where: { showtimeId: input.showtimeId, seatId: { in: seatIds } } });
      const bySeat = new Map(existing.map((claim) => [claim.seatId, claim]));
      for (const claim of existing) {
        if (claim.status === ClaimStatus.SOLD || (claim.status === ClaimStatus.HELD && claim.expiresAt && isHoldActive(claim.expiresAt, now))) {
          throw new DomainError("SEAT_CONFLICT", "Một hoặc nhiều ghế vừa được người khác giữ. Vui lòng chọn lại.", 409);
        }
      }
      const userActiveHold = await tx.seatHold.findFirst({ where: { userId: req.user!.id, status: HoldStatus.HELD, expiresAt: { gt: now } } });
      if (userActiveHold) throw new DomainError("ACTIVE_HOLD_EXISTS", "Bạn đang có lượt giữ ghế chưa hoàn tất.", 409);

      const createdHold = await tx.seatHold.create({ data: { userId: req.user!.id, showtimeId: input.showtimeId, expiresAt } });
      let totalVnd = 0;
      const seatById = new Map(showtime.auditorium.seats.map((seat) => [seat.id, seat]));
      for (const seatId of seatIds) {
        const seat = seatById.get(seatId)!;
        const priceVnd = computeSeatPrice(showtime.priceVnd, showtime.premiumSurchargeVnd, seat.type);
        totalVnd += priceVnd;
        const prior = bySeat.get(seatId);
        const data = { holdId: createdHold.id, orderId: null, status: ClaimStatus.HELD, expiresAt, priceVnd };
        if (prior) await tx.seatClaim.update({ where: { id: prior.id }, data });
        else await tx.seatClaim.create({ data: { showtimeId: input.showtimeId, seatId, ...data } });
      }
      await audit(tx, req.user!.id, "SEATS_HELD", "SeatHold", createdHold.id, { showtimeId: input.showtimeId, seatIds, totalVnd });
      return { id: createdHold.id, showtimeId: createdHold.showtimeId, seatIds, expiresAt: createdHold.expiresAt.toISOString(), totalVnd, status: createdHold.status };
    });
    res.status(201).json(hold);
  }));

  app.post("/api/orders", requireAuth, requireRole(Role.CUSTOMER), asyncRoute(async (req, res) => {
    const { holdId } = z.object({ holdId: z.string().min(1) }).strict().parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "SeatHold" WHERE "id" = ${holdId} FOR UPDATE`);
      const hold = await tx.seatHold.findFirst({ where: { id: holdId, userId: req.user!.id }, include: { order: true, claims: { include: { seat: true } } } });
      if (!hold) throw new DomainError("HOLD_NOT_FOUND", "Không tìm thấy lượt giữ ghế.", 404);
      if (hold.order) return { order: await getOrderForResponse(tx, hold.order.id), expired: false };
      const now = new Date();
      if (hold.status !== HoldStatus.HELD || !isHoldActive(hold.expiresAt, now)) {
        await tx.seatHold.update({ where: { id: hold.id }, data: { status: HoldStatus.EXPIRED } });
        await tx.seatClaim.updateMany({ where: { holdId: hold.id, status: ClaimStatus.HELD }, data: { status: ClaimStatus.EXPIRED, holdId: null, expiresAt: null } });
        return { order: null, expired: true };
      }
      const showtime = await tx.showtime.findUniqueOrThrow({ where: { id: hold.showtimeId }, include: { movie: true, auditorium: { include: { cinema: true } } } });
      const totalVnd = hold.claims.reduce((sum, claim) => sum + claim.priceVnd, 0);
      const created = await tx.cinemaOrder.create({ data: { userId: req.user!.id, showtimeId: hold.showtimeId, holdId: hold.id, totalVnd, status: OrderStatus.PAYMENT_PENDING } });
      await tx.seatHold.update({ where: { id: hold.id }, data: { status: HoldStatus.PAYMENT_PENDING } });
      await tx.seatClaim.updateMany({ where: { holdId: hold.id, status: ClaimStatus.HELD }, data: { orderId: created.id } });
      await audit(tx, req.user!.id, "ORDER_CREATED", "CinemaOrder", created.id, { totalVnd, seatCount: hold.claims.length });
      return { order: await getOrderForResponse(tx, created.id), expired: false };
    });
    if (result.expired || !result.order) throw new DomainError("HOLD_EXPIRED", "Thời gian giữ ghế đã kết thúc. Hãy chọn lại ghế.", 409);
    res.status(201).json(result.order);
  }));

  app.post("/api/payments/mock/webhook", asyncRoute(async (req, res) => {
    const event = mockPaymentEventSchema.parse(req.body) as MockPaymentEvent;
    if (!verifyMockPaymentSignature(event, req.header("x-mock-signature"), getMockPaymentSecret())) {
      throw new DomainError("INVALID_WEBHOOK_SIGNATURE", "Chữ ký callback thanh toán không hợp lệ.", 401);
    }
    const result = await applyMockPaymentEvent(event);
    if (result.outcome === "EXPIRED") throw new DomainError("PAYMENT_TOO_LATE", "Đơn đã hết thời gian giữ ghế; callback không phát vé.", 409);
    if (result.outcome === "FAILED") throw new DomainError("PAYMENT_FAILED", "Thanh toán mô phỏng thất bại. Ghế đã được giải phóng.", 402);
    const order = await getOrderForResponse(prisma, result.orderId);
    res.json({ accepted: true, idempotent: result.idempotent, orderId: order.id, status: order.status, totalVnd: order.totalVnd, tickets: order.tickets });
  }));

  app.post("/api/payments/mock/complete", requireAuth, requireRole(Role.CUSTOMER), asyncRoute(async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError("MOCK_PAYMENT_DISABLED", "Thanh toán mô phỏng không khả dụng trong production.", 404);
    }
    const input = z.object({ orderId: z.string().min(1), outcome: z.enum(["SUCCEEDED", "FAILED"]).default("SUCCEEDED") }).strict().parse(req.body);
    const ownedOrder = await prisma.cinemaOrder.findFirst({ where: { id: input.orderId, userId: req.user!.id }, select: { id: true, totalVnd: true } });
    if (!ownedOrder) throw new DomainError("ORDER_NOT_FOUND", "Không tìm thấy đơn đặt vé.", 404);
    const event: MockPaymentEvent = {
      eventId: `mock-${ownedOrder.id}-${input.outcome.toLowerCase()}`,
      orderId: ownedOrder.id,
      status: input.outcome,
      amountVnd: ownedOrder.totalVnd,
      currency: "VND"
    };
    const signature = signMockPaymentEvent(event, getMockPaymentSecret());
    if (!verifyMockPaymentSignature(event, signature, getMockPaymentSecret())) throw new DomainError("INVALID_WEBHOOK_SIGNATURE", "Chữ ký callback thanh toán không hợp lệ.", 401);
    const result = await applyMockPaymentEvent(event, req.user!.id);
    if (result.outcome === "EXPIRED") throw new DomainError("PAYMENT_TOO_LATE", "Đơn đã hết thời gian giữ ghế; callback không phát vé.", 409);
    if (result.outcome === "FAILED") throw new DomainError("PAYMENT_FAILED", "Thanh toán mô phỏng thất bại. Ghế đã được giải phóng.", 402);
    const order = await getOrderForResponse(prisma, result.orderId);
    res.json({ orderId: order.id, status: order.status, totalVnd: order.totalVnd, tickets: order.tickets });
  }));

  app.get("/api/orders/me", requireAuth, requireRole(Role.CUSTOMER), asyncRoute(async (req, res) => {
    const orders = await prisma.cinemaOrder.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
    res.json(await Promise.all(orders.map((order) => getOrderForResponse(prisma, order.id))));
  }));

  app.get("/api/orders/:id", requireAuth, requireRole(Role.CUSTOMER), asyncRoute(async (req, res) => {
    const order = await prisma.cinemaOrder.findFirst({ where: { id: String(req.params.id), userId: req.user!.id }, select: { id: true } });
    if (!order) throw new DomainError("ORDER_NOT_FOUND", "Không tìm thấy đơn đặt vé.", 404);
    res.json(await getOrderForResponse(prisma, order.id));
  }));

  app.post("/api/tickets/:ticketId/check-in", requireAuth, requireRole(...staffRoles), asyncRoute(async (req, res) => {
    const ticketId = String(req.params.ticketId);
    const checkedIn = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`);
      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: {
          order: { include: { showtime: { include: { movie: true, auditorium: { include: { cinema: true } } } } } },
          seatClaim: { include: { seat: true } }
        }
      });
      if (!ticket) throw new DomainError("TICKET_NOT_FOUND", "Không tìm thấy vé.", 404);
      assertStaffCinemaScope(req.user!, ticket.order.showtime.auditorium.cinema.id);
      if (ticket.order.status !== OrderStatus.CONFIRMED) throw new DomainError("TICKET_NOT_VALID", "Vé chưa được thanh toán hoặc không còn hiệu lực.", 422);
      if (ticket.checkedInAt) throw new DomainError("TICKET_ALREADY_USED", "Vé này đã được sử dụng.", 409);
      const now = new Date();
      const update = await tx.ticket.updateMany({ where: { id: ticket.id, checkedInAt: null }, data: { checkedInAt: now } });
      if (update.count !== 1) throw new DomainError("TICKET_ALREADY_USED", "Vé này đã được sử dụng.", 409);
      await audit(tx, req.user!.id, "TICKET_CHECKED_IN", "Ticket", ticket.id, { orderId: ticket.orderId, seat: ticket.seatClaim.seat.label });
      return { ticketId: ticket.id, checkedInAt: now.toISOString(), seat: ticket.seatClaim.seat.label, movieTitle: ticket.order.showtime.movie.title, cinemaName: ticket.order.showtime.auditorium.cinema.name };
    });
    res.json(checkedIn);
  }));

  app.post("/api/tickets/scan", requireAuth, requireRole(...staffRoles), asyncRoute(async (req, res) => {
    const { qrToken } = z.object({ qrToken: z.string().min(20).max(128) }).strict().parse(req.body);
    const ticket = await prisma.ticket.findUnique({ where: { qrToken }, select: { id: true } });
    if (!ticket) throw new DomainError("TICKET_NOT_FOUND", "Mã vé không hợp lệ.", 404);
    req.params.ticketId = ticket.id;
    const ticketId = ticket.id;
    const checkedIn = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`);
      const current = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: {
          order: { include: { showtime: { include: { movie: true, auditorium: { include: { cinema: true } } } } } },
          seatClaim: { include: { seat: true } }
        }
      });
      if (!current) throw new DomainError("TICKET_NOT_FOUND", "Không tìm thấy vé.", 404);
      assertStaffCinemaScope(req.user!, current.order.showtime.auditorium.cinema.id);
      if (current.order.status !== OrderStatus.CONFIRMED) throw new DomainError("TICKET_NOT_VALID", "Vé chưa được thanh toán hoặc không còn hiệu lực.", 422);
      if (current.checkedInAt) throw new DomainError("TICKET_ALREADY_USED", "Vé này đã được sử dụng.", 409);
      const now = new Date();
      await tx.ticket.update({ where: { id: current.id }, data: { checkedInAt: now } });
      await audit(tx, req.user!.id, "TICKET_CHECKED_IN", "Ticket", current.id, { orderId: current.orderId, seat: current.seatClaim.seat.label });
      return { ticketId: current.id, checkedInAt: now.toISOString(), seat: current.seatClaim.seat.label, movieTitle: current.order.showtime.movie.title, cinemaName: current.order.showtime.auditorium.cinema.name };
    });
    res.json(checkedIn);
  }));

  app.get("/api/admin/summary", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
    const now = new Date();
    const [movies, showtimes, orders, tickets, revenue, occupancy] = await Promise.all([
      prisma.movie.count(), prisma.showtime.count(), prisma.cinemaOrder.count(), prisma.ticket.count(),
      prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED }, _sum: { amountVnd: true } }),
      getOccupancy(now)
    ]);
    res.json({ movies, showtimes, orders, tickets, confirmedRevenueVnd: revenue._sum.amountVnd ?? 0, occupancy: { ...occupancy, periodStart: now.toISOString(), periodEnd: null } });
  }));

  app.get("/api/admin/reports/occupancy", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const range = z.object({ from: businessDateSchema.optional(), to: businessDateSchema.optional() }).strict().refine((value) => Boolean(value.from) === Boolean(value.to), "Cần truyền đồng thời from và to.").parse(req.query);
    if (range.from && range.to && range.from > range.to) throw new DomainError("INVALID_DATE_RANGE", "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.", 422);
    const start = range.from ? calendarDateAtTime(range.from, 0) : new Date();
    let end: Date | undefined;
    if (range.to) {
      end = calendarDateAtTime(range.to, 0);
      end.setUTCDate(end.getUTCDate() + 1);
    }
    res.json({ ...(await getOccupancy(start, end)), periodStart: start.toISOString(), periodEnd: end?.toISOString() ?? null });
  }));

  app.get("/api/admin/cinemas", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
    const cinemas = await prisma.cinema.findMany({
      include: { auditoriums: { include: { _count: { select: { seats: true } } } } },
      orderBy: [{ city: "asc" }, { name: "asc" }]
    });
    res.json(cinemas.map((cinema) => ({
      id: cinema.id,
      name: cinema.name,
      city: cinema.city,
      address: cinema.address,
      status: cinema.status,
      auditoriums: cinema.auditoriums.map((auditorium) => ({ id: auditorium.id, name: auditorium.name, screenType: auditorium.screenType, seatCount: auditorium._count.seats }))
    })));
  }));

  app.post("/api/admin/cinemas", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(120), city: z.string().trim().min(2).max(120), address: z.string().trim().min(5).max(300) }).strict().parse(req.body);
    const cinema = await prisma.$transaction(async (tx) => {
      const created = await tx.cinema.create({ data: input });
      await audit(tx, req.user!.id, "CINEMA_CREATED", "Cinema", created.id, { name: created.name, city: created.city });
      return created;
    });
    res.status(201).json(cinema);
  }));

  app.patch("/api/admin/cinemas/:id", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      city: z.string().trim().min(2).max(120),
      address: z.string().trim().min(5).max(300),
      status: z.nativeEnum(RecordStatus)
    }).partial().strict().refine((value) => Object.keys(value).length > 0, "Cần ít nhất một trường để cập nhật.").parse(req.body);
    const cinema = await prisma.$transaction(async (tx) => {
      const updated = await tx.cinema.update({ where: { id: String(req.params.id) }, data: input });
      await audit(tx, req.user!.id, "CINEMA_UPDATED", "Cinema", updated.id, { changedFields: Object.keys(input) });
      return updated;
    });
    res.json(cinema);
  }));

  app.get("/api/admin/movies", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
    res.json((await prisma.movie.findMany({ orderBy: { createdAt: "desc" } })).map(toMovie));
  }));

  app.post("/api/admin/movies", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({ title: z.string().trim().min(2).max(160), slug: z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), genre: z.string().trim().min(2).max(80), synopsis: z.string().trim().min(10).max(3000), runtimeMinutes: z.number().int().min(30).max(300), ageRating: z.string().trim().min(1).max(12), posterUrl: z.string().url().optional(), releaseDate: businessDateSchema.optional() }).strict().parse(req.body);
    const movie = await prisma.$transaction(async (tx) => {
      const created = await tx.movie.create({ data: { ...input, releaseDate: input.releaseDate ? calendarDateAtTime(input.releaseDate, 0) : null } });
      await audit(tx, req.user!.id, "MOVIE_CREATED", "Movie", created.id, { slug: created.slug });
      return created;
    });
    res.status(201).json(toMovie(movie));
  }));

  app.patch("/api/admin/movies/:id", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({
      title: z.string().trim().min(2).max(160),
      slug: z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      genre: z.string().trim().min(2).max(80),
      synopsis: z.string().trim().min(10).max(3000),
      runtimeMinutes: z.number().int().min(30).max(300),
      ageRating: z.string().trim().min(1).max(12),
      posterUrl: z.union([z.string().url(), z.null()]),
      releaseDate: z.union([businessDateSchema, z.null()]),
      status: z.nativeEnum(RecordStatus)
    }).partial().strict().refine((value) => Object.keys(value).length > 0, "Cần ít nhất một trường để cập nhật.").parse(req.body);
    const { releaseDate, ...fields } = input;
    const movie = await prisma.$transaction(async (tx) => {
      const updated = await tx.movie.update({ where: { id: String(req.params.id) }, data: { ...fields, ...(releaseDate !== undefined ? { releaseDate: releaseDate ? calendarDateAtTime(releaseDate, 0) : null } : {}) } });
      await audit(tx, req.user!.id, "MOVIE_UPDATED", "Movie", updated.id, { changedFields: Object.keys(input) });
      return updated;
    });
    res.json(toMovie(movie));
  }));

  app.get("/api/admin/auditoriums", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
    const auditoriums = await prisma.auditorium.findMany({ include: { cinema: true, seats: { orderBy: [{ row: "asc" }, { column: "asc" }] }, _count: { select: { seats: true } } }, orderBy: [{ cinema: { city: "asc" } }, { name: "asc" }] });
    res.json(auditoriums.map((item) => ({ id: item.id, name: item.name, screenType: item.screenType, cinemaId: item.cinemaId, cinemaName: item.cinema.name, seatCount: item._count.seats, seats: item.seats })));
  }));

  app.post("/api/admin/auditoriums", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const seatSchema = z.object({
      label: z.string().trim().min(1).max(12),
      row: z.string().trim().min(1).max(3),
      column: z.number().int().min(1).max(100),
      type: z.nativeEnum(SeatType).default(SeatType.STANDARD),
      isAccessible: z.boolean().optional()
    }).strict();
    const input = z.object({
      cinemaId: z.string().min(1),
      name: z.string().trim().min(1).max(80),
      screenType: z.string().trim().min(1).max(40).default("STANDARD"),
      seats: z.array(seatSchema).min(1).max(300)
    }).strict().superRefine((value, ctx) => {
      const labels = new Set<string>();
      const positions = new Set<string>();
      value.seats.forEach((seat, index) => {
        const label = seat.label.toUpperCase();
        const position = `${seat.row.toUpperCase()}:${seat.column}`;
        if (labels.has(label)) ctx.addIssue({ code: "custom", path: ["seats", index, "label"], message: "Nhãn ghế bị trùng." });
        if (positions.has(position)) ctx.addIssue({ code: "custom", path: ["seats", index, "column"], message: "Vị trí hàng/cột bị trùng." });
        if (seat.isAccessible === false && seat.type === SeatType.ACCESSIBLE) ctx.addIssue({ code: "custom", path: ["seats", index, "isAccessible"], message: "Ghế loại ACCESSIBLE phải được đánh dấu isAccessible." });
        if (seat.isAccessible === true && seat.type !== SeatType.ACCESSIBLE) ctx.addIssue({ code: "custom", path: ["seats", index, "type"], message: "Ghế hỗ trợ tiếp cận phải dùng loại ACCESSIBLE." });
        labels.add(label);
        positions.add(position);
      });
    }).parse(req.body);
    const auditorium = await prisma.$transaction(async (tx) => {
      const cinema = await tx.cinema.findFirst({ where: { id: input.cinemaId, status: RecordStatus.ACTIVE } });
      if (!cinema) throw new DomainError("CINEMA_NOT_FOUND", "Không tìm thấy rạp đang hoạt động.", 404);
      const created = await tx.auditorium.create({ data: { cinemaId: cinema.id, name: input.name, screenType: input.screenType } });
      await tx.seat.createMany({ data: input.seats.map((seat) => ({
        auditoriumId: created.id,
        label: seat.label.toUpperCase(),
        row: seat.row.toUpperCase(),
        column: seat.column,
        type: seat.isAccessible ? SeatType.ACCESSIBLE : seat.type,
        isAccessible: seat.isAccessible === true || seat.type === SeatType.ACCESSIBLE
      })) });
      await audit(tx, req.user!.id, "AUDITORIUM_CREATED", "Auditorium", created.id, { cinemaId: cinema.id, seatCount: input.seats.length });
      return { ...created, seats: await tx.seat.findMany({ where: { auditoriumId: created.id }, orderBy: [{ row: "asc" }, { column: "asc" }] }) };
    });
    res.status(201).json(auditorium);
  }));

  app.patch("/api/admin/auditoriums/:id", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({ name: z.string().trim().min(1).max(80), screenType: z.string().trim().min(1).max(40) }).partial().strict()
      .refine((value) => Object.keys(value).length > 0, "Cần ít nhất một trường để cập nhật.").parse(req.body);
    const auditorium = await prisma.$transaction(async (tx) => {
      const updated = await tx.auditorium.update({ where: { id: String(req.params.id) }, data: input, include: { cinema: true, _count: { select: { seats: true } } } });
      await audit(tx, req.user!.id, "AUDITORIUM_UPDATED", "Auditorium", updated.id, { changedFields: Object.keys(input) });
      return updated;
    });
    res.json({ id: auditorium.id, cinemaId: auditorium.cinemaId, cinemaName: auditorium.cinema.name, name: auditorium.name, screenType: auditorium.screenType, seatCount: auditorium._count.seats });
  }));

  app.patch("/api/admin/seats/:id", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({
      label: z.string().trim().min(1).max(12),
      row: z.string().trim().min(1).max(3),
      column: z.number().int().min(1).max(100),
      type: z.nativeEnum(SeatType),
      isAccessible: z.boolean()
    }).partial().strict().refine((value) => Object.keys(value).length > 0, "Cần ít nhất một trường để cập nhật.").parse(req.body);
    const seat = await prisma.$transaction(async (tx) => {
      const current = await tx.seat.findUnique({ where: { id: String(req.params.id) } });
      if (!current) throw new DomainError("SEAT_NOT_FOUND", "Không tìm thấy ghế.", 404);
      const claimed = await tx.seatClaim.count({ where: { seatId: current.id, status: { in: [ClaimStatus.HELD, ClaimStatus.SOLD] } } });
      if (claimed > 0) throw new DomainError("SEAT_HAS_BOOKINGS", "Không thể sửa ghế đang được giữ hoặc đã bán vé.", 409);
      let nextType = input.type ?? current.type;
      let nextAccessible = input.isAccessible ?? current.isAccessible;
      if (input.isAccessible === false && input.type === undefined && nextType === SeatType.ACCESSIBLE) nextType = SeatType.STANDARD;
      if (nextType === SeatType.ACCESSIBLE) nextAccessible = true;
      if (nextAccessible) nextType = SeatType.ACCESSIBLE;
      const data = { ...input, type: nextType, isAccessible: nextAccessible, ...(input.label !== undefined ? { label: input.label.toUpperCase() } : {}), ...(input.row !== undefined ? { row: input.row.toUpperCase() } : {}) };
      const updated = await tx.seat.update({ where: { id: current.id }, data });
      await audit(tx, req.user!.id, "SEAT_UPDATED", "Seat", updated.id, { auditoriumId: updated.auditoriumId, changedFields: Object.keys(input) });
      return updated;
    });
    res.json(seat);
  }));

  app.get("/api/admin/showtimes", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
    const showtimes = await prisma.showtime.findMany({ include: { movie: true, auditorium: { include: { cinema: true } } }, orderBy: { startAt: "desc" }, take: 100 });
    res.json(showtimes.map(toShowtime));
  }));

  app.post("/api/admin/showtimes", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({ movieId: z.string().min(1), auditoriumId: z.string().min(1), startAt: z.string().datetime({ offset: true }), priceVnd: z.number().int().min(1000).max(1_000_000), premiumSurchargeVnd: z.number().int().min(0).max(500_000).default(30_000) }).strict().parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const movie = await tx.movie.findUnique({ where: { id: input.movieId } });
      const auditorium = await tx.auditorium.findUnique({ where: { id: input.auditoriumId }, include: { cinema: true } });
      if (!movie || !auditorium) throw new DomainError("CATALOG_NOT_FOUND", "Không tìm thấy phim hoặc phòng chiếu.", 404);
      if (movie.status !== RecordStatus.ACTIVE || auditorium.cinema.status !== RecordStatus.ACTIVE) {
        throw new DomainError("INACTIVE_CATALOG", "Không thể mở bán với phim hoặc rạp đã ngừng hoạt động.", 422);
      }
      const startAt = new Date(input.startAt);
      const endAt = new Date(startAt.getTime() + movie.runtimeMinutes * 60_000);
      const cleanupEnd = new Date(endAt.getTime() + 20 * 60_000);
      const preceding = await tx.showtime.findFirst({ where: { auditoriumId: auditorium.id, status: RecordStatus.ACTIVE, startAt: { lt: cleanupEnd }, endAt: { gt: new Date(startAt.getTime() - 20 * 60_000) } } });
      if (preceding) throw new DomainError("SHOWTIME_OVERLAP", "Suất chiếu bị chồng thời gian với lịch đang có.", 409);
      const showtime = await tx.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt, priceVnd: input.priceVnd, premiumSurchargeVnd: input.premiumSurchargeVnd } });
      await audit(tx, req.user!.id, "SHOWTIME_CREATED", "Showtime", showtime.id, { movieId: movie.id, auditoriumId: auditorium.id, startAt: startAt.toISOString() });
      return tx.showtime.findUniqueOrThrow({ where: { id: showtime.id }, include: { movie: true, auditorium: { include: { cinema: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json(toShowtime(created));
  }));

  app.patch("/api/admin/showtimes/:id", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({
      movieId: z.string().min(1),
      auditoriumId: z.string().min(1),
      startAt: z.string().datetime({ offset: true }),
      priceVnd: z.number().int().min(1000).max(1_000_000),
      premiumSurchargeVnd: z.number().int().min(0).max(500_000),
      status: z.nativeEnum(RecordStatus)
    }).partial().strict().refine((value) => Object.keys(value).length > 0, "Cần ít nhất một trường để cập nhật.").parse(req.body);
    const showtime = await prisma.$transaction(async (tx) => {
      const current = await tx.showtime.findUnique({ where: { id: String(req.params.id) }, include: { movie: true, auditorium: { include: { cinema: true } } } });
      if (!current) throw new DomainError("SHOWTIME_NOT_FOUND", "Không tìm thấy suất chiếu.", 404);
      const changesIdentity = input.movieId !== undefined || input.auditoriumId !== undefined || input.startAt !== undefined;
      if (changesIdentity) {
        const existingClaims = await tx.seatClaim.count({ where: { showtimeId: current.id, status: { in: [ClaimStatus.HELD, ClaimStatus.SOLD] } } });
        if (existingClaims > 0) throw new DomainError("SHOWTIME_HAS_BOOKINGS", "Không thể đổi phim, phòng hoặc giờ khi suất đã có ghế giữ/bán.", 409);
      }
      const movieId = input.movieId ?? current.movieId;
      const auditoriumId = input.auditoriumId ?? current.auditoriumId;
      const movie = await tx.movie.findUnique({ where: { id: movieId } });
      const auditorium = await tx.auditorium.findUnique({ where: { id: auditoriumId }, include: { cinema: true } });
      if (!movie || !auditorium) throw new DomainError("CATALOG_NOT_FOUND", "Không tìm thấy phim hoặc phòng chiếu.", 404);
      const startAt = input.startAt ? new Date(input.startAt) : current.startAt;
      const endAt = new Date(startAt.getTime() + movie.runtimeMinutes * 60_000);
      const status = input.status ?? current.status;
      if (status === RecordStatus.ACTIVE && (movie.status !== RecordStatus.ACTIVE || auditorium.cinema.status !== RecordStatus.ACTIVE)) {
        throw new DomainError("INACTIVE_CATALOG", "Không thể mở bán với phim hoặc rạp đã ngừng hoạt động.", 422);
      }
      if (status === RecordStatus.ACTIVE) {
        const cleanupEnd = new Date(endAt.getTime() + 20 * 60_000);
        const conflict = await tx.showtime.findFirst({
          where: { id: { not: current.id }, auditoriumId, status: RecordStatus.ACTIVE, startAt: { lt: cleanupEnd }, endAt: { gt: new Date(startAt.getTime() - 20 * 60_000) } }
        });
        if (conflict) throw new DomainError("SHOWTIME_OVERLAP", "Suất chiếu bị chồng thời gian với lịch đang có.", 409);
      }
      const updated = await tx.showtime.update({
        where: { id: current.id },
        data: { movieId, auditoriumId, startAt, endAt, status, ...(input.priceVnd !== undefined ? { priceVnd: input.priceVnd } : {}), ...(input.premiumSurchargeVnd !== undefined ? { premiumSurchargeVnd: input.premiumSurchargeVnd } : {}) },
        include: { movie: true, auditorium: { include: { cinema: true } } }
      });
      await audit(tx, req.user!.id, "SHOWTIME_UPDATED", "Showtime", updated.id, { changedFields: Object.keys(input), priceVnd: updated.priceVnd, premiumSurchargeVnd: updated.premiumSurchargeVnd });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json(toShowtime(showtime));
  }));

  app.get("/api/admin/users", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
    res.json(await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, assignedCinemaId: true, assignedCinema: { select: { id: true, name: true } }, createdAt: true },
      orderBy: { createdAt: "asc" }
    }));
  }));

  app.patch("/api/admin/users/:id/role", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({ role: z.nativeEnum(Role) }).strict().parse(req.body);
    if (String(req.params.id) === req.user!.id && input.role !== Role.ADMIN) throw new DomainError("SELF_DEMOTION_FORBIDDEN", "Không thể tự hạ quyền quản trị.", 422);
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: String(req.params.id) }, data: { role: input.role, authVersion: { increment: 1 }, ...(input.role !== Role.STAFF ? { assignedCinemaId: null } : {}) }, select: { id: true, name: true, email: true, role: true, assignedCinemaId: true } });
      await audit(tx, req.user!.id, "USER_ROLE_CHANGED", "User", user.id, { role: user.role });
      return user;
    });
    res.json(updated);
  }));

  app.patch("/api/admin/users/:id/assigned-cinema", requireAuth, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
    const input = z.object({ cinemaId: z.string().min(1).nullable() }).strict().parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: String(req.params.id) }, select: { id: true, role: true } });
      if (!target) throw new DomainError("USER_NOT_FOUND", "Không tìm thấy người dùng.", 404);
      if (target.role !== Role.STAFF) throw new DomainError("STAFF_REQUIRED", "Chỉ có thể phân công rạp cho tài khoản STAFF.", 422);
      if (input.cinemaId !== null) {
        const cinema = await tx.cinema.findFirst({ where: { id: input.cinemaId, status: RecordStatus.ACTIVE }, select: { id: true } });
        if (!cinema) throw new DomainError("CINEMA_NOT_FOUND", "Không tìm thấy rạp đang hoạt động.", 404);
      }
      // Keep the Staff predicate in the write itself so a concurrent demotion cannot restore a cinema assignment.
      const assignment = await tx.user.updateMany({
        where: { id: target.id, role: Role.STAFF },
        data: { assignedCinemaId: input.cinemaId, authVersion: { increment: 1 } },
      });
      if (assignment.count !== 1) {
        const currentTarget = await tx.user.findUnique({ where: { id: target.id }, select: { id: true } });
        if (!currentTarget) throw new DomainError("USER_NOT_FOUND", "Không tìm thấy người dùng.", 404);
        throw new DomainError("STAFF_REQUIRED", "Chỉ có thể phân công rạp cho tài khoản STAFF.", 422);
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { id: true, name: true, email: true, role: true, assignedCinemaId: true, assignedCinema: { select: { id: true, name: true } } }
      });
      await audit(tx, req.user!.id, "STAFF_CINEMA_ASSIGNED", "User", user.id, { assignedCinemaId: user.assignedCinemaId });
      return user;
    });
    res.json(updated);
  }));

  app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND", message: "Không tìm thấy tài nguyên." }));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError && "status" in error && error.status === 400) return res.status(400).json({ error: "INVALID_JSON", message: "Nội dung JSON không hợp lệ." });
    if (error instanceof z.ZodError) return res.status(422).json({ error: "VALIDATION_ERROR", message: "Dữ liệu gửi lên chưa hợp lệ.", details: error.flatten() });
    if (error instanceof DomainError) return res.status(error.status).json({ error: error.code, message: error.message });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return res.status(409).json({ error: "RESOURCE_CONFLICT", message: "Ghế hoặc dữ liệu vừa được một yêu cầu khác xử lý. Hãy tải lại và thử lại." });
      if (error.code === "P2025") return res.status(404).json({ error: "NOT_FOUND", message: "Không tìm thấy dữ liệu." });
      if (error.code === "P2034") return res.status(409).json({ error: "TRANSACTION_RETRY", message: "Dữ liệu vừa thay đổi. Vui lòng thử lại." });
    }
    console.error(error);
    return res.status(500).json({ error: "INTERNAL_ERROR", message: "Có lỗi hệ thống xảy ra." });
  });

  return app;
}

async function getOrderForResponse(client: Prisma.TransactionClient | typeof prisma, orderId: string) {
  const order = await client.cinemaOrder.findUnique({
    where: { id: orderId },
    include: { showtime: { include: { movie: true, auditorium: { include: { cinema: true } } } }, claims: { include: { seat: true } }, tickets: true }
  });
  if (!order) throw new DomainError("ORDER_NOT_FOUND", "Không tìm thấy đơn đặt vé.", 404);
  return toOrder(order);
}
