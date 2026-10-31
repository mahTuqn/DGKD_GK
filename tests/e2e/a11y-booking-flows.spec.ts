import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const movie = {
  id: "a11y-booking-movie",
  slug: "a11y-booking-feature",
  title: "A11y Booking Feature",
  genre: "Drama",
  synopsis: "Fixture for keyboard and status checks in booking dialogs.",
  runtimeMinutes: 100,
  ageRating: "P",
  posterUrl: null,
  releaseDate: "2026-01-01",
  status: "ACTIVE",
};

const cinema = {
  id: "a11y-booking-cinema",
  name: "Keyboard Cinema",
  city: "Test City",
};

const showtimeId = "a11y-booking-showtime";
const seatIds = ["a11y-booking-seat-a1", "a11y-booking-seat-a2"];
const seats = [
  { id: seatIds[0], label: "A1", row: "A", column: 1, type: "STANDARD", isAccessible: false, status: "AVAILABLE", priceVnd: 85_000 },
  { id: seatIds[1], label: "A2", row: "A", column: 2, type: "ACCESSIBLE", isAccessible: true, status: "AVAILABLE", priceVnd: 85_000 },
  { id: "a11y-booking-seat-a3", label: "A3", row: "A", column: 3, type: "PREMIUM", isAccessible: false, status: "HELD", priceVnd: 115_000 },
  { id: "a11y-booking-seat-a4", label: "A4", row: "A", column: 4, type: "ACCESSIBLE", isAccessible: true, status: "SOLD", priceVnd: 85_000 },
];

function makeShowtime(date: string) {
  const start = new Date(`${date}T18:00:00+07:00`);
  return {
    id: showtimeId,
    movieId: movie.id,
    movieTitle: movie.title,
    cinemaId: cinema.id,
    cinemaName: cinema.name,
    city: cinema.city,
    auditoriumName: "Keyboard Room",
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 100 * 60_000).toISOString(),
    date,
    priceVnd: 85_000,
    premiumSurchargeVnd: 30_000,
    screenType: "STANDARD",
    status: "ACTIVE",
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockBookingApi(page: Page) {
  let currentShowtime = makeShowtime(new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10));
  let paymentAttempts = 0;

  await page.addInitScript(() => {
    localStorage.setItem("cinemabooking.session", JSON.stringify({
      token: "a11y-booking-customer-token",
      user: { id: "a11y-booking-customer", name: "Accessibility Customer", email: "a11y@example.test", role: "CUSTOMER" },
    }));
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());

    if (request.method() === "GET" && pathname === "/api/movies") {
      await fulfillJson(route, 200, [movie]);
    } else if (request.method() === "GET" && pathname === "/api/showtimes") {
      const requestedDate = searchParams.get("date");
      if (!requestedDate) throw new Error("Expected a date query for showtime discovery.");
      currentShowtime = makeShowtime(requestedDate);
      await fulfillJson(route, 200, [currentShowtime]);
    } else if (request.method() === "GET" && pathname === `/api/showtimes/${showtimeId}/seats`) {
      await fulfillJson(route, 200, { showtime: currentShowtime, seats });
    } else if (request.method() === "POST" && pathname === "/api/holds") {
      const input = request.postDataJSON() as { showtimeId: string; seatIds: string[] };
      await fulfillJson(route, 201, {
        id: "a11y-booking-hold",
        showtimeId: input.showtimeId,
        seatIds: input.seatIds,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        totalVnd: 85_000 * input.seatIds.length,
        status: "HELD",
      });
    } else if (request.method() === "POST" && pathname === "/api/orders") {
      await fulfillJson(route, 201, {
        id: "a11y-booking-order",
        status: "PAYMENT_PENDING",
        totalVnd: 85_000,
        createdAt: new Date().toISOString(),
        showtime: currentShowtime,
        seats: [{ seatId: seatIds[0], label: "A1" }],
        tickets: [],
      });
    } else if (request.method() === "POST" && pathname === "/api/payments/mock/complete") {
      paymentAttempts += 1;
      await fulfillJson(route, 503, {
        error: "PAYMENT_UNAVAILABLE",
        message: "Thanh toán mô phỏng đang tạm thời không khả dụng.",
      });
    } else if (request.method() === "GET" && pathname === "/api/orders/me") {
      await fulfillJson(route, 200, { items: [], nextCursor: null });
    } else {
      await fulfillJson(route, 404, { error: "NOT_FOUND", message: `Unexpected mock request: ${request.method()} ${pathname}` });
    }
  });

  return { get paymentAttempts() { return paymentAttempts; } };
}

