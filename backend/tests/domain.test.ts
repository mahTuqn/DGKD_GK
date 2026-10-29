import { describe, expect, it } from "vitest";
import { test as propertyTest, fc } from "@fast-check/vitest";
import { calculateFillRatePercent, calendarDateAtTime, computeSeatPrice, DomainError, formatBusinessDate, getBusinessDate, isHoldActive, uniqueSeatIds } from "../src/domain/booking-policy.js";
import { mockPaymentPayloadHash, signMockPaymentEvent, verifyMockPaymentSignature, type MockPaymentEvent } from "../src/domain/mock-payment-signature.js";

const paymentEvent: MockPaymentEvent = {
  eventId: "evt-test-0001",
  orderId: "order-test-0001",
  status: "SUCCEEDED",
  amountVnd: 190_000,
  currency: "VND"
};

describe("REQ-PAY-02: mock payment signatures", () => {
  const secret = "test-only-secret-that-is-long-enough-32-chars";

  it("[TC-UNIT-01] accepts the correct HMAC-SHA256 signature", () => {
    expect(verifyMockPaymentSignature(paymentEvent, signMockPaymentEvent(paymentEvent, secret), secret)).toBe(true);
  });

  it("[TC-UNIT-02] rejects a missing, malformed, or tampered signature", () => {
    expect(verifyMockPaymentSignature(paymentEvent, undefined, secret)).toBe(false);
    expect(verifyMockPaymentSignature(paymentEvent, "not-a-signature", secret)).toBe(false);
    const validSignature = signMockPaymentEvent(paymentEvent, secret);
    expect(verifyMockPaymentSignature(paymentEvent, `${validSignature}g`, secret)).toBe(false);
    expect(verifyMockPaymentSignature(paymentEvent, `g${validSignature}`, secret)).toBe(false);
    const changedAmount = { ...paymentEvent, amountVnd: 1 };
    expect(verifyMockPaymentSignature(changedAmount, validSignature, secret)).toBe(false);
  });

  it("[TC-UNIT-03] hashes the signed event payload deterministically", () => {
    expect(mockPaymentPayloadHash(paymentEvent)).toBe(mockPaymentPayloadHash({ ...paymentEvent }));
    expect(mockPaymentPayloadHash(paymentEvent)).not.toBe(mockPaymentPayloadHash({ ...paymentEvent, eventId: "evt-test-0002" }));
  });
});

describe("REQ-BOOK-01..03: booking policy", () => {
  it("[TC-UNIT-04] converts Vietnam local showtime to UTC", () => {
    expect(calendarDateAtTime("2026-10-28", 14).toISOString()).toBe("2026-10-28T07:00:00.000Z");
    expect(calendarDateAtTime("2026-10-28", 19, 30).toISOString()).toBe("2026-10-28T12:30:00.000Z");
  });

  it("[TC-UNIT-08] treats a hold as expired at the exact stored deadline", () => {
    const now = new Date("2026-10-27T10:00:00.000Z");
    expect(isHoldActive(new Date(now.getTime() - 1), now)).toBe(false);
    expect(isHoldActive(now, now)).toBe(false);
    expect(isHoldActive(new Date(now.getTime() + 1), now)).toBe(true);
  });

  it("[TC-UNIT-05] prices premium seats in integer VND and does not surcharge accessible seats", () => {
    expect(computeSeatPrice(95_000, 30_000, "PREMIUM")).toBe(125_000);
    expect(computeSeatPrice(95_000, 30_000, "ACCESSIBLE")).toBe(95_000);
  });

  it("[TC-UNIT-06] rejects duplicate seat IDs and selections above the eight-seat limit", () => {
    expect(() => uniqueSeatIds(["seat-1", "seat-1"])).toThrow(DomainError);
    expect(() => uniqueSeatIds(Array.from({ length: 9 }, (_, index) => `seat-${index}`))).toThrow(DomainError);
  });
});

