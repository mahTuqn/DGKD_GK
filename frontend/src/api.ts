const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export type Role = "CUSTOMER" | "STAFF" | "ADMIN";
export type RecordStatus = "ACTIVE" | "INACTIVE";
export type Session = { token: string; user: { id: string; name: string; email: string; role: Role } };
export type Movie = {
  id: string; title: string; slug?: string; genre: string; synopsis: string; runtimeMinutes: number;
  ageRating: string; posterUrl?: string | null; releaseDate?: string | null; status?: RecordStatus;
};
export type Showtime = {
  id: string; movieId: string; movieTitle: string; cinemaId: string; cinemaName: string;
  city?: string; auditoriumName: string; startAt: string; endAt: string; date: string; priceVnd: number;
  premiumSurchargeVnd?: number; screenType?: string; status?: RecordStatus;
};
export type Seat = {
  id: string; label: string; row: string; column: number; type: string;
  status: "AVAILABLE" | "HELD" | "SOLD"; isAccessible?: boolean; priceVnd?: number;
};
export type SeatMap = { showtime: Partial<Showtime> & Pick<Showtime, "id" | "movieTitle" | "cinemaName" | "auditoriumName" | "startAt" | "endAt" | "date" | "priceVnd">; seats: Seat[] };
export type Hold = { id: string; showtimeId: string; seatIds: string[]; expiresAt: string; totalVnd: number; status: string };
export type Ticket = { id: string; qrToken: string; checkedInAt: string | null };
export type Order = {
  id: string; status: string; totalVnd: number; createdAt: string; showtime: Showtime;
  seats: Array<{ seatId: string; label: string }>; tickets: Ticket[];
};
export type SeatType = "STANDARD" | "PREMIUM" | "ACCESSIBLE";
export type AdminCinema = { id: string; name: string; city: string; address: string; status: RecordStatus; auditoriums?: Array<{ id: string; name: string; screenType: string; seatCount: number }> };
export type AdminAuditorium = { id: string; name: string; screenType: string; cinemaId: string; cinemaName?: string; seatCount?: number; seats?: Array<Pick<Seat, "id" | "label" | "row" | "column" | "type" | "isAccessible">> };
export type AdminOccupancy = { showtimeCount: number; soldSeats: number; capacitySeats: number; fillRatePercent: number; definition: string; periodStart?: string; periodEnd?: string | null };
export type AdminSummary = { movies: number; showtimes: number; orders: number; tickets: number; confirmedRevenueVnd: number; occupancy?: AdminOccupancy };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "REQUEST_FAILED") {
    super(message); this.name = "ApiError"; this.status = status; this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.message || body.error || "Có lỗi xảy ra. Vui lòng thử lại.", response.status, body.code || body.error || "REQUEST_FAILED");
  return body as T;
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body) });

export const api = {
  movies: () => request<Movie[]>("/movies"),
  showtimes: (filters: { movieId?: string; date: string; cinemaId?: string }) => {
    const params = new URLSearchParams({ date: filters.date });
    if (filters.movieId) params.set("movieId", filters.movieId);
    if (filters.cinemaId) params.set("cinemaId", filters.cinemaId);
    return request<Showtime[]>(`/showtimes?${params}`);
  },
  seats: (showtimeId: string) => request<SeatMap>(`/showtimes/${encodeURIComponent(showtimeId)}/seats`),
  login: (email: string, password: string) => request<Session>("/auth/login", post({ email, password })),
  register: (name: string, email: string, password: string) => request<Session>("/auth/register", post({ name, email, password })),
  me: (token: string) => request<Session["user"]>("/auth/me", {}, token),
  createHold: (token: string, showtimeId: string, seatIds: string[]) => request<Hold>("/holds", post({ showtimeId, seatIds }), token),
  createOrder: (token: string, holdId: string) => request<Order>("/orders", post({ holdId }), token),
  payDemo: (token: string, orderId: string) => request<{ orderId: string; status: string; totalVnd: number; tickets: Ticket[] }>("/payments/mock/complete", post({ orderId }), token),
  orders: (token: string) => request<Order[]>("/orders/me", {}, token),
  checkIn: (token: string, ticketId: string) => request<{ ticketId: string; status: string; checkedInAt: string }>(`/tickets/${encodeURIComponent(ticketId)}/check-in`, post({}), token),
  scanQr: (token: string, qrToken: string) => request<{ ticketId: string; checkedInAt: string; seat: string; movieTitle: string; cinemaName: string }>("/tickets/scan", post({ qrToken }), token),
  adminSummary: (token: string) => request<AdminSummary>("/admin/summary", {}, token),
  adminMovies: (token: string) => request<Movie[]>("/admin/movies", {}, token),
  createMovie: (token: string, input: Omit<Movie, "id">) => request<Movie>("/admin/movies", post(input), token),
  updateMovie: (token: string, id: string, input: Partial<Pick<Movie, "title" | "slug" | "genre" | "synopsis" | "runtimeMinutes" | "ageRating" | "posterUrl" | "releaseDate" | "status">>) => request<Movie>(`/admin/movies/${encodeURIComponent(id)}`, patch(input), token),
  adminCinemas: (token: string) => request<AdminCinema[]>("/admin/cinemas", {}, token),
  createCinema: (token: string, input: { name: string; city: string; address: string }) => request<AdminCinema>("/admin/cinemas", post(input), token),
  updateCinema: (token: string, id: string, input: Partial<Pick<AdminCinema, "name" | "city" | "address" | "status">>) => request<AdminCinema>(`/admin/cinemas/${encodeURIComponent(id)}`, patch(input), token),
  auditoriums: (token: string) => request<AdminAuditorium[]>("/admin/auditoriums", {}, token),
  createAuditorium: (token: string, input: { cinemaId: string; name: string; screenType?: string; seats: Array<{ label: string; row: string; column: number; type?: SeatType; isAccessible?: boolean }> }) => request<AdminAuditorium>("/admin/auditoriums", post(input), token),
  updateAuditorium: (token: string, id: string, input: Partial<Pick<AdminAuditorium, "name" | "screenType">>) => request<AdminAuditorium>(`/admin/auditoriums/${encodeURIComponent(id)}`, patch(input), token),
  updateSeat: (token: string, id: string, input: Partial<Pick<Seat, "label" | "row" | "column" | "type" | "isAccessible">>) => request<Seat>(`/admin/seats/${encodeURIComponent(id)}`, patch(input), token),
  adminShowtimes: (token: string) => request<Showtime[]>("/admin/showtimes", {}, token),
  createShowtime: (token: string, input: { movieId: string; auditoriumId: string; startAt: string; priceVnd: number }) => request<Showtime>("/admin/showtimes", post(input), token),
  updateShowtime: (token: string, id: string, input: Partial<Pick<Showtime, "movieId" | "startAt" | "priceVnd" | "premiumSurchargeVnd" | "status"> & { auditoriumId: string }>) => request<Showtime>(`/admin/showtimes/${encodeURIComponent(id)}`, patch(input), token)
};

export const formatVnd = (amount: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);

export function businessDateOffset(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (key: string) => Number(parts.find((entry) => entry.type === key)?.value);
  const base = Date.UTC(part("year"), part("month") - 1, part("day") + days);
  return new Date(base).toISOString().slice(0, 10);
}
