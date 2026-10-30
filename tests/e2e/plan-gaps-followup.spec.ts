import { expect, test, type Route } from "@playwright/test";

const movie = {
  id: "lost-response-movie",
  slug: "lost-response-feature",
  title: "Lost Response Feature",
  genre: "Drama",
  synopsis: "Fixture for payment response-loss recovery.",
  runtimeMinutes: 100,
  ageRating: "P",
  posterUrl: null,
  releaseDate: "2026-01-01",
  status: "ACTIVE",
};

const showtime = {
  id: "lost-response-showtime",
  movieId: movie.id,
  movieTitle: movie.title,
  cinemaId: "lost-response-cinema",
  cinemaName: "Recovery Cinema",
  city: "Test City",
  auditoriumName: "Recovery Room",
  startAt: "2026-11-30T11:00:00.000Z",
  endAt: "2026-11-30T12:40:00.000Z",
  date: "2026-11-30",
  priceVnd: 85_000,
  premiumSurchargeVnd: 30_000,
  screenType: "STANDARD",
  status: "ACTIVE",
};

const seat = {
  id: "lost-response-seat",
  label: "A1",
  row: "A",
  column: 1,
  type: "STANDARD",
  status: "AVAILABLE" as const,
  isAccessible: false,
  priceVnd: showtime.priceVnd,
};

const orderId = "lost-response-order";
const ticket = { id: "tix-00000001", qrToken: "fixture-qr-lost-response", checkedInAt: null };
const orderBase = {
  id: orderId,
  totalVnd: showtime.priceVnd,
  createdAt: "2026-10-28T00:00:00.000Z",
  showtime,
  seats: [{ seatId: seat.id, label: seat.label, row: seat.row, column: seat.column, type: seat.type, priceVnd: showtime.priceVnd }],
};

const expectedLostResponseCopy = "Không nhận được phản hồi thanh toán. Giao dịch có thể đã được ghi nhận; hãy thử lại để kiểm tra trạng thái.";

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("[TC-E2E-19] thanh toán đã ghi nhận nhưng mất phản hồi có thể thử lại an toàn", async ({ page }) => {
  const paymentOrderIds: string[] = [];
  let paymentCommitted = false;
  let ticketCreationCount = 0;
  let idempotentReplayCount = 0;
  let lostResponseAlertText = "";
  let orderListRequests = 0;

  await page.addInitScript(() => {
    localStorage.setItem("cinemabooking.session", JSON.stringify({
      token: "lost-response-customer-token",
      user: { id: "lost-response-customer", name: "Payment Recovery Customer", email: "recovery@example.test", role: "CUSTOMER" },
    }));
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (request.method() === "GET" && pathname === "/api/movies") {
      await fulfillJson(route, 200, [movie]);
    } else if (request.method() === "GET" && pathname === "/api/showtimes") {
      await fulfillJson(route, 200, [showtime]);
    } else if (request.method() === "GET" && pathname === `/api/showtimes/${showtime.id}/seats`) {
      await fulfillJson(route, 200, { showtime, seats: [seat] });
    } else if (request.method() === "POST" && pathname === "/api/holds") {
      const input = request.postDataJSON() as { showtimeId: string; seatIds: string[] };
      await fulfillJson(route, 201, {
        id: "lost-response-hold",
        showtimeId: input.showtimeId,
        seatIds: input.seatIds,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        totalVnd: showtime.priceVnd,
        status: "HELD",
      });
    } else if (request.method() === "POST" && pathname === "/api/orders") {
      await fulfillJson(route, 201, { ...orderBase, status: "PAYMENT_PENDING", tickets: [] });
    } else if (request.method() === "POST" && pathname === "/api/payments/mock/complete") {
      const input = request.postDataJSON() as { orderId: string };
      paymentOrderIds.push(input.orderId);

      if (!paymentCommitted) {
        // The payment service commits once, creates one ticket, then the browser loses its response.
        paymentCommitted = true;
        ticketCreationCount += 1;
        await route.abort("connectionreset");
        return;
      }

      // Retrying the same order returns the already-created result without another ticket.
      idempotentReplayCount += 1;
      await fulfillJson(route, 200, {
        orderId,
        status: "CONFIRMED",
        totalVnd: showtime.priceVnd,
        tickets: [ticket],
      });
    } else if (request.method() === "GET" && pathname === "/api/orders/me") {
      orderListRequests += 1;
      if (orderListRequests <= 2) {
        // Payment is confirmed, but both the initial list fetch and automatic retry fail.
        await fulfillJson(route, 503, { error: "SERVICE_UNAVAILABLE", message: "Ticket list temporarily unavailable" });
      } else {
        await fulfillJson(route, 200, { items: [{ ...orderBase, status: paymentCommitted ? "CONFIRMED" : "PAYMENT_PENDING", tickets: paymentCommitted ? [ticket] : [] }], nextCursor: null });
      }
    } else {
      await fulfillJson(route, 404, { error: "NOT_FOUND", message: `Unexpected mock request: ${request.method()} ${pathname}` });
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();

  const seatDialog = page.getByRole("dialog");
  await seatDialog.getByRole("button", { name: "Ghế A 1 — trống" }).click();
  await seatDialog.getByTestId("hold-submit").click();
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await page.getByTestId("checkout-submit").click();
  await expect(page.getByTestId("pay-submit")).toBeEnabled();

  await page.getByTestId("pay-submit").click();
  const paymentDialog = page.getByRole("dialog", { name: "Một bước nữa thôi." });
  const paymentAlert = paymentDialog.getByRole("alert");
  await expect(paymentAlert).toBeVisible();
  lostResponseAlertText = (await paymentAlert.innerText()).trim();
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await expect(page.getByTestId("pay-submit")).toBeEnabled();
  expect(paymentCommitted).toBe(true);
  expect(ticketCreationCount).toBe(1);

  await page.getByTestId("pay-submit").click();
  await expect(page.getByRole("heading", { name: "Hẹn gặp bạn tại rạp." })).toBeVisible();
  await expect.poll(() => orderListRequests).toBe(1);
  await expect(page.getByText("THAM CHIẾU · 00000001", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem vé của tôi" })).toBeVisible();
  expect(paymentOrderIds).toEqual([orderId, orderId]);
  expect(idempotentReplayCount).toBe(1);
  expect(ticketCreationCount).toBe(1);

  await page.getByRole("button", { name: "Xem vé của tôi" }).click();
  const ticketHeading = page.getByRole("heading", { name: "Vé của bạn" });
  await expect(ticketHeading).toBeVisible();
  await expect(ticketHeading).toBeFocused();
  await expect.poll(() => orderListRequests).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chưa có chiếc vé nào" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cập nhật vé" }).click();
  await expect.poll(() => orderListRequests).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("ticket-card")).toHaveCount(1);
  await expect(page.getByTestId("ticket-card").first().locator("[aria-label=\"Mã vé QR\"]")).toBeVisible();

  // Keep a regression assertion for the plan's required explanation of an ambiguous payment result.
  expect(lostResponseAlertText).toBe(expectedLostResponseCopy);
});
