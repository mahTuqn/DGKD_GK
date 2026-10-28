import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HoldStatus, OrderStatus, OutboxEventStatus, OutboxEventType, PaymentStatus, Prisma, ReconciliationCaseStatus, type OutboxEvent, type PrismaClient } from "@prisma/client";
import { prisma } from "./db.js";
import { createWorkerHealthServer, WORKER_HEALTH_PATH, type WorkerHealthSnapshot } from "./worker-health.js";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_INTERVAL_MS = 1_000;
const MAX_BATCH_SIZE = 500;

export type EnqueueOutboxEventInput = {
  eventKey: string;
  eventType: OutboxEventType | "PAYMENT_RECONCILIATION_REQUIRED";
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
};

export type PaymentReconciliationRequiredPayload = {
  providerEventId: string;
  orderId: string;
  amountVnd: number;
  currency: "VND";
  reason: "PAYMENT_AFTER_EXPIRY";
};

export type ExpirationSweepResult = {
  expiredHeldHolds: number;
  expiredPendingOrders: number;
};

export type OutboxBatchResult = {
  processed: number;
  dead: number;
};

export type WorkerCycleResult = ExpirationSweepResult & {
  outbox: OutboxBatchResult;
};

function validateBatchSize(batchSize: number) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new RangeError(`batchSize must be an integer from 1 to ${MAX_BATCH_SIZE}.`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Persist an event in the caller's transaction. Reusing an eventKey with the
 * same content is idempotent; reusing it for different content is rejected.
 */
export async function enqueueOutboxEvent(tx: Prisma.TransactionClient, event: EnqueueOutboxEventInput): Promise<OutboxEvent> {
  if (!event.eventKey.trim() || !event.aggregateId.trim()) throw new Error("Outbox eventKey and aggregateId are required.");
  if (event.eventType !== OutboxEventType.PAYMENT_RECONCILIATION_REQUIRED) throw new Error(`Unsupported outbox event type: ${event.eventType}`);
  const now = new Date();
  const availableAt = event.availableAt ?? now;
  const payload = JSON.stringify(event.payload);
  if (payload === undefined) throw new Error("Outbox payload must be JSON serializable.");

  await tx.$executeRaw`
    INSERT INTO "OutboxEvent" ("id", "eventKey", "eventType", "aggregateId", "payload", "status", "attempts", "availableAt", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${event.eventKey}, 'PAYMENT_RECONCILIATION_REQUIRED'::"OutboxEventType", ${event.aggregateId}, ${payload}::jsonb, 'PENDING'::"OutboxEventStatus", 0, ${availableAt}, ${now}, ${now})
    ON CONFLICT ("eventKey") DO NOTHING
  `;

  const stored = await tx.outboxEvent.findUnique({ where: { eventKey: event.eventKey } });
  if (!stored) throw new Error("Outbox event insert did not produce a stored event.");
  if (stored.eventType !== event.eventType || stored.aggregateId !== event.aggregateId || stableJson(stored.payload) !== stableJson(event.payload)) {
    throw new Error(`Outbox eventKey '${event.eventKey}' was already used with different content.`);
  }
  return stored;
}

type DuePendingOrder = { orderId: string; holdId: string };
type DueHeldHold = { id: string };

/** Expire due holds under database row locks; no correctness depends on sweep cadence. */
export async function expireDueHolds(database: PrismaClient = prisma, now = new Date(), batchSize = DEFAULT_BATCH_SIZE): Promise<ExpirationSweepResult> {
  validateBatchSize(batchSize);
  return database.$transaction(async (tx) => {
    let expiredHeldHolds = 0;
    let expiredPendingOrders = 0;

    // Lock orders first for payment-pending holds. The payment callback path
    // locks the order before the hold, so both paths use the same lock order.
    const pendingOrders = await tx.$queryRaw<DuePendingOrder[]>`
      SELECT o."id" AS "orderId", h."id" AS "holdId"
      FROM "CinemaOrder" o
      JOIN "SeatHold" h ON h."id" = o."holdId"
      WHERE o."status" = 'PAYMENT_PENDING'::"OrderStatus"
        AND h."status" = 'PAYMENT_PENDING'::"HoldStatus"
        AND h."expiresAt" <= ${now}
      ORDER BY h."expiresAt", o."id"
      LIMIT ${batchSize}
      FOR UPDATE OF o SKIP LOCKED
    `;

    for (const candidate of pendingOrders) {
      // Re-read after acquiring the order lock, then lock the hold in the same
      // order as applyMockPaymentEvent. A callback that won the race is skipped.
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "SeatHold" WHERE "id" = ${candidate.holdId} FOR UPDATE`);
      const order = await tx.cinemaOrder.findUnique({ where: { id: candidate.orderId }, include: { hold: true } });
      if (!order || order.status !== OrderStatus.PAYMENT_PENDING || order.hold.status !== HoldStatus.PAYMENT_PENDING || order.hold.expiresAt > now) continue;

      const payment = await tx.payment.findUnique({ where: { orderId: order.id }, select: { status: true } });
      if (payment?.status === PaymentStatus.SUCCEEDED) continue;

      await tx.cinemaOrder.update({ where: { id: order.id }, data: { status: OrderStatus.EXPIRED } });
      await tx.seatHold.update({ where: { id: order.holdId }, data: { status: HoldStatus.EXPIRED } });
      await tx.seatClaim.updateMany({
        where: { orderId: order.id, status: "HELD" },
        data: { status: "EXPIRED", holdId: null, orderId: null, expiresAt: null }
      });
      await tx.payment.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, amountVnd: order.totalVnd, status: PaymentStatus.FAILED },
        update: { amountVnd: order.totalVnd, status: PaymentStatus.FAILED }
      });
      await tx.auditLog.create({
        data: { actorId: null, action: "PAYMENT_PENDING_EXPIRED", entity: "CinemaOrder", entityId: order.id, metadata: { holdId: order.holdId, expiredAt: now.toISOString() } }
      });
      expiredPendingOrders += 1;
    }

    const heldHolds = await tx.$queryRaw<DueHeldHold[]>`
      SELECT h."id"
      FROM "SeatHold" h
      WHERE h."status" = 'HELD'::"HoldStatus"
        AND h."expiresAt" <= ${now}
      ORDER BY h."expiresAt", h."id"
      LIMIT ${batchSize}
      FOR UPDATE OF h SKIP LOCKED
    `;

    for (const candidate of heldHolds) {
      const hold = await tx.seatHold.findUnique({ where: { id: candidate.id }, select: { id: true, status: true, expiresAt: true } });
      if (!hold || hold.status !== HoldStatus.HELD || hold.expiresAt > now) continue;
      await tx.seatHold.update({ where: { id: hold.id }, data: { status: HoldStatus.EXPIRED } });
      await tx.seatClaim.updateMany({
        where: { holdId: hold.id, status: "HELD" },
        data: { status: "EXPIRED", holdId: null, orderId: null, expiresAt: null }
      });
      await tx.auditLog.create({
        data: { actorId: null, action: "SEAT_HOLD_EXPIRED", entity: "SeatHold", entityId: hold.id, metadata: { expiredAt: now.toISOString() } }
      });
      expiredHeldHolds += 1;
    }

    return { expiredHeldHolds, expiredPendingOrders };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

type ReconciliationPayload = PaymentReconciliationRequiredPayload & Record<string, unknown>;

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseReconciliationPayload(value: Prisma.JsonValue): ReconciliationPayload | null {
  if (!isRecord(value)) return null;
  const providerEventId = value.providerEventId;
  const orderId = value.orderId;
  const amountVnd = value.amountVnd;
  const currency = value.currency;
  const reason = value.reason;
  if (typeof providerEventId !== "string" || providerEventId.length < 1) return null;
  if (typeof orderId !== "string" || orderId.length < 1) return null;
  if (typeof amountVnd !== "number" || !Number.isSafeInteger(amountVnd) || amountVnd <= 0 || amountVnd > 2_147_483_647) return null;
  if (currency !== "VND" || reason !== "PAYMENT_AFTER_EXPIRY") return null;
  return value as ReconciliationPayload;
}

function briefError(error: string) {
  return error.slice(0, 1_000);
}

async function markOutboxDead(tx: Prisma.TransactionClient, eventId: string, reason: string) {
  await tx.outboxEvent.update({
    where: { id: eventId },
    data: { status: OutboxEventStatus.DEAD, attempts: { increment: 1 }, lastError: briefError(reason) }
  });
}

async function insertReconciliationCase(tx: Prisma.TransactionClient, event: OutboxEvent, payload: ReconciliationPayload, now: Date): Promise<boolean> {
  const order = await tx.cinemaOrder.findUnique({ where: { id: payload.orderId }, select: { id: true } });
  if (!order || event.aggregateId !== payload.orderId) return false;

  const encodedPayload = JSON.stringify(payload);
  if (encodedPayload === undefined) return false;
  await tx.$executeRaw`
    INSERT INTO "ReconciliationCase" ("id", "providerEventId", "orderId", "outboxEventId", "amountVnd", "currency", "reason", "status", "payload", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${payload.providerEventId}, ${payload.orderId}, ${event.id}, ${payload.amountVnd}, ${payload.currency}, ${payload.reason}, 'OPEN'::"ReconciliationCaseStatus", ${encodedPayload}::jsonb, ${now}, ${now})
    ON CONFLICT ("providerEventId") DO NOTHING
  `;

  const stored = await tx.reconciliationCase.findUnique({ where: { providerEventId: payload.providerEventId } });
  if (!stored) return false;
  return stored.orderId === payload.orderId && stored.amountVnd === payload.amountVnd && stored.currency === payload.currency && stored.reason === payload.reason;
}

/** Claim due outbox rows with SKIP LOCKED and create cases atomically/idempotently. */
export async function processOutboxBatch(database: PrismaClient = prisma, now = new Date(), batchSize = DEFAULT_BATCH_SIZE): Promise<OutboxBatchResult> {
  validateBatchSize(batchSize);
  return database.$transaction(async (tx) => {
    const dueEvents = await tx.$queryRaw<OutboxEvent[]>`
      SELECT *
      FROM "OutboxEvent"
      WHERE "status" = 'PENDING'::"OutboxEventStatus"
        AND "availableAt" <= ${now}
      ORDER BY "availableAt", "createdAt", "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    let processed = 0;
    let dead = 0;
    for (const event of dueEvents) {
      if (event.eventType !== OutboxEventType.PAYMENT_RECONCILIATION_REQUIRED) {
        await markOutboxDead(tx, event.id, `Unsupported event type: ${event.eventType}`);
        dead += 1;
        continue;
      }
      const payload = parseReconciliationPayload(event.payload);
      if (!payload) {
        await markOutboxDead(tx, event.id, "Invalid payment reconciliation payload.");
        dead += 1;
        continue;
      }
      const createdOrExistingCase = await insertReconciliationCase(tx, event, payload, now);
      if (!createdOrExistingCase) {
        await markOutboxDead(tx, event.id, "Reconciliation payload conflicts with an existing event or references a missing order.");
        dead += 1;
        continue;
      }
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxEventStatus.PROCESSED, attempts: { increment: 1 }, processedAt: now, lastError: null }
      });
      processed += 1;
    }
    return { processed, dead };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function runWorkerCycle(database: PrismaClient = prisma, now = new Date(), batchSize = DEFAULT_BATCH_SIZE): Promise<WorkerCycleResult> {
  const expiration = await expireDueHolds(database, now, batchSize);
  const outbox = await processOutboxBatch(database, now, batchSize);
  return { ...expiration, outbox };
}

export type StartWorkerOptions = {
  database?: PrismaClient;
  intervalMs?: number;
  batchSize?: number;
  onError?: (error: unknown) => void;
  onCycleSuccess?: (result: WorkerCycleResult, completedAt: number) => void;
};

/** Start a non-overlapping worker loop; row locks allow multiple instances safely. */
export function startWorker(options: StartWorkerOptions = {}): { stop: () => Promise<void> } {
  const database = options.database ?? prisma;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new RangeError("intervalMs must be a positive integer.");
  validateBatchSize(batchSize);

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let currentCycle: Promise<unknown> | undefined;
  const onError = options.onError ?? ((error: unknown) => console.error("CinemaBooking worker cycle failed.", error));

  const loop = async () => {
    if (stopping) return;
    currentCycle = runWorkerCycle(database, new Date(), batchSize)
      .then((result) => options.onCycleSuccess?.(result, Date.now()))
      .catch((error: unknown) => onError(error));
    await currentCycle;
    if (!stopping) timer = setTimeout(() => void loop(), intervalMs);
  };
  void loop();

  return {
    stop: async () => {
      stopping = true;
      if (timer) clearTimeout(timer);
      await currentCycle;
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? "4001");
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
    throw new RangeError("WORKER_HEALTH_PORT must be an integer from 1 to 65535.");
  }
  const healthSnapshot: WorkerHealthSnapshot = { lastSuccessfulCycleAt: null, lastErrorAt: null };
  const healthServer = createWorkerHealthServer(() => healthSnapshot);
  healthServer.listen(healthPort, "127.0.0.1");
  const worker = startWorker({
    onCycleSuccess: (_result, completedAt) => {
      healthSnapshot.lastSuccessfulCycleAt = completedAt;
    },
    onError: (error) => {
      healthSnapshot.lastErrorAt = Date.now();
      console.error("CinemaBooking worker cycle failed.", error);
    }
  });
  const shutdown = async () => {
    await new Promise<void>((resolveClose) => healthServer.close(() => resolveClose()));
    await worker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  console.info(`CinemaBooking expiration and reconciliation worker started; health endpoint on 127.0.0.1:${healthPort}${WORKER_HEALTH_PATH}.`);
}
