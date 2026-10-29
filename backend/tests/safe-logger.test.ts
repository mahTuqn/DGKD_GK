import { afterEach, describe, expect, it, vi } from "vitest";
import { logSafeError } from "../src/safe-logger.js";

describe("REQ-SEC-01 safe application error logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("[TC-PLAN-05] logs correlation metadata without error messages or stacks", () => {
    const secret = "sentinel-password-or-provider-token-should-not-be-logged";
    const error = new Error(secret);
    error.stack = `Error: ${secret}\n    at hidden-frame`;
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logSafeError("http_unhandled_error", "request-correlation-123", error);

    expect(logger).toHaveBeenCalledTimes(1);
    const output = String(logger.mock.calls[0]?.[0]);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("hidden-frame");
    expect(JSON.parse(output)).toMatchObject({
      level: "error",
      event: "http_unhandled_error",
      correlationId: "request-correlation-123",
      errorKind: "Error"
    });
  });
});
