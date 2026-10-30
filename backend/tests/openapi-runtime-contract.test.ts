import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import { RecordStatus, Role, SeatType } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

type OpenApiOperation = {
  responses: Record<string, {
    content?: Record<string, { schema?: object }>;
  }>;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation | undefined> | undefined>;
};

const testFilePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(testFilePath), "../..");
const databaseContractDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;
const previousEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
};

let app: ReturnType<typeof createApp>;
let openApi: OpenApiDocument;
let bundleDirectory: string | undefined;
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

function loadBundledOpenApi(): OpenApiDocument {
  bundleDirectory = mkdtempSync(resolve(tmpdir(), "cinema-openapi-runtime-"));
  const bundlePath = resolve(bundleDirectory, "openapi.json");
  const redoclyCli = resolve(repositoryRoot, "node_modules/@redocly/cli/bin/cli.js");
  const bundleResult = spawnSync(process.execPath, [
    redoclyCli,
    "bundle",
    resolve(repositoryRoot, "docs/openapi.yaml"),
    "--dereferenced",
    "--ext",
    "json",
    "--output",
    bundlePath,
    "--config",
    resolve(repositoryRoot, "redocly.yaml"),
  ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });

  if (bundleResult.error || bundleResult.status !== 0) {
    rmSync(bundleDirectory, { recursive: true, force: true });
    bundleDirectory = undefined;
    throw new Error(`Could not bundle OpenAPI for runtime response checks: ${bundleResult.error?.message ?? bundleResult.stderr}`);
  }

  return JSON.parse(readFileSync(bundlePath, "utf8")) as OpenApiDocument;
}

function expectResponseMatchesOpenApi(path: string, method: string, status: number, body: unknown) {
  const operation = openApi.paths[path]?.[method.toLowerCase()];
  expect(operation, `OpenAPI must describe ${method.toUpperCase()} ${path}`).toBeDefined();
  const response = operation!.responses[String(status)];
  expect(response, `OpenAPI must describe HTTP ${status} for ${method.toUpperCase()} ${path}`).toBeDefined();
  const schema = response!.content?.["application/json"]?.schema;
  expect(schema, `OpenAPI must define an application/json schema for HTTP ${status} ${method.toUpperCase()} ${path}`).toBeDefined();

  const validate = ajv.compile(schema!);
  expect(validate(body), `${method.toUpperCase()} ${path} ${status} response violates OpenAPI: ${JSON.stringify(validate.errors)}`).toBe(true);
}

