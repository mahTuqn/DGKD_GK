# CinemaBooking API

The API uses TypeScript, Express, Prisma, and PostgreSQL. The booking database is the source of truth for seat holds, orders, payments, and tickets.

## Local setup

From the repository root:

```powershell
Copy-Item backend/.env.example backend/.env
npm install
npm run db:up
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api
```

The example `DATABASE_URL` targets the project's Compose PostgreSQL service at `localhost:5434`; it does not use the default PostgreSQL port. The server requires that database to be running and migrations applied. `PORT` defaults to `4000`.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@cinema.local` | `CinemaCustomer123!` |
| Staff (Cinema Saigon Center) | `staff@cinema.local` | `CinemaStaff123!` |
| Admin | `admin@cinema.local` | `CinemaAdmin123!` |

The seed is safe to re-run: it upserts accounts, catalog, seats, and the next day's showtimes in `Asia/Ho_Chi_Minh`. Showtime IDs are database-generated; discover them through `GET /api/showtimes?date=YYYY-MM-DD`.

## Payment demo

The UI completes a mock payment through authenticated `POST /api/payments/mock/complete` with `{ "orderId": "...", "outcome": "SUCCEEDED" }`; `outcome` may also be `FAILED`. No card data is collected. A simulated provider callback can be sent to `POST /api/payments/mock/webhook` with a JSON body containing `eventId`, `orderId`, `status`, `amountVnd`, and `currency: "VND"`, signed in `x-mock-signature` as a hex HMAC-SHA256 of the canonical JSON object in that field order. The shared mock processor verifies amount/currency, persists provider event IDs, returns an existing outcome for identical retries, rejects event-ID reuse with changed content, and does not issue tickets for a late payment event.

Use independent random secrets of at least 32 characters for `JWT_SECRET` and `MOCK_PAYMENT_SECRET` outside local development. Never configure real payment credentials or send real card data to this mock adapter.

## API routes

- Public: `GET /api/health`, `/api/movies`, `/api/cinemas`, `/api/showtimes`, `/api/showtimes/:id/seats`
- Authentication: `POST /api/auth/register`, `POST /api/auth/login`, `GET/PATCH /api/auth/me`
- Customer: `POST /api/holds`, `POST /api/orders`, `POST /api/payments/mock/complete`, `GET /api/orders/me`, `GET /api/orders/:id`
- Payment callback: `POST /api/payments/mock/webhook`
- Staff/Admin: `POST /api/tickets/:ticketId/check-in`, `POST /api/tickets/scan`
- Admin: `GET /api/admin/summary`, `/api/admin/reports/occupancy`, `/api/admin/cinemas`, `/api/admin/movies`, `/api/admin/auditoriums`, `/api/admin/showtimes`, `/api/admin/users`; `POST /api/admin/cinemas`, `/api/admin/auditoriums`, `/api/admin/movies`, `/api/admin/showtimes`; `PATCH /api/admin/cinemas/:id`, `/api/admin/auditoriums/:id`, `/api/admin/seats/:id`, `/api/admin/movies/:id`, `/api/admin/showtimes/:id`, `/api/admin/users/:id/role`, `/api/admin/users/:id/assigned-cinema` (`{ "cinemaId": "..." }`; send `null` to unassign)

`GET /api/admin/summary` and `/api/admin/reports/occupancy` report fill rate as `soldSeats / capacitySeats * 100`. The denominator counts every seat in each active showtime in the requested start-time interval; the default interval begins at now and includes future showtimes only. `from` and `to` query parameters on the occupancy report are inclusive Vietnam-local calendar dates and must be supplied together. Report payloads expose both counts, percentage, and a definition string.

Cinema, auditorium, seat, movie, and showtime mutations require the Admin role, validate input, and write an `AuditLog` record. Admins assign a cinema to a staff member with `PATCH /api/admin/users/:id/assigned-cinema`; a null cinema unassigns them. Staff check-in is restricted to that cinema for both ticket-ID and QR routes; an unassigned Staff account cannot check in tickets. Admins can check in across all cinemas. The seed assigns the demo Staff account to Cinema Saigon Center. Auditorium creation includes its seat list in the request. A showtime's movie, room, and time cannot change while it has held or sold seats; seat layout fields cannot change while a seat is held or sold. Price updates remain available and existing orders retain their price snapshots.

Seat holds last five minutes by default (`HOLD_TTL_SECONDS`) and support 1–8 seats for one showtime. Amounts are integer VND. Error responses use `{ "error": "CODE", "message": "..." }`; invalid request bodies include a `details` field.

## Development checks

```powershell
npm run build --workspace backend
$env:DATABASE_URL_TEST = "postgresql://cinema:cinema_dev@localhost:5434/cinema?schema=public"
npm run test:api
```

The suite covers booking policy, payment signatures, occupancy math, hold expiration, and late-payment reconciliation; PostgreSQL-backed tests exercise 100 concurrent hold requests, claim uniqueness, duplicate payment callbacks, HTTP auth/RBAC, cross-customer order/ticket/QR ownership, worker expiration/outbox idempotency, check-in reuse, admin mutations, and occupancy reporting. Set `DATABASE_URL_TEST` to a migrated isolated test database; fixtures are uniquely named and cleaned after each run. Database-backed cases skip when the variable is absent. Load, a real five-minute TTL wait, worker restart/soak, and a full ZAP/OWASP review remain separate checks.
