import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type MockPaymentEvent = {
  eventId: string;
  orderId: string;
  status: "SUCCEEDED" | "FAILED";
  amountVnd: number;
  currency: "VND";
};

export function canonicalMockPaymentEvent(event: MockPaymentEvent) {
  return JSON.stringify({
    eventId: event.eventId,
    orderId: event.orderId,
    status: event.status,
    amountVnd: event.amountVnd,
    currency: event.currency
  });
}

export function signMockPaymentEvent(event: MockPaymentEvent, secret: string) {
  return createHmac("sha256", secret).update(canonicalMockPaymentEvent(event)).digest("hex");
}

export function verifyMockPaymentSignature(event: MockPaymentEvent, signature: string | undefined, secret: string) {
  if (!signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const supplied = Buffer.from(signature, "hex");
  const expected = Buffer.from(signMockPaymentEvent(event, secret), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function mockPaymentPayloadHash(event: MockPaymentEvent) {
  return createHash("sha256").update(canonicalMockPaymentEvent(event)).digest("hex");
}