describe("runtime API response contracts against docs/openapi.yaml", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "runtime-openapi-contract-test-secret-32chars";
    openApi = loadBundledOpenApi();
    app = createApp();
  });

  afterAll(() => {
    if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("validates the live health response against its documented 200 schema", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expectResponseMatchesOpenApi("/api/health", "get", response.status, response.body);
  });

  it("validates representative P0 authentication, booking, and payment error responses", async () => {
    const invalidRegistration = await request(app)
      .post("/api/auth/register")
      .send({ name: "A", email: "not-an-email", password: "x" });
    expect(invalidRegistration.status).toBe(422);
    expectResponseMatchesOpenApi("/api/auth/register", "post", invalidRegistration.status, invalidRegistration.body);

    const unauthenticatedRequests = [
      { path: "/api/holds", body: { showtimeId: "contract-showtime", seatIds: ["contract-seat"] } },
      { path: "/api/orders", body: { holdId: "contract-hold" } },
      { path: "/api/payments/mock/complete", body: { orderId: "contract-order", outcome: "SUCCEEDED" } },
    ];

    for (const route of unauthenticatedRequests) {
      const response = await request(app).post(route.path).send(route.body);
      expect(response.status).toBe(401);
      expectResponseMatchesOpenApi(route.path, "post", response.status, response.body);
    }
  });

  databaseContractDescribe("DB-backed P0 booking success response contracts", () => {
    const fixture = randomUUID();
    let cinemaId: string | undefined;
    let auditoriumId: string | undefined;
    let seatId: string | undefined;
    let movieId: string | undefined;
    let showtimeId: string | undefined;
    let customerId: string | undefined;
    let authorization: string | undefined;

    beforeAll(async () => {
      await prisma.$connect();
      const cinema = await prisma.cinema.create({
        data: { name: `Contract ${fixture}`, city: "Test", address: "Isolated contract fixture", status: RecordStatus.ACTIVE }
      });
      cinemaId = cinema.id;

      const auditorium = await prisma.auditorium.create({
        data: { cinemaId: cinema.id, name: `Contract room ${fixture}`, screenType: "TEST" }
      });
      auditoriumId = auditorium.id;

      const seat = await prisma.seat.create({
        data: { auditoriumId: auditorium.id, label: "A1", row: "A", column: 1, type: SeatType.STANDARD }
      });
      seatId = seat.id;

      const movie = await prisma.movie.create({
        data: {
          slug: `contract-${fixture}`,
          title: `Contract fixture ${fixture}`,
          genre: "Test",
          synopsis: "Temporary data for OpenAPI response contract assertions.",
          runtimeMinutes: 90,
          ageRating: "P"
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
          priceVnd: 90_000
        }
      });
      showtimeId = showtime.id;

      const customer = await prisma.user.create({
        data: {
          name: "OpenAPI Contract Customer",
          email: `openapi-contract-${fixture}@test.local`,
          passwordHash: "unused-openapi-contract-test-password-hash",
          role: Role.CUSTOMER
        }
      });
      customerId = customer.id;
      authorization = `Bearer ${createToken({ id: customer.id, authVersion: customer.authVersion })}`;
    }, 30_000);

    afterAll(async () => {
      try {
        if (showtimeId) {
          const orders = await prisma.cinemaOrder.findMany({ where: { showtimeId }, select: { id: true } });
          const orderIds = orders.map((order) => order.id);
          const holds = await prisma.seatHold.findMany({ where: { showtimeId }, select: { id: true } });
          const holdIds = holds.map((hold) => hold.id);
          const entityIds = [...orderIds, ...holdIds];

          if (entityIds.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
          if (orderIds.length) {
            await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.reconciliationCase.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
            await prisma.paymentEvent.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.seatClaim.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.cinemaOrder.deleteMany({ where: { id: { in: orderIds } } });
          }
          await prisma.seatClaim.deleteMany({ where: { showtimeId } });
          await prisma.seatHold.deleteMany({ where: { showtimeId } });
          await prisma.showtime.deleteMany({ where: { id: showtimeId } });
        }
        if (customerId) await prisma.auditLog.deleteMany({ where: { actorId: customerId } });
        if (customerId) await prisma.user.deleteMany({ where: { id: customerId } });
        if (movieId) await prisma.movie.deleteMany({ where: { id: movieId } });
        if (seatId) await prisma.seat.deleteMany({ where: { id: seatId } });
        if (auditoriumId) await prisma.auditorium.deleteMany({ where: { id: auditoriumId } });
        if (cinemaId) await prisma.cinema.deleteMany({ where: { id: cinemaId } });
      } finally {
        await prisma.$disconnect();
      }
    }, 30_000);

    it("validates successful hold, order, payment, and paginated order responses", async () => {
      const auth = { Authorization: authorization! };
      const hold = await request(app)
        .post("/api/holds")
        .set(auth)
        .send({ showtimeId: showtimeId!, seatIds: [seatId!] });
      expect(hold.status).toBe(201);
      expectResponseMatchesOpenApi("/api/holds", "post", hold.status, hold.body);
      expect(hold.body).toMatchObject({ showtimeId, seatIds: [seatId], totalVnd: 90_000, status: "HELD" });

      const order = await request(app).post("/api/orders").set(auth).send({ holdId: hold.body.id });
      expect(order.status).toBe(201);
      expectResponseMatchesOpenApi("/api/orders", "post", order.status, order.body);
      expect(order.body).toMatchObject({ id: expect.any(String), status: "PAYMENT_PENDING", totalVnd: 90_000, tickets: [] });

      const payment = await request(app)
        .post("/api/payments/mock/complete")
        .set(auth)
        .send({ orderId: order.body.id, outcome: "SUCCEEDED" });
      expect(payment.status).toBe(200);
      expectResponseMatchesOpenApi("/api/payments/mock/complete", "post", payment.status, payment.body);
      expect(payment.body).toMatchObject({ orderId: order.body.id, status: "CONFIRMED", totalVnd: 90_000 });
      expect(payment.body.tickets).toHaveLength(1);

      const orderPage = await request(app).get("/api/orders/me?limit=10").set(auth);
      expect(orderPage.status).toBe(200);
      expectResponseMatchesOpenApi("/api/orders/me", "get", orderPage.status, orderPage.body);
      expect(orderPage.body.items).toHaveLength(1);
      expect(orderPage.body.items[0]).toMatchObject({
        id: order.body.id,
        status: "CONFIRMED",
        totalVnd: 90_000,
        tickets: [{ id: payment.body.tickets[0].id, seatLabel: "A1" }]
      });
      expect(orderPage.body.nextCursor).toBeNull();
    }, 30_000);
  });
});