async function expectNoWcagAxeViolations(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .include(selector)
    .analyze();
  const violations = result.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.map((node) => node.target),
    failureSummaries: nodes.map((node) => node.failureSummary),
  }));
  expect(violations).toEqual([]);
}

async function openSeatDialog(page: Page) {
  const movieAction = page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" });
  await movieAction.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("showtime-option").first()).toBeVisible();
  const opener = page.getByTestId("showtime-option").first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: movie.title });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Đóng" })).toBeFocused();
  await expect(page.locator(".booking-overlay").last()).toHaveCSS("opacity", "1");
  return dialog;
}

test("[TC-E2E-41] seat dialog keyboard boundaries and focus restoration", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockBookingApi(page);
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const dialog = await openSeatDialog(page);
  const opener = page.getByTestId("showtime-option").first();
  const firstSeat = dialog.getByRole("button", { name: "Ghế A 1 — trống — ghế tiêu chuẩn" });
  const secondSeat = dialog.getByRole("button", { name: "Ghế A 2 — trống — ghế hỗ trợ tiếp cận" });
  const holdButton = dialog.getByTestId("hold-submit");

  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(firstSeat).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.getByRole("button", { name: "Ghế A 3 — đang giữ — ghế cao cấp" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Ghế A 4 — đã bán — ghế hỗ trợ tiếp cận" })).toBeDisabled();
  await expectNoWcagAxeViolations(page, ".seat-dialog");

  await page.keyboard.press("Tab");
  await expect(firstSeat).toBeFocused();
  await page.keyboard.press("Space");
  await expect(firstSeat).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".seat-footer")).toContainText("1 ghế đã chọn");
  await page.keyboard.press("Tab");
  await expect(secondSeat).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(holdButton).toBeFocused();
  await expect(holdButton).toBeEnabled();

  await page.keyboard.press("Shift+Tab");
  await expect(secondSeat).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(firstSeat).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Đóng" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(holdButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // Pointer activation must also restore focus when WebKit leaves focus on body.
  await opener.click();
  const pointerOpenedDialog = page.getByRole("dialog", { name: movie.title });
  await expect(pointerOpenedDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pointerOpenedDialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("[TC-E2E-42] hold announcement, quiet timer, checkout focus and payment error", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const apiState = await mockBookingApi(page);
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const seatDialog = await openSeatDialog(page);
  const firstSeat = seatDialog.getByRole("button", { name: "Ghế A 1 — trống — ghế tiêu chuẩn" });
  await firstSeat.focus();
  await expect(firstSeat).toBeFocused();
  await page.keyboard.press("Space");
  const holdButton = seatDialog.getByTestId("hold-submit");
  await expect(holdButton).toBeEnabled();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(holdButton).toBeFocused();
  await page.keyboard.press("Enter");

  const checkout = page.getByRole("dialog", { name: "Một bước nữa thôi." });
  await expect(checkout).toBeVisible();
  await expect(page.locator(".booking-overlay").last()).toHaveCSS("opacity", "1");
  await expect(checkout.getByRole("status")).toHaveText("Ghế đang được giữ. Vui lòng hoàn tất thanh toán trước khi hết giờ.");
  const timer = checkout.getByRole("timer");
  await expect(timer).toHaveAttribute("aria-live", "off");
  await expect(timer).toHaveAccessibleName(/^Thời gian giữ ghế còn lại \d+ phút \d+ giây$/);
  await expect(checkout).toContainText(movie.title);
  await expect(checkout).toContainText("Ghế: A1");
  await expectNoWcagAxeViolations(page, ".checkout-dialog");

  const continueButton = checkout.getByTestId("checkout-submit");
  await page.keyboard.press("Tab");
  await expect(continueButton).toBeFocused();
  await page.keyboard.press("Enter");
  const payButton = checkout.getByTestId("pay-submit");
  await expect(payButton).toBeFocused();
  await expect(payButton).toBeEnabled();
  await expectNoWcagAxeViolations(page, ".checkout-dialog");

  await page.keyboard.press("Enter");
  const alert = checkout.getByRole("alert");
  await expect(alert).toHaveText("Thanh toán mô phỏng đang tạm thời không khả dụng.");
  await expect(payButton).toBeFocused();
  await expect(payButton).toBeEnabled();
  expect(apiState.paymentAttempts).toBe(1);
  await expectNoWcagAxeViolations(page, ".checkout-dialog");
});
