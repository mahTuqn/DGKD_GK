import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaClient, RecordStatus, Role, SeatType } from "@prisma/client";
import { createToken } from "../src/auth.js";

const databaseUrl = process.env.DATABASE_URL_API_PROCESS_TEST;
const processDescribe = databaseUrl ? describe.sequential : describe.skip;
const fixture = randomUUID();
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : undefined;

type HarnessMessage = { type: string; pid?: number; port?: number; error?: string };
type MessageWaiter = { matches: (message: HarnessMessage) => boolean; resolve: (message: HarnessMessage) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };
type ApiProcess = { child: ChildProcess; messages: HarnessMessage[]; waiters: MessageWaiter[]; output: string; exit?: { code: number | null; signal: NodeJS.Signals | null }; url?: string; pid?: number };

const apiProcesses: ApiProcess[] = [];
const userIds: string[] = [];
let cinemaId: string | undefined;
let auditoriumId: string | undefined;
let seatId: string | undefined;
let movieId: string | undefined;
let showtimeId: string | undefined;
let customerTokens: string[] = [];

function waitForMessage(api: ApiProcess, matches: (message: HarnessMessage) => boolean, timeoutMs = 15_000): Promise<HarnessMessage> {
  const index = api.messages.findIndex(matches);
  if (index >= 0) return Promise.resolve(api.messages.splice(index, 1)[0]!);
  if (api.exit) return Promise.reject(new Error(`API process exited before the expected IPC message (code=${api.exit.code}, signal=${api.exit.signal}). Output: ${api.output}`));

  return new Promise((resolve, reject) => {
    const waiter: MessageWaiter = {
      matches,
      resolve,
      reject,
      timeout: setTimeout(() => {
        api.waiters = api.waiters.filter((entry) => entry !== waiter);
        reject(new Error(`Timed out waiting for API process IPC message. Output: ${api.output}`));
      }, timeoutMs)
    };
    api.waiters.push(waiter);
  });
}

function waitForExit(api: ApiProcess, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (api.exit) return Promise.resolve(api.exit);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      api.child.removeListener("exit", onExit);
      reject(new Error(`API process did not exit within ${timeoutMs}ms. Output: ${api.output}`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    api.child.once("exit", onExit);
  });
}

function spawnApiProcess(): ApiProcess {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/api-process-harness.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!,
      DATABASE_URL_TEST: databaseUrl!
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true
  });
  const api: ApiProcess = { child, messages: [], waiters: [], output: "" };
  const collect = (chunk: Buffer) => { api.output = `${api.output}${chunk.toString("utf8")}`.slice(-8_000); };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("message", (rawMessage) => {
    const message = rawMessage as HarnessMessage;
    const index = api.waiters.findIndex((waiter) => waiter.matches(message));
    if (index < 0) {
      api.messages.push(message);
      return;
    }
    const [waiter] = api.waiters.splice(index, 1);
    clearTimeout(waiter!.timeout);
    waiter!.resolve(message);
  });
  child.on("exit", (code, signal) => {
    api.exit = { code, signal };
    for (const waiter of api.waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`API process exited while awaiting IPC (code=${code}, signal=${signal}). Output: ${api.output}`));
    }
  });
  child.on("error", (error) => {
    for (const waiter of api.waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  });
  apiProcesses.push(api);
  return api;
}

async function startApiProcess(api: ApiProcess) {
  const message = await waitForMessage(api, (candidate) => candidate.type === "ready" || candidate.type === "error");
  if (message.type === "error") throw new Error(`API process failed to start: ${message.error}. Output: ${api.output}`);
  if (!message.port || !message.pid) throw new Error(`API process returned invalid readiness data. Output: ${api.output}`);
  api.pid = message.pid;
  api.url = `http://127.0.0.1:${message.port}`;
}

async function stopApiProcess(api: ApiProcess) {
  if (api.exit) return api.exit;
  if (api.child.connected) {
    const stopped = waitForMessage(api, (message) => message.type === "stopped", 10_000);
    api.child.send({ type: "shutdown" });
    try {
      await stopped;
    } catch {
      api.child.kill("SIGTERM");
    }
  } else {
    api.child.kill("SIGTERM");
  }
  try {
    return await waitForExit(api, 10_000);
  } catch {
    api.child.kill("SIGKILL");
    return waitForExit(api, 5_000);
  }
}

