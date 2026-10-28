import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { HoldStatus, OrderStatus, OutboxEventStatus, OutboxEventType, PrismaClient, RecordStatus, Role } from "@prisma/client";
import { enqueueOutboxEvent } from "../src/worker.js";
import { resolveWorkerSoakDurationMs, WORKER_SOAK_EVENT_INTERVAL_MS } from "./worker-process-soak-config.js";

const databaseUrl = process.env.DATABASE_URL_WORKER_PROCESS_TEST;
const processDescribe = databaseUrl ? describe.sequential : describe.skip;
const soakDurationMs = resolveWorkerSoakDurationMs();
const soakEventCount = 1 + Math.ceil(soakDurationMs / WORKER_SOAK_EVENT_INTERVAL_MS);
const soakCaseId = soakDurationMs > 60_000 ? "TC-WORKER-06" : "TC-WORKER-05";

type HarnessMessage = { type: string; pid?: number; error?: string };
type MessageWaiter = { matches: (message: HarnessMessage) => boolean; resolve: (message: HarnessMessage) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };
type WorkerProcess = { child: ChildProcess; messages: HarnessMessage[]; waiters: MessageWaiter[]; output: string; exit?: { code: number | null; signal: NodeJS.Signals | null } };

function waitForMessage(worker: WorkerProcess, matches: (message: HarnessMessage) => boolean, timeoutMs = 15_000): Promise<HarnessMessage> {
  const index = worker.messages.findIndex(matches);
  if (index >= 0) return Promise.resolve(worker.messages.splice(index, 1)[0]!);
  if (worker.exit) return Promise.reject(new Error(`Worker process exited before expected IPC message (code=${worker.exit.code}, signal=${worker.exit.signal}). Output: ${worker.output}`));

  return new Promise((resolve, reject) => {
    const waiter: MessageWaiter = {
      matches,
      resolve,
      reject,
      timeout: setTimeout(() => {
        worker.waiters = worker.waiters.filter((entry) => entry !== waiter);
        reject(new Error(`Timed out waiting for worker IPC message. Output: ${worker.output}`));
      }, timeoutMs)
    };
    worker.waiters.push(waiter);
  });
}

function waitForExit(worker: WorkerProcess, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (worker.exit) return Promise.resolve(worker.exit);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.child.removeListener("exit", onExit);
      reject(new Error(`Worker process did not exit within ${timeoutMs}ms. Output: ${worker.output}`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    worker.child.once("exit", onExit);
  });
}

function spawnWorkerProcess(): WorkerProcess {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/worker-process-harness.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl!, DATABASE_URL_TEST: databaseUrl!, DATABASE_URL_WORKER_PROCESS_TEST: databaseUrl! },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true
  });
  const worker: WorkerProcess = { child, messages: [], waiters: [], output: "" };
  const collect = (chunk: Buffer) => { worker.output = `${worker.output}${chunk.toString("utf8")}`.slice(-8_000); };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("message", (rawMessage) => {
    const message = rawMessage as HarnessMessage;
    const index = worker.waiters.findIndex((waiter) => waiter.matches(message));
    if (index < 0) {
      worker.messages.push(message);
      return;
    }
    const [waiter] = worker.waiters.splice(index, 1);
    clearTimeout(waiter!.timeout);
    waiter!.resolve(message);
  });
  child.on("exit", (code, signal) => {
    worker.exit = { code, signal };
    for (const waiter of worker.waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`Worker process exited while awaiting IPC (code=${code}, signal=${signal}). Output: ${worker.output}`));
    }
  });
  child.on("error", (error) => {
    for (const waiter of worker.waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  });
  return worker;
}

async function startWorkerProcess(worker: WorkerProcess) {
  const started = waitForMessage(worker, (message) => message.type === "started");
  worker.child.send({ type: "start" });
  await started;
}

