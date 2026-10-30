import { afterEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { assertMockPaymentConfiguration, createApp, getMutationRateLimit, getRegistrationRateLimit, isMockPaymentCompletionEnabled } from "../src/app.js";
import { assertAuthenticationConfiguration } from "../src/auth.js";
import { prisma } from "../src/db.js";

const environmentKeys = ["NODE_ENV", "JWT_SECRET", "MOCK_PAYMENT_SECRET", "TRUST_PROXY_HOPS", "CORS_ORIGIN", "E2E_REGISTRATION_RATE_LIMIT", "E2E_MUTATION_RATE_LIMIT"] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

function restoreEnvironment() {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("TC-SEC-13 deployment secrets and trusted proxy configuration", () => {
  afterEach(restoreEnvironment);

  it("allows customer-triggered mock payment only in explicit development and test modes", () => {
    for (const mode of ["development", "test"]) {
      expect(isMockPaymentCompletionEnabled({ NODE_ENV: mode })).toBe(true);
    }

    for (const mode of ["production", "staging", "preview", undefined]) {
      expect(isMockPaymentCompletionEnabled({ NODE_ENV: mode })).toBe(false);
    }
  });

  it("keeps five registrations per window by default and ignores the E2E override in production", () => {
    expect(getRegistrationRateLimit({ NODE_ENV: "test" })).toBe(5);
    expect(getRegistrationRateLimit({ NODE_ENV: "development", E2E_REGISTRATION_RATE_LIMIT: "100" })).toBe(100);
    expect(getRegistrationRateLimit({ NODE_ENV: "production", E2E_REGISTRATION_RATE_LIMIT: "100" })).toBe(5);
    expect(() => getRegistrationRateLimit({ NODE_ENV: "test", E2E_REGISTRATION_RATE_LIMIT: "0" })).toThrow("positive integer");
    expect(() => getRegistrationRateLimit({ NODE_ENV: "test", E2E_REGISTRATION_RATE_LIMIT: "1001" })).toThrow("no greater than 1000");
  });

  it("limits sensitive mutations and ignores test overrides outside development/test", () => {
    expect(getMutationRateLimit({ NODE_ENV: "production", E2E_MUTATION_RATE_LIMIT: "2" })).toBe(120);
    expect(getMutationRateLimit({ NODE_ENV: "staging", E2E_MUTATION_RATE_LIMIT: "2" })).toBe(120);
    expect(getMutationRateLimit({ NODE_ENV: undefined, E2E_MUTATION_RATE_LIMIT: "2" })).toBe(120);
    expect(getMutationRateLimit({ NODE_ENV: "production" }, 300)).toBe(300);
    expect(getMutationRateLimit({ NODE_ENV: "development" })).toBe(120);
    expect(getMutationRateLimit({ NODE_ENV: "test" })).toBe(1000);
    expect(getMutationRateLimit({ NODE_ENV: "test", E2E_MUTATION_RATE_LIMIT: "2" })).toBe(2);
    expect(() => getMutationRateLimit({ NODE_ENV: "test", E2E_MUTATION_RATE_LIMIT: "0" })).toThrow("positive integer");
    expect(() => getMutationRateLimit({ NODE_ENV: "test", E2E_MUTATION_RATE_LIMIT: "1001" })).toThrow("no greater than 1000");
  });

  it("requires a long JWT secret in deployment modes and rejects published development/CI values", () => {
    const deploymentModes = ["production", "staging", "preview", undefined];
    for (const mode of deploymentModes) {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;

      delete process.env.JWT_SECRET;
      expect(assertAuthenticationConfiguration).toThrow("JWT_SECRET must be configured");

      process.env.JWT_SECRET = "short-secret";
      expect(assertAuthenticationConfiguration).toThrow("JWT_SECRET must be configured");

      for (const secret of [
        "cinema-booking-local-secret-change-before-deploy-2026",
        "local-development-secret-change-before-deployment",
        "ci-only-secret-change-before-deployment",
      ]) {
        process.env.JWT_SECRET = secret;
        expect(assertAuthenticationConfiguration).toThrow("published development or CI value");
      }

      process.env.JWT_SECRET = "a".repeat(64);
      expect(assertAuthenticationConfiguration).not.toThrow();
    }

    for (const mode of ["development", "test"]) {
      process.env.NODE_ENV = mode;
      delete process.env.JWT_SECRET;
      expect(assertAuthenticationConfiguration).not.toThrow();
    }
  });

  it("requires a long mock-payment secret in deployment modes and rejects published development/CI values", () => {
    const deploymentModes = ["production", "staging", "preview", undefined];
    for (const mode of deploymentModes) {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;

      delete process.env.MOCK_PAYMENT_SECRET;
      expect(assertMockPaymentConfiguration).toThrow("MOCK_PAYMENT_SECRET must be configured");

      process.env.MOCK_PAYMENT_SECRET = "short-secret";
      expect(assertMockPaymentConfiguration).toThrow("MOCK_PAYMENT_SECRET must be configured");

      for (const secret of [
        "cinema-booking-local-mock-payment-secret-2026",
        "local-mock-webhook-secret-change-before-deployment-2026",
        "ci-only-webhook-secret",
      ]) {
        process.env.MOCK_PAYMENT_SECRET = secret;
        expect(assertMockPaymentConfiguration).toThrow("published development or CI value");
      }

      process.env.MOCK_PAYMENT_SECRET = "b".repeat(64);
      expect(assertMockPaymentConfiguration).not.toThrow();
    }

    for (const mode of ["development", "test"]) {
      process.env.NODE_ENV = mode;
      delete process.env.MOCK_PAYMENT_SECRET;
      expect(assertMockPaymentConfiguration).not.toThrow();
    }
  });

  it("trusts exactly the configured proxy hops for client-IP rate limiting", () => {
    process.env.TRUST_PROXY_HOPS = "1";
    const app = createApp();
    const trustProxy = app.get("trust proxy fn") as (address: string, hopIndex: number) => boolean;

    expect(app.get("trust proxy")).toBe(1);
    expect(trustProxy("10.0.0.3", 0)).toBe(true);
    expect(trustProxy("198.51.100.7", 1)).toBe(false);
  });

  it("defaults to no trusted proxy and rejects invalid hop counts", () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(createApp().get("trust proxy")).toBe(0);

    for (const value of ["-1", "1.5", "true"]) {
      process.env.TRUST_PROXY_HOPS = value;
      expect(() => createApp()).toThrow("TRUST_PROXY_HOPS must be a non-negative integer");
    }
  });
});

describe("TC-SEC-48 HTTP security middleware and safe parser errors", () => {
  afterEach(restoreEnvironment);

  it("sets security headers and only grants CORS access to configured origins", async () => {
    process.env.CORS_ORIGIN = "https://cinema.example";
    const app = createApp();

    const allowed = await request(app).get("/api/health").set("Origin", "https://cinema.example");
    expect(allowed.status).toBe(200);
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(allowed.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(allowed.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(allowed.headers["cache-control"]).toBe("no-store");
    expect(allowed.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://cinema.example");

    const preflight = await request(app)
      .options("/api/auth/me")
      .set("Origin", "https://cinema.example")
      .set("Access-Control-Request-Method", "GET");
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://cinema.example");

    const hostile = await request(app).get("/api/health").set("Origin", "https://attacker.example");
    expect(hostile.status).toBe(200);
    expect(hostile.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns safe 400 and 413 responses for malformed and over-limit JSON", async () => {
    const app = createApp();
    const malformed = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send('{"name":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("INVALID_JSON");
    expect(JSON.stringify(malformed.body)).not.toMatch(/stack|SyntaxError|node_modules/i);

    const oversized = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ name: "A", padding: "x".repeat(66 * 1024) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toBe("PAYLOAD_TOO_LARGE");
    expect(JSON.stringify(oversized.body)).not.toMatch(/stack|PayloadTooLargeError|node_modules/i);
  });
});

describe("TC-SEC-49 JWT session lifetime enforcement", () => {
  afterEach(() => {
    restoreEnvironment();
    vi.restoreAllMocks();
  });

  it("rejects signed tokens without exp or beyond the eight-hour maximum age before loading a user", async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "tc-sec-49-session-policy-test-secret-32chars";
    const userId = "00000000-0000-4000-8000-000000000049";
    const userLookup = vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: userId,
      name: "JWT policy test",
      email: "jwt-policy@test.local",
      role: "CUSTOMER",
      assignedCinemaId: null,
      authVersion: 0
    } as never);
    const app = createApp();
    const options = { issuer: "cinema-booking", subject: userId };
    const now = Math.floor(Date.now() / 1000);
    const missingExpiry = jwt.sign({ authVersion: 0 }, process.env.JWT_SECRET, options);
    const olderThanMaximumAge = jwt.sign(
      { authVersion: 0, iat: now - 9 * 60 * 60, exp: now + 60 * 60 },
      process.env.JWT_SECRET,
      options
    );

    for (const token of [missingExpiry, olderThanMaximumAge]) {
      const response = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("INVALID_TOKEN");
      expect(JSON.stringify(response.body)).not.toMatch(/stack|JsonWebTokenError|node_modules/i);
    }
    expect(userLookup).not.toHaveBeenCalled();

    const validWithinLifetime = jwt.sign({ authVersion: 0 }, process.env.JWT_SECRET, { ...options, expiresIn: "8h" });
    const accepted = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${validWithinLifetime}`);
    expect(accepted.status).toBe(200);
    expect(userLookup).toHaveBeenCalledOnce();
  });
});
