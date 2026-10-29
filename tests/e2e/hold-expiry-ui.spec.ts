import { expect, test, type Page } from "@playwright/test";

const uniqueEmail = () => `qa-expiry-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;

async function registerCustomer(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const desktopLogin = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopLogin.isVisible()) await desktopLogin.click();
  else await page.getByRole("button", { name: "Mở tài khoản" }).click();

  await page.getByRole("button", { name: "Tạo tài khoản mới" }).click();
  await page.getByLabel("Họ và tên").fill("QA Hold Expiry Customer");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Mật khẩu").fill("CinemaQa123!");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);
}

test("[TC-E2E-14] countdown hết hạn đóng checkout và thông báo ghế được trả lại", async ({ page }) => {
  // Keep normal app loading time-dependent; fast-forward only after a hold is created.
  await page.clock.install();
  await registerCustomer(page);

  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();

  const seatDialog = page.getByRole("dialog");
  const availableSeat = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])').first();
  await expect(availableSeat).toBeVisible();

  await page.route("**/api/holds", async (route) => {
    const input = route.request().postDataJSON() as { showtimeId: string; seatIds: string[] };
    const expiresAt = await page.evaluate(() => new Date(Date.now() + 60_000).toISOString());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "client-expiry-ui-hold",
        showtimeId: input.showtimeId,
        seatIds: input.seatIds,
        expiresAt,
        totalVnd: 85_000,
        status: "HELD",
      }),
    });
  });

  await availableSeat.click();
  await seatDialog.getByTestId("hold-submit").click();

  const countdown = page.getByTestId("hold-countdown");
  await expect(countdown).toBeVisible();
  await expect(countdown).toHaveAttribute("role", "timer");
  await expect(countdown).toHaveAttribute("aria-live", "off");
  await expect(countdown).toHaveAccessibleName(/Thời gian giữ ghế còn lại \d{2} phút \d{2} giây/);
  await expect(page.getByTestId("hold-created-announcement")).toHaveText("Ghế đang được giữ. Vui lòng hoàn tất thanh toán trước khi hết giờ.");
  await expect(countdown.locator("b")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.getByTestId("checkout-submit")).toBeEnabled();

  await page.clock.fastForward(61_000);

  await expect(page.getByTestId("hold-countdown")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Một bước nữa thôi." })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Thời gian giữ ghế đã hết");
  await expect(page.getByRole("alert")).toContainText("Ghế được trả lại");
});
