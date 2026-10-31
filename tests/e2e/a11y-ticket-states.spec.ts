import { expect, test, type Route } from "@playwright/test";

const ticketOrder = {
  id: "a11y-ticket-order-87654321",
  status: "CONFIRMED",
  totalVnd: 85_000,
  createdAt: "2026-10-31T00:00:00.000Z",
  showtime: {
    id: "a11y-ticket-showtime",
    movieId: "a11y-ticket-movie",
    movieTitle: "Ticket Status Feature",
    cinemaId: "a11y-ticket-cinema",
    cinemaName: "Ticket Status Cinema",
    city: "Test City",
    auditoriumName: "Ticket Status Room",
    startAt: "2026-11-01T11:00:00.000Z",
    endAt: "2026-11-01T12:40:00.000Z",
    date: "2026-11-01",
    priceVnd: 85_000,
    screenType: "STANDARD",
    status: "ACTIVE",
  },
  seats: [{ seatId: "a11y-ticket-seat", label: "A1" }],
  tickets: [{ id: "a11y-ticket-87654321", qrToken: "a11y-qr-fixture-token", checkedInAt: null, seatLabel: "A1" }],
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("[TC-E2E-43] ticket history announces loading, refresh failure, and the empty state", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem("cinemabooking.session", JSON.stringify({
      token: "a11y-ticket-customer-token",
      user: { id: "a11y-ticket-customer", name: "Ticket Accessibility Customer", email: "tickets@example.test", role: "CUSTOMER" },
    }));
  });

  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => { releaseFirstResponse = resolve; });
  let signalFirstRequest!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => { signalFirstRequest = resolve; });
  let releaseSecondResponse!: () => void;
  const secondResponseGate = new Promise<void>((resolve) => { releaseSecondResponse = resolve; });
  let signalSecondRequest!: () => void;
  const secondRequestStarted = new Promise<void>((resolve) => { signalSecondRequest = resolve; });
  let releaseThirdResponse!: () => void;
  const thirdResponseGate = new Promise<void>((resolve) => { releaseThirdResponse = resolve; });
  let signalThirdRequest!: () => void;
  const thirdRequestStarted = new Promise<void>((resolve) => { signalThirdRequest = resolve; });
  let orderPageRequests = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (request.method() === "GET" && pathname === "/api/movies") {
      await fulfillJson(route, 200, []);
    } else if (request.method() === "GET" && pathname === "/api/showtimes") {
      await fulfillJson(route, 200, []);
    } else if (request.method() === "GET" && pathname === "/api/orders/me") {
      orderPageRequests += 1;
      if (orderPageRequests === 1) {
        signalFirstRequest();
        await firstResponseGate;
        await fulfillJson(route, 200, { items: [ticketOrder], nextCursor: null });
      } else if (orderPageRequests === 2) {
        signalSecondRequest();
        await secondResponseGate;
        await fulfillJson(route, 503, { error: "SERVICE_UNAVAILABLE", message: "Không thể cập nhật vé lúc này." });
      } else {
        signalThirdRequest();
        await thirdResponseGate;
        await fulfillJson(route, 200, { items: [], nextCursor: null });
      }
    } else {
      await fulfillJson(route, 404, { error: "NOT_FOUND", message: `Unexpected mock request: ${request.method()} ${pathname}` });
    }
  });

  try {
    await page.goto("/");
    const ticketsNavigation = page.getByRole("button", { name: "Vé của tôi", exact: true });
    await expect(ticketsNavigation).toBeVisible();
    await ticketsNavigation.focus();
    await page.keyboard.press("Enter");
    await firstRequestStarted;

    const ticketPage = page.locator("main.content-page");
    await expect(ticketPage.getByRole("status")).toHaveText("Đang tải vé của bạn.");
    releaseFirstResponse();
    await expect(ticketPage.getByTestId("ticket-card")).toHaveCount(1);
    await expect(ticketPage.getByText("Chưa vào rạp", { exact: true })).toBeVisible();
    await expect(ticketPage.getByText("Tham chiếu · 87654321", { exact: true })).toBeVisible();

    const refreshButton = ticketPage.getByRole("button", { name: /Cập nhật vé/ });
    await refreshButton.focus();
    await page.keyboard.press("Enter");
    await secondRequestStarted;
    await expect(ticketPage.getByRole("status")).toHaveText("Đang cập nhật danh sách vé.");
    releaseSecondResponse();
    await expect(ticketPage.getByRole("alert")).toHaveText("Không thể cập nhật vé lúc này.");
    await expect(ticketPage.getByTestId("ticket-card")).toHaveCount(1);

    await refreshButton.focus();
    await page.keyboard.press("Enter");
    await thirdRequestStarted;
    await expect(ticketPage.getByRole("status")).toHaveText("Đang cập nhật danh sách vé.");
    releaseThirdResponse();
    await expect(ticketPage.getByRole("alert")).toHaveCount(0);
    await expect(ticketPage.getByRole("heading", { name: "Chưa có chiếc vé nào" })).toBeVisible();
  } finally {
    releaseFirstResponse();
    releaseSecondResponse();
    releaseThirdResponse();
  }

  expect(orderPageRequests).toBe(3);
});
