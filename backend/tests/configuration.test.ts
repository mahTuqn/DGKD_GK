import { afterEach, describe, expect, it } from "vitest";
import { assertMockPaymentConfiguration, createApp, getRegistrationRateLimit } from "../src/app.js";
import { assertAuthenticationConfiguration } from "../src/auth.js";

const environmentKeys = ["NODE_ENV", "JWT_SECRET", "MOCK_PAYMENT_SECRET", "TRUST_PROXY_HOPS", "E2E_REGISTRATION_RATE_LIMIT"] as const;
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

  it("keeps five registrations per window by default and ignores the E2E override in production", () => {
    expect(getRegistrationRateLimit({ NODE_ENV: "test" })).toBe(5);
    expect(getRegistrationRateLimit({ NODE_ENV: "development", E2E_REGISTRATION_RATE_LIMIT: "100" })).toBe(100);
    expect(getRegistrationRateLimit({ NODE_ENV: "production", E2E_REGISTRATION_RATE_LIMIT: "100" })).toBe(5);
    expect(() => getRegistrationRateLimit({ NODE_ENV: "test", E2E_REGISTRATION_RATE_LIMIT: "0" })).toThrow("positive integer");
    expect(() => getRegistrationRateLimit({ NODE_ENV: "test", E2E_REGISTRATION_RATE_LIMIT: "1001" })).toThrow("no greater than 1000");
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
