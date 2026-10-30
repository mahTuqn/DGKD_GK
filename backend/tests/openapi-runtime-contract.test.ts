import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

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
});
