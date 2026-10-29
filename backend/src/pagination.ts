import { z } from "zod";
import { DomainError } from "./domain/booking-policy.js";

export const collectionPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(256).optional()
}).strict();

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().min(1).max(128)
}).strict();

export type CollectionCursor = { createdAt: Date; id: string };

export function encodeCollectionCursor(cursor: CollectionCursor) {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), "utf8").toString("base64url");
}

export function decodeCollectionCursor(value: string | undefined): CollectionCursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url cursor");
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) throw new Error("Non-canonical cursor");
    const parsed = cursorPayloadSchema.parse(JSON.parse(decoded));
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new DomainError("INVALID_CURSOR", "Con trỏ phân trang không hợp lệ.", 422);
  }
}
