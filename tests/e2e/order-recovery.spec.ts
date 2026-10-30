import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:4000/api";
const uniqueEmail = () => `qa-order-recovery-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;

type OrdersPage = {
  items: Array<{ id: string; status: string; tickets: unknown[] }>;
  nextCursor: string | null;
};

async function registerCustomer(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  const desktopButton = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopButton.isVisible()) await desktopButton.click();
  else await page.getByRole("button", { name: "Mở tài khoản" }).click();
  await page.getByRole("button", { name: "Tạo tài khoản mới" }).click();
  await page.getByLabel("Họ và tên").fill("QA Order Recovery Customer");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Mật khẩu").fill("CinemaQa123!");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);
}

async function loadCustomerOrders(request: APIRequestContext, token: string) {
  const response = await request.get(`${API_URL}/orders/me?limit=20`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok(), "Customer order history should be readable after order creation").toBeTruthy();
  return await response.json() as OrdersPage;
}

test("[TC-E2E-38] retry sau khi mất phản hồi tạo đơn không tạo đơn trùng", async ({ page, request }) => {
  test.setTimeout(60_000);
  await registerCustomer(page);

  let orderPostCount = 0;
  let committedOrderId: string | undefined;
  await page.route("**/api/orders", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/orders") {
      await route.continue();
      return;
    }

    orderPostCount += 1;
    if (orderPostCount === 1) {
      // Let the real API commit the order, then drop only the browser-facing response.
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      const created = await response.json() as { id: string; status: string };
      expect(created.status).toBe("PAYMENT_PENDING");
      committedOrderId = created.id;
      await route.abort("connectionreset");
      return;
    }

    await route.continue();
  });

  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  const seatMapResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "GET" && /^\/api\/showtimes\/[^/]+\/seats$/.test(new URL(response.url()).pathname);
  });
  await page.getByTestId("showtime-option").first().click();
  const seatMapResponse = await seatMapResponsePromise;
  expect(seatMapResponse.ok()).toBeTruthy();

  const seatDialog = page.getByRole("dialog").first();
  const availableSeat = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])').first();
  await expect(availableSeat).toBeVisible();
  await availableSeat.click();
  const holdResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "POST" && new URL(response.url()).pathname === "/api/holds";
  });
  await seatDialog.getByTestId("hold-submit").click();
  expect((await holdResponsePromise).status()).toBe(201);
  await expect(page.getByTestId("hold-countdown")).toBeVisible();

  await page.getByTestId("checkout-submit").click();
  const checkoutDialog = page.getByRole("dialog", { name: "Một bước nữa thôi." });
  await expect(checkoutDialog.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("checkout-submit")).toBeEnabled();
  await expect(page.getByTestId("pay-submit")).toHaveCount(0);
  expect(orderPostCount).toBe(1);
  expect(committedOrderId).toBeTruthy();

  const token = await page.evaluate(() => {
    return (JSON.parse(localStorage.getItem("cinemabooking.session") || "null") as { token?: string } | null)?.token;
  });
  expect(token, "Registration should leave an authenticated customer session").toBeTruthy();
  const afterLostResponse = await loadCustomerOrders(request, token as string);
  expect(afterLostResponse.items).toHaveLength(1);
  expect(afterLostResponse.items[0]).toMatchObject({ id: committedOrderId, status: "PAYMENT_PENDING", tickets: [] });

  const retryResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "POST" && new URL(response.url()).pathname === "/api/orders";
  });
  await page.getByTestId("checkout-submit").click();
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.status()).toBe(201);
  const retriedOrder = await retryResponse.json() as { id: string; status: string };
  expect(retriedOrder).toMatchObject({ id: committedOrderId, status: "PAYMENT_PENDING" });
  await expect(page.getByTestId("pay-submit")).toBeVisible();
  expect(orderPostCount).toBe(2);

  const afterRetry = await loadCustomerOrders(request, token as string);
  expect(afterRetry.items).toHaveLength(1);
  expect(afterRetry.items.map((order) => order.id)).toEqual([committedOrderId]);
});
