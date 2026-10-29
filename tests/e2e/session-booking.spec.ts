import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:4000/api";
const uniqueEmail = () => `qa-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;

async function openLogin(page: import("@playwright/test").Page) {
  const desktopButton = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopButton.isVisible()) await desktopButton.click();
  else await page.getByRole("button", { name: /Mở tài khoản/ }).click();
}

test("[TC-E2E-20][TC-E2E-24] dialog đăng nhập lồng trên sơ đồ ghế giữ đúng focus và tên dialog", async ({ page, request }) => {
  const email = uniqueEmail();
  const registration = await request.post(`${API_URL}/auth/register`, {
    data: { name: "QA Queued Booking", email, password: "CinemaQa123!" },
  });
  expect(registration.status()).toBe(201);

  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  const seatMapRequestPromise = page.waitForRequest((candidate) => {
    const path = new URL(candidate.url()).pathname;
    return candidate.method() === "GET" && /^\/api\/showtimes\/[^/]+\/seats$/.test(path);
  });
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();
  const seatMapRequest = await seatMapRequestPromise;
  const selectedShowtimeId = new URL(seatMapRequest.url()).pathname.split("/")[3];

  const seatDialog = page.locator(".seat-dialog");
  const availableSeat = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])').first();
  await expect(availableSeat).toBeVisible();
  const seatAccessibilityName = await availableSeat.getAttribute("aria-label");
  const seatMatch = seatAccessibilityName?.match(/^Ghế ([A-Z]+) (\d+) — trống$/);
  expect(seatMatch, "The selected available seat should expose its row and number").not.toBeNull();
  const seatLabel = `${seatMatch![1]}${seatMatch![2]}`;
  const [cinema, auditorium, date, time] = (await seatDialog.locator(".dialog-top p").innerText()).split(" · ");
  await availableSeat.click();
  await expect(availableSeat).toHaveAttribute("aria-pressed", "true");
  await seatDialog.getByTestId("hold-submit").click();

  const authDialog = page.locator(".auth-dialog");
  await expect(authDialog).toBeVisible();
  await expect(seatDialog).toBeVisible();
  await expect(seatDialog).toHaveAttribute("aria-modal", "false");
  await expect(page.locator(".booking-overlay")).toHaveAttribute("inert", "");
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);

  const stackedDialogViolations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include(".overlay").analyze()).violations
    .map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target), failureSummaries: nodes.map((node) => node.failureSummary) }));
  expect(stackedDialogViolations).toEqual([]);

  const authClose = authDialog.getByRole("button", { name: "Đóng" });
  const authLastControl = authDialog.getByRole("button", { name: "Tạo tài khoản mới" });
  await authLastControl.focus();
  await page.keyboard.press("Tab");
  await expect(authClose).toBeFocused();
  await expect(authDialog.locator(":focus")).toHaveCount(1);

  const holdSubmit = seatDialog.getByTestId("hold-submit");
  await page.keyboard.press("Escape");
  await expect(authDialog).toBeHidden();
  await expect(holdSubmit).toBeFocused();
  await expect(seatDialog).toHaveAttribute("aria-modal", "true");

  await holdSubmit.click();
  await expect(authDialog).toBeVisible();
  await authDialog.getByLabel("Email").fill(email);
  await authDialog.getByLabel("Mật khẩu").fill("CinemaQa123!");
  const holdResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && new URL(response.url()).pathname === "/api/holds";
  });
  await authDialog.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const holdResponse = await holdResponsePromise;
  expect(holdResponse.status()).toBe(201);
  const holdRequest = holdResponse.request().postDataJSON() as { showtimeId: string; seatIds: string[] };
  expect(holdRequest.showtimeId).toBe(selectedShowtimeId);
  expect(holdRequest.seatIds).toHaveLength(1);
  expect(holdResponse.request().headers().authorization).toMatch(/^Bearer\s+.+/);

  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Một bước nữa thôi." })).toBeVisible();
  const checkoutSummary = page.locator(".checkout-summary");
  await expect(checkoutSummary).toContainText(`Ghế: ${seatLabel}`);
  await expect(checkoutSummary).toContainText(`${cinema} · ${auditorium}`);
  await expect(checkoutSummary).toContainText(`${date} · ${time}`);
});

test("[TC-E2E-21] session Admin được giữ sau reload và bị xóa khi đăng xuất", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  await openLogin(page);
  await page.getByLabel("Email").fill("admin@cinema.local");
  await page.getByLabel("Mật khẩu").fill("CinemaAdmin123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();

  const adminNavigation = page.getByRole("button", { name: "Quản trị", exact: true });
  await expect(adminNavigation).toBeVisible();
  await expect(page.getByRole("button", { name: "Soát vé", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  await expect(adminNavigation).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);

  await adminNavigation.click();
  await expect(page.getByRole("heading", { name: "Vận hành rạp phim" })).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();

  await expect.poll(() => page.evaluate(() => localStorage.getItem("cinemabooking.session"))).toBeNull();
  await expect(page.getByRole("button", { name: "Quản trị", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Soát vé", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vé của tôi", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Vận hành rạp phim" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true }).or(page.getByRole("button", { name: /Mở tài khoản/ }))).toBeVisible();
});
