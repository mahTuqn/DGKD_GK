import { expect, test } from "@playwright/test";

const uniqueEmail = () => `qa-compose-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;

test("[TC-OPS-01] current Compose images serve a complete browser booking journey", async ({ page }) => {
  test.skip(process.env.E2E_COMPOSE_SMOKE !== "true" || process.env.GITHUB_ACTIONS !== "true", "This smoke runs only against the isolated current-source Compose stack in GitHub Actions.");

  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const desktopLogin = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopLogin.isVisible()) await desktopLogin.click();
  else await page.getByRole("button", { name: "Mở tài khoản" }).click();
  await page.getByRole("button", { name: "Tạo tài khoản mới" }).click();
  await page.getByLabel("Họ và tên").fill("Compose Smoke Customer");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Mật khẩu").fill("CinemaQa123!");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);

  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();
  const seatDialog = page.getByRole("dialog").first();
  const availableSeat = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])').first();
  await expect(availableSeat).toBeVisible();
  await availableSeat.click();

  const holdResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/api/holds"));
  await seatDialog.getByTestId("hold-submit").click();
  const holdResponse = await holdResponsePromise;
  expect(holdResponse.status()).toBe(201);
  await expect(page.getByTestId("hold-countdown")).toBeVisible();

  const orderResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/api/orders"));
  await page.getByTestId("checkout-submit").click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(201);
  await page.getByTestId("pay-submit").click();
  await expect(page.locator(".checkout-dialog").getByText("Thanh toán demo thành công.")).toBeVisible();
  await page.getByRole("button", { name: "Xem vé của tôi" }).click();
  await expect(page.getByRole("heading", { name: "Vé của bạn" })).toBeVisible();
  await expect(page.getByTestId("ticket-card").first()).toBeVisible();
});

test("[TC-SEC-28] login rate limiting ignores forged X-Forwarded-For through Nginx", async ({ request }) => {
  test.skip(process.env.E2E_COMPOSE_SMOKE !== "true" || process.env.GITHUB_ACTIONS !== "true", "This proxy-hop smoke runs only against the isolated current-source Compose stack in GitHub Actions.");

  const apiBaseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:8080/api";
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await request.post(`${apiBaseUrl}/auth/login`, {
      data: {},
      headers: { "X-Forwarded-For": `198.51.100.${attempt}` }
    });
    expect(response.status(), `forged forwarded address ${attempt}`).toBe(422);
    expect((await response.json()).error).toBe("VALIDATION_ERROR");
  }

  const blockedLogin = await request.post(`${apiBaseUrl}/auth/login`, {
    data: {},
    headers: { "X-Forwarded-For": "198.51.100.99" }
  });
  expect(blockedLogin.status()).toBe(429);
  expect((await blockedLogin.json()).error).toBe("AUTH_RATE_LIMITED");
});