describe("REQ-REPORT-01: occupancy calculation", () => {
  it("[TC-UNIT-07] reports sold seats divided by the capacity of in-scope showtimes", () => {
    expect(calculateFillRatePercent(3, 8)).toBe(37.5);
    expect(calculateFillRatePercent(0, 0)).toBe(0);
    expect(() => calculateFillRatePercent(9, 8)).toThrow(DomainError);
  });

  it("[TC-UNIT-09] covers domain input boundaries and Vietnam date formatting", () => {
    const afterVietnamMidnight = new Date("2026-10-27T17:00:00.000Z");
    expect(getBusinessDate(afterVietnamMidnight)).toBe("2026-10-28");
    expect(getBusinessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatBusinessDate(afterVietnamMidnight)).toBe("2026-10-28");

    for (const [date, hour, minute] of [
      ["not-a-date", 12, 0],
      ["2026-02-29", 12, 0],
      ["2026-10-28", -1, 0],
      ["2026-10-28", 24, 0],
      ["2026-10-28", 12, -1],
      ["2026-10-28", 12, 60]
    ] as const) {
      expect(() => calendarDateAtTime(date, hour, minute)).toThrow(DomainError);
    }

    for (const [base, surcharge] of [[-1, 0], [Number.MAX_SAFE_INTEGER + 1, 0], [0, -1], [0, Number.MAX_SAFE_INTEGER + 1], [1.5, 0]] as const) {
      expect(() => computeSeatPrice(base, surcharge, "STANDARD")).toThrow(DomainError);
    }
    expect(uniqueSeatIds(["seat-1"])).toEqual(["seat-1"]);
    expect(uniqueSeatIds(Array.from({ length: 8 }, (_, index) => `seat-${index}`))).toHaveLength(8);
    expect(() => uniqueSeatIds([])).toThrow(DomainError);

    for (const [sold, capacity] of [[-1, 8], [1, -1], [1.5, 8], [9, 8]] as const) {
      expect(() => calculateFillRatePercent(sold, capacity)).toThrow(DomainError);
    }
  });
});

describe("Property-based domain invariants", () => {
  propertyTest.prop(
    { deltaMs: fc.integer({ min: -60_000, max: 60_000 }) },
    { numRuns: 200, seed: 20261027 }
  )("[TC-UNIT-10] considers a hold active exactly when its expiry is after now", ({ deltaMs }) => {
    const now = new Date("2026-10-27T10:00:00.000Z");
    expect(isHoldActive(new Date(now.getTime() + deltaMs), now)).toBe(deltaMs > 0);
  });

  propertyTest.prop(
    {
      base: fc.integer({ min: 0, max: 500_000 }),
      surcharge: fc.integer({ min: 0, max: 200_000 }),
      seatType: fc.constantFrom("STANDARD" as const, "PREMIUM" as const, "ACCESSIBLE" as const)
    },
    { numRuns: 200, seed: 20261028 }
  )("[TC-UNIT-11] prices generated seat inputs as safe integer VND", ({ base, surcharge, seatType }) => {
    const expected = base + (seatType === "PREMIUM" ? surcharge : 0);
    expect(computeSeatPrice(base, surcharge, seatType)).toBe(expected);
    expect(Number.isSafeInteger(expected)).toBe(true);
  });

  propertyTest.prop(
    { seatIds: fc.uniqueArray(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 8 }) },
    { numRuns: 200, seed: 20261029 }
  )("[TC-UNIT-12] preserves every valid unique seat selection in input order", ({ seatIds }) => {
    const input = seatIds.map((id) => `seat-${id}`);
    expect(uniqueSeatIds(input)).toEqual(input);
  });

  propertyTest.prop(
    {
      eventId: fc.string({ maxLength: 32 }),
      orderId: fc.string({ maxLength: 32 }),
      status: fc.constantFrom("SUCCEEDED" as const, "FAILED" as const),
      amountVnd: fc.integer({ min: 0, max: 49_999_999 })
    },
    { numRuns: 200, seed: 20261030 }
  )("[TC-UNIT-13] signs each payment event and rejects a changed amount", ({ eventId, orderId, status, amountVnd }) => {
    const event: MockPaymentEvent = { eventId, orderId, status, amountVnd, currency: "VND" };
    const secret = "property-test-secret-long-enough-for-hmac";
    const signature = signMockPaymentEvent(event, secret);
    expect(verifyMockPaymentSignature(event, signature, secret)).toBe(true);
    expect(verifyMockPaymentSignature({ ...event, amountVnd: amountVnd + 1 }, signature, secret)).toBe(false);
  });
});