async function stopWorkerProcess(worker: WorkerProcess) {
  if (worker.exit) return worker.exit;
  if (worker.child.connected) {
    const stopped = waitForMessage(worker, (message) => message.type === "stopped", 10_000);
    worker.child.send({ type: "shutdown" });
    try {
      await stopped;
    } catch {
      worker.child.kill("SIGTERM");
    }
  } else {
    worker.child.kill("SIGTERM");
  }
  try {
    return await waitForExit(worker, 10_000);
  } catch {
    worker.child.kill("SIGKILL");
    return waitForExit(worker, 5_000);
  }
}

processDescribe("plan phase 5: worker process soak and restart on isolated PostgreSQL", () => {
  const fixture = randomUUID();
  const providerEventIds: string[] = [];
  const eventKeys: string[] = [];
  const database = new PrismaClient({ datasourceUrl: databaseUrl! });
  let cinemaId: string | undefined;
  let auditoriumId: string | undefined;
  let movieId: string | undefined;
  let showtimeId: string | undefined;
  let userId: string | undefined;
  let holdId: string | undefined;
  let orderId: string | undefined;

  beforeAll(async () => {
    await database.$connect();
    const cinema = await database.cinema.create({ data: { name: `Worker Process ${fixture}`, city: "Test", address: "Isolated worker process fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await database.auditorium.create({ data: { cinemaId: cinema.id, name: `Worker Process Room ${fixture}` } });
    auditoriumId = auditorium.id;
    const movie = await database.movie.create({
      data: { slug: `worker-process-${fixture}`, title: `Worker Process ${fixture}`, genre: "Test", synopsis: "Isolated process-level worker fixture.", runtimeMinutes: 90, ageRating: "P" }
    });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 86_400_000);
    const showtime = await database.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000 } });
    showtimeId = showtime.id;
    const user = await database.user.create({ data: { name: "Worker Process Customer", email: `worker-process-${fixture}@test.local`, passwordHash: "unused-test-only", role: Role.CUSTOMER } });
    userId = user.id;
    const hold = await database.seatHold.create({ data: { userId: user.id, showtimeId: showtime.id, status: HoldStatus.PAYMENT_PENDING, expiresAt: new Date(Date.now() + 86_400_000) } });
    holdId = hold.id;
    const order = await database.cinemaOrder.create({ data: { userId: user.id, showtimeId: showtime.id, holdId: hold.id, status: OrderStatus.PAYMENT_PENDING, totalVnd: 200_000 } });
    orderId = order.id;
  }, 30_000);

  afterAll(async () => {
    if (providerEventIds.length) await database.reconciliationCase.deleteMany({ where: { providerEventId: { in: providerEventIds } } });
    if (eventKeys.length) await database.outboxEvent.deleteMany({ where: { eventKey: { in: eventKeys } } });
    if (orderId) await database.cinemaOrder.deleteMany({ where: { id: orderId } });
    if (holdId) await database.seatHold.deleteMany({ where: { id: holdId } });
    if (userId) await database.user.deleteMany({ where: { id: userId } });
    if (showtimeId) await database.showtime.deleteMany({ where: { id: showtimeId } });
    if (movieId) await database.movie.deleteMany({ where: { id: movieId } });
    if (auditoriumId) await database.auditorium.deleteMany({ where: { id: auditoriumId } });
    if (cinemaId) await database.cinema.deleteMany({ where: { id: cinemaId } });
    await database.$disconnect();
  }, 30_000);

  it(`[${soakCaseId}] runs two worker processes for ${soakDurationMs / 1000} seconds and catches up after restart`, async () => {
    const processes: WorkerProcess[] = [];
    const activeWorkers: WorkerProcess[] = [];
    const createEvent = async () => {
      const providerEventId = `worker-process-${fixture}-${providerEventIds.length}`;
      const eventKey = `payment-reconciliation:${providerEventId}`;
      providerEventIds.push(providerEventId);
      eventKeys.push(eventKey);
      await database.$transaction((tx) => enqueueOutboxEvent(tx, {
        eventKey,
        eventType: OutboxEventType.PAYMENT_RECONCILIATION_REQUIRED,
        aggregateId: orderId!,
        payload: { providerEventId, orderId: orderId!, amountVnd: 100_000, currency: "VND", reason: "PAYMENT_AFTER_EXPIRY" }
      }));
      return { providerEventId, eventKey };
    };
    const waitUntilProcessed = async (eventKey: string, workers: WorkerProcess[]) => {
      const deadline = Date.now() + 15_000;
      let event = await database.outboxEvent.findUniqueOrThrow({ where: { eventKey } });
      while (event.status === OutboxEventStatus.PENDING && Date.now() < deadline) {
        await delay(100);
        event = await database.outboxEvent.findUniqueOrThrow({ where: { eventKey } });
      }
      const errors = workers.flatMap((worker) => worker.messages.filter((message) => message.type === "cycle-error" || message.type === "error"));
      expect(errors, `Worker error messages: ${JSON.stringify(errors)}`).toHaveLength(0);
      expect(event.status).toBe(OutboxEventStatus.PROCESSED);
      expect(event.attempts).toBe(1);
      return event;
    };
    const startGroup = async (workers: WorkerProcess[]) => {
      const readyPromises = workers.map((worker) => waitForMessage(worker, (message) => message.type === "ready"));
      const ready = await Promise.all(readyPromises);
      expect(ready.map((message) => message.pid)).toEqual(workers.map((worker) => worker.child.pid));
      expect(new Set(ready.map((message) => message.pid)).size).toBe(workers.length);
      for (const worker of workers) await startWorkerProcess(worker);
      return ready.map((message) => message.pid!);
    };
    const stopGroup = async (workers: WorkerProcess[]) => {
      const exits = await Promise.all(workers.map((worker) => stopWorkerProcess(worker)));
      expect(exits.every((exit) => exit.code === 0 && exit.signal === null)).toBe(true);
    };

    try {
      const firstGroup = [spawnWorkerProcess(), spawnWorkerProcess()];
      processes.push(...firstGroup);
      activeWorkers.push(...firstGroup);
      const firstPids = await startGroup(firstGroup);
      expect(firstPids[0]).not.toBe(firstPids[1]);

      const firstEvent = await createEvent();
      await waitUntilProcessed(firstEvent.eventKey, activeWorkers);
      for (let elapsedMs = 0; elapsedMs < soakDurationMs; elapsedMs += WORKER_SOAK_EVENT_INTERVAL_MS) {
        await delay(WORKER_SOAK_EVENT_INTERVAL_MS);
        expect(activeWorkers.every((worker) => worker.exit === undefined && worker.child.exitCode === null && worker.child.signalCode === null)).toBe(true);
        const event = await createEvent();
        await waitUntilProcessed(event.eventKey, activeWorkers);
      }

      const soakEvents = await database.outboxEvent.findMany({ where: { eventKey: { in: eventKeys } } });
      expect(soakEvents).toHaveLength(soakEventCount);
      expect(soakEvents.every((event) => event.status === OutboxEventStatus.PROCESSED && event.attempts === 1)).toBe(true);
      const soakCases = await database.reconciliationCase.findMany({ where: { providerEventId: { in: providerEventIds } } });
      expect(soakCases).toHaveLength(soakEventCount);
      expect(new Set(soakCases.map((reconciliationCase) => reconciliationCase.providerEventId)).size).toBe(soakEventCount);
      await stopGroup(firstGroup);
      activeWorkers.splice(0, activeWorkers.length);

      const restartEvent = await createEvent();
      expect((await database.outboxEvent.findUniqueOrThrow({ where: { eventKey: restartEvent.eventKey } })).status).toBe(OutboxEventStatus.PENDING);
      const replacement = spawnWorkerProcess();
      processes.push(replacement);
      activeWorkers.push(replacement);
      await startGroup([replacement]);
      await waitUntilProcessed(restartEvent.eventKey, activeWorkers);
      expect(await database.reconciliationCase.count({ where: { providerEventId: restartEvent.providerEventId } })).toBe(1);
      await stopGroup([replacement]);
      activeWorkers.splice(0, activeWorkers.length);
    } finally {
      const remaining = processes.filter((worker) => !worker.exit);
      if (remaining.length) await stopGroup(remaining);
    }
  }, soakDurationMs + 120_000);
});
