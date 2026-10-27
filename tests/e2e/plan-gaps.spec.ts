import { expect, test, type Page } from "@playwright/test";

const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:4000/api";
const uniqueEmail = () => `qa-gap-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;

type SeatMap = {
  showtime: { id: string };
  seats: Array<{ id: string; row: string; column: number; status: "AVAILABLE" | "HELD" | "SOLD" }>;
};

async function registerCustomer(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  const desktopButton = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopButton.isVisible()) await desktopButton.click();
  else await page.getByRole("button", { name: "Mở tài khoản" }).click();
  await page.getByRole("button", { name: "Tạo tài khoản mới" }).click();
  await page.getByLabel("Họ và tên").fill("QA Plan Gap Customer");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Mật khẩu").fill("CinemaQa123!");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);
}

async function openFirstSeatMap(page: Page) {
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  const seatMapResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return /^\/api\/showtimes\/[^/]+\/seats$/.test(path);
  });
  await page.getByTestId("showtime-option").first().click();
  const response = await seatMapResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByRole("dialog").getByTestId("seat").first()).toBeVisible();
  return await response.json() as SeatMap;
}

async function registerCompetingCustomer(page: Page) {
  const response = await page.request.post(`${API_URL}/auth/register`, {
    data: { name: "QA Competing Customer", email: uniqueEmail(), password: "CinemaQa123!" },
  });
  expect(response.status()).toBe(201);
  return await response.json() as { token: string };
}

test("[TC-E2E-12] thanh toán thất bại không phát vé và ghế được mở lại", async ({ page }) => {
  await registerCustomer(page);
  const seatMap = await openFirstSeatMap(page);
  const seat = seatMap.seats.find((entry) => entry.status === "AVAILABLE");
  expect(seat, "Showtime should have an available seat").toBeTruthy();

  const seatName = `Ghế ${seat!.row} ${seat!.column} — trống`;
  await page.getByRole("dialog").getByRole("button", { name: seatName }).click();
  await page.getByTestId("hold-submit").click();
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await page.getByTestId("checkout-submit").click();
  await expect(page.getByTestId("pay-submit")).toBeVisible();

  // Route the UI payment through the real API's FAILED outcome.
  await page.route("**/api/payments/mock/complete", async (route) => {
    const input = route.request().postDataJSON() as { orderId: string };
    const response = await route.fetch({ postData: JSON.stringify({ ...input, outcome: "FAILED" }) });
    await route.fulfill({ response });
  });
  await page.getByTestId("pay-submit").click();
  await expect(page.getByRole("alert")).toContainText("Thanh toán mô phỏng thất bại");
  await expect(page.getByRole("alert")).toContainText("Ghế đã được giải phóng");

  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("cinemabooking.session") || "null") as { token: string });
  const ordersResponse = await page.request.get(`${API_URL}/orders/me`, { headers: { authorization: `Bearer ${session.token}` } });
  expect(ordersResponse.ok()).toBeTruthy();
  const orders = await ordersResponse.json() as Array<{ status: string; tickets: unknown[] }>;
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: "PAYMENT_FAILED", tickets: [] });

  await page.getByRole("dialog").getByRole("button", { name: "Đóng" }).click();
  await page.getByTestId("showtime-option").first().click();
  await expect(page.getByRole("dialog").getByRole("button", { name: seatName })).toBeEnabled();
});

test("[TC-E2E-13] ghế vừa bị khách khác giữ hiện xung đột và làm mới sơ đồ", async ({ page }) => {
  await registerCustomer(page);
  const seatMap = await openFirstSeatMap(page);
  const seat = seatMap.seats.find((entry) => entry.status === "AVAILABLE");
  expect(seat, "Showtime should have an available seat").toBeTruthy();

  const seatName = `Ghế ${seat!.row} ${seat!.column} — trống`;
  const seatDialog = page.getByRole("dialog");
  await seatDialog.getByRole("button", { name: seatName }).click();

  // A second customer takes the selected seat after discovery loaded its stale map.
  const competitor = await registerCompetingCustomer(page);
  const blockerResponse = await page.request.post(`${API_URL}/holds`, {
    headers: { authorization: `Bearer ${competitor.token}` },
    data: { showtimeId: seatMap.showtime.id, seatIds: [seat!.id] },
  });
  expect(blockerResponse.status()).toBe(201);

  await seatDialog.getByTestId("hold-submit").click();
  await expect(seatDialog.getByRole("alert")).toContainText("Ghế vừa được người khác giữ");
  await expect(seatDialog.getByRole("alert")).toContainText("chọn ghế khác");
  await expect(seatDialog.getByRole("button", { name: `Ghế ${seat!.row} ${seat!.column} — đang giữ` })).toBeDisabled();
  await expect(seatDialog.getByTestId("hold-submit")).toBeDisabled();
});