processDescribe("TC-PLAN-08: same-seat HTTP race across independent API processes", () => {
  beforeAll(async () => {
    if (!databaseUrl || !prisma) throw new Error("DATABASE_URL_API_PROCESS_TEST is required for the isolated multi-process API race test.");
    await prisma.$connect();

    const cinema = await prisma.cinema.create({ data: { name: `API process race ${fixture}`, city: "Test", address: "Dedicated API process race fixture", status: RecordStatus.ACTIVE } });
    cinemaId = cinema.id;
    const auditorium = await prisma.auditorium.create({ data: { cinemaId: cinema.id, name: `API process race room ${fixture}` } });
    auditoriumId = auditorium.id;
    const seat = await prisma.seat.create({ data: { auditoriumId: auditorium.id, label: "R1", row: "R", column: 1, type: SeatType.STANDARD } });
    seatId = seat.id;
    const movie = await prisma.movie.create({ data: { slug: `api-process-race-${fixture}`, title: `API process race ${fixture}`, genre: "Test", synopsis: "Dedicated multi-process API seat-race fixture.", runtimeMinutes: 90, ageRating: "P", status: RecordStatus.ACTIVE } });
    movieId = movie.id;
    const startAt = new Date(Date.now() + 2 * 60 * 60_000);
    const showtime = await prisma.showtime.create({ data: { movieId: movie.id, auditoriumId: auditorium.id, startAt, endAt: new Date(startAt.getTime() + 90 * 60_000), priceVnd: 100_000, status: RecordStatus.ACTIVE } });
    showtimeId = showtime.id;

    const racers = Array.from({ length: 100 }, (_, index) => ({
      id: randomUUID(),
      name: `API process racer ${index}`,
      email: `api-process-race-${index}-${fixture}@test.local`,
      passwordHash: "unused-in-api-process-race-test",
      role: Role.CUSTOMER
    }));
    await prisma.user.createMany({ data: racers });
    userIds.push(...racers.map((user) => user.id));
    customerTokens = racers.map((user) => createToken({ id: user.id, authVersion: 0 }));

    await Promise.all([startApiProcess(spawnApiProcess()), startApiProcess(spawnApiProcess())]);
    if (apiProcesses[0]?.pid === apiProcesses[1]?.pid) throw new Error("The two API listeners must be independent operating-system processes.");
  }, 30_000);

  afterAll(async () => {
    const exitResults = await Promise.allSettled(apiProcesses.map((api) => stopApiProcess(api)));
    try {
      if (prisma && showtimeId) {
        const holds = await prisma.seatHold.findMany({ where: { showtimeId }, select: { id: true } });
        const holdIds = holds.map((hold) => hold.id);
        if (holdIds.length || userIds.length) {
          await prisma.auditLog.deleteMany({ where: { OR: [...(holdIds.length ? [{ entityId: { in: holdIds } }] : []), ...(userIds.length ? [{ actorId: { in: userIds } }] : [])] } });
        }
        await prisma.seatClaim.deleteMany({ where: { showtimeId } });
        await prisma.seatHold.deleteMany({ where: { showtimeId } });
        await prisma.showtime.deleteMany({ where: { id: showtimeId } });
      } else if (prisma && userIds.length) {
        await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      }
      if (prisma && movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
      if (prisma && seatId) await prisma.seat.deleteMany({ where: { id: seatId } });
      if (prisma && auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
      if (prisma && userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (prisma && cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
    } finally {
      await prisma?.$disconnect();
    }
    expect(exitResults.every((result) => result.status === "fulfilled" && result.value.code === 0)).toBe(true);
  });

  it("sends 100 customers across both API processes and persists only one seat claim", async () => {
    expect(apiProcesses).toHaveLength(2);
    expect(apiProcesses.every((api) => api.url && api.pid)).toBe(true);

    const responses = await Promise.all(customerTokens.map(async (token, index) => {
      const api = apiProcesses[index % apiProcesses.length]!;
      return fetch(`${api.url}/api/holds`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ showtimeId, seatIds: [seatId] })
      });
    }));
    const outcomes = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() as { error?: string } })));

    expect(outcomes.filter((result) => result.status === 201)).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 409)).toHaveLength(99);
    expect(outcomes.every((result) => result.status === 201 || result.status === 409)).toBe(true);

    const claims = await prisma!.seatClaim.findMany({ where: { showtimeId, seatId }, select: { status: true } });
    expect(claims).toEqual([{ status: "HELD" }]);
    expect(await prisma!.seatHold.count({ where: { showtimeId, status: "HELD" } })).toBe(1);
  }, 90_000);
});
