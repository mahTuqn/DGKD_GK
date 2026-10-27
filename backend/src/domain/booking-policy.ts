export const HOLD_TTL_SECONDS = Math.max(60, Math.min(900, Number(process.env.HOLD_TTL_SECONDS) || 300));
export const MAX_SEATS_PER_ORDER = 8;

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422) {
    super(message);
  }
}

export function isHoldActive(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() > now.getTime();
}

export function getBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function calendarDateAtTime(date: string, hour: number, minute = 0): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new DomainError("INVALID_DATE", "Ngày hoặc giờ không hợp lệ.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day!));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month! - 1 || calendar.getUTCDate() !== day) {
    throw new DomainError("INVALID_DATE", "Ngày lịch không tồn tại.");
  }
  return new Date(Date.UTC(year!, month! - 1, day!, hour - 7, minute));
}

export function formatBusinessDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export function computeSeatPrice(basePriceVnd: number, premiumSurchargeVnd: number, seatType: "STANDARD" | "PREMIUM" | "ACCESSIBLE"): number {
  if (!Number.isSafeInteger(basePriceVnd) || !Number.isSafeInteger(premiumSurchargeVnd) || basePriceVnd < 0 || premiumSurchargeVnd < 0) {
    throw new DomainError("INVALID_PRICE", "Giá vé không hợp lệ.");
  }
  return basePriceVnd + (seatType === "PREMIUM" ? premiumSurchargeVnd : 0);
}

export function uniqueSeatIds(seatIds: string[]): string[] {
  const unique = [...new Set(seatIds)];
  if (unique.length !== seatIds.length) throw new DomainError("DUPLICATE_SEATS", "Danh sách có ghế bị lặp.");
  if (unique.length < 1 || unique.length > MAX_SEATS_PER_ORDER) {
    throw new DomainError("INVALID_SEAT_COUNT", `Mỗi lượt chỉ được chọn từ 1 đến ${MAX_SEATS_PER_ORDER} ghế.`);
  }
  return unique;
}

export function calculateFillRatePercent(soldSeats: number, capacitySeats: number): number {
  if (!Number.isSafeInteger(soldSeats) || !Number.isSafeInteger(capacitySeats) || soldSeats < 0 || capacitySeats < 0 || soldSeats > capacitySeats) {
    throw new DomainError("INVALID_OCCUPANCY", "Số ghế đã bán và sức chứa không hợp lệ.");
  }
  if (capacitySeats === 0) return 0;
  return Math.round((soldSeats / capacitySeats) * 10_000) / 100;
}
