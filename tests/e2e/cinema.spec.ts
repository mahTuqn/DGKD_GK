import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:4000/api";
const PREVIEW_URL = process.env.E2E_PREVIEW_URL || "http://127.0.0.1:5174/";
const uniqueEmail = () => `qa-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;

async function openLogin(page: Page) {
  const desktopButton = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopButton.isVisible()) await desktopButton.click();
  else await page.getByRole("button", { name: "Mở tài khoản" }).click();
}

async function signIn(page: Page, email: string, password: string) {
  await openLogin(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
}

async function tabUntilFocused(page: Page, target: Locator, maxTabs = 60) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach ${await target.getAttribute("aria-label") || "the expected control"} using Tab within ${maxTabs} steps.`);
}

async function expectVisibleKeyboardFocus(target: Locator) {
  await expect(target).toBeFocused();
  const outline = await target.evaluate((element) => ({
    style: getComputedStyle(element).outlineStyle,
    width: getComputedStyle(element).outlineWidth,
  }));
  expect(outline).toEqual({ style: "solid", width: "2px" });
}

function seriousAxeViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
    .map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target), failureSummaries: nodes.map((node) => node.failureSummary) }));
}

async function waitForOverlayAnimations(page: Page) {
  const overlay = page.locator(".overlay").first();
  if (await overlay.count()) {
    await overlay.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
  }
}

async function registerCustomer(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  await openLogin(page);
  await page.getByRole("button", { name: "Tạo tài khoản mới" }).click();
  await page.getByLabel("Họ và tên").fill("QA Cinema Customer");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Mật khẩu").fill("CinemaQa123!");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);
}

async function buyOneTicket(page: Page) {
  const movie = page.getByTestId("movie-card").first();
  await movie.getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();

  const seatDialog = page.getByRole("dialog").first();
  const availableSeat = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])').first();
  await expect(availableSeat).toBeVisible();
  await availableSeat.click();
  await seatDialog.getByTestId("hold-submit").click();
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await page.getByTestId("checkout-submit").click();
  await expect(page.getByTestId("pay-submit")).toBeVisible();
  await page.getByTestId("pay-submit").click();
  await page.getByRole("button", { name: "Xem vé của tôi" }).click();

  await expect(page.getByRole("heading", { name: "Vé của bạn" })).toBeVisible();
  const ticket = page.getByTestId("ticket-card").first();
  await expect(ticket).toBeVisible();
  await expect(ticket.locator("[aria-label=\"Mã vé QR\"]")).toBeVisible();
}

async function getNewestTicketQrToken(page: Page) {
  const token = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("cinemabooking.session") || "null") as { token?: string } | null;
    return session?.token;
  });
  expect(token, "Customer session token should exist after registration").toBeTruthy();
  const response = await page.context().request.get(`${API_URL}/orders/me`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.ok()).toBeTruthy();
  const orders = await response.json() as Array<{ tickets: Array<{ qrToken: string }> }>;
  const qrToken = orders.flatMap((order) => order.tickets).at(0)?.qrToken;
  expect(qrToken, "The confirmed order should contain a QR token").toBeTruthy();
  return qrToken as string;
}

test("[TC-E2E-00] API health trả trạng thái sẵn sàng", async ({ request }) => {
  const response = await request.get(`${API_URL}/health`);
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: "ok", service: "cinema-booking-api" });
});

test("[TC-E2E-10][TC-PLAN-07] trang web gửi security headers cơ bản", async ({ page }) => {
  const response = await page.goto(PREVIEW_URL);
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

test("[TC-E2E-01] customer đăng ký, duyệt suất, giữ ghế, thanh toán demo và xem vé", async ({ page }) => {
  await registerCustomer(page);
  await buyOneTicket(page);
});

test("[TC-E2E-02] trang khám phá không có lỗi axe serious hoặc critical", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }))).toEqual([]);
});

test("[TC-E2E-03] staff soát QR vé một lần và từ chối lượt dùng lặp", async ({ page }) => {
  await registerCustomer(page);
  await buyOneTicket(page);
  const qrToken = await getNewestTicketQrToken(page);

  // Clear the customer session before signing in as staff.
  await page.evaluate(() => localStorage.removeItem("cinemabooking.session"));
  await page.reload();
  await openLogin(page);
  await page.getByLabel("Email").fill("staff@cinema.local");
  await page.getByLabel("Mật khẩu").fill("CinemaStaff123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Soát vé" }).click();

  await page.getByLabel("Mã QR vé").fill(qrToken);
  await page.getByRole("button", { name: "Xác nhận vào rạp" }).click();
  await expect(page.getByRole("status")).toContainText("Vé hợp lệ");

  await page.getByLabel("Mã QR vé").fill(qrToken);
  await page.getByRole("button", { name: "Xác nhận vào rạp" }).click();
  await expect(page.getByRole("alert")).toContainText("đã được sử dụng");
});





test("[TC-E2E-04] Admin xem báo cáo tỉ lệ lấp đầy ở chế độ chỉ đọc", async ({ page }) => {
  await page.goto("/");
  await openLogin(page);
  await page.getByLabel("Email").fill("admin@cinema.local");
  await page.getByLabel("Mật khẩu").fill("CinemaAdmin123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Quản trị" }).click();

  const occupancy = page.locator(".occupancy-panel");
  await expect(occupancy).toBeVisible();
  await expect(occupancy.getByRole("heading", { name: "Mức lấp đầy chỗ ngồi" })).toBeVisible();
  await expect(occupancy.getByText(/[\d.,]+ \/ [\d.,]+ ghế đã bán/)).toBeVisible();
  await expect(occupancy.getByText(/\d+ suất đang mở/)).toBeVisible();
  await expect(occupancy.getByRole("progressbar", { name: "Tỉ lệ lấp đầy ghế" })).toHaveAttribute("value", /\d/);
});

test("[TC-E2E-05] Admin tạo rạp, cập nhật trạng thái và thấy trạng thái được lưu", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "admin@cinema.local", "CinemaAdmin123!");
  await page.getByRole("button", { name: "Quản trị" }).click();

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const cinemaName = `QA E2E Cinema ${suffix}`;
  const cinemaPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Quản lý rạp" }) });
  await cinemaPanel.getByLabel("Tên rạp").fill(cinemaName);
  await cinemaPanel.getByLabel("Thành phố").fill("QA Test City");
  await cinemaPanel.getByLabel("Địa chỉ").fill(`E2E fixture address ${suffix}`);
  await cinemaPanel.getByRole("button", { name: "Thêm rạp" }).click();

  let cinemaRow = cinemaPanel.locator(".admin-record-row").filter({ hasText: cinemaName });
  await expect(cinemaRow).toBeVisible();
  await cinemaRow.getByRole("button", { name: "Đang hoạt động · Tạm dừng" }).click();
  await expect(cinemaRow.getByRole("button", { name: "Đã tạm dừng · Mở lại" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Quản trị" }).click();
  const reloadedPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Quản lý rạp" }) });
  cinemaRow = reloadedPanel.locator(".admin-record-row").filter({ hasText: cinemaName });
  await expect(cinemaRow.getByRole("button", { name: "Đã tạm dừng · Mở lại" })).toBeVisible();
});

test("[TC-E2E-11] dữ liệu quản trị có markup được hiển thị như văn bản", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "admin@cinema.local", "CinemaAdmin123!");
  await page.getByRole("button", { name: "Quản trị" }).click();

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const payload = `<img src=x data-qa="${suffix}" onerror="window.__cinemaXss=1">`;
  const cinemaPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Quản lý rạp" }) });
  await cinemaPanel.getByLabel("Tên rạp").fill(payload);
  await cinemaPanel.getByLabel("Thành phố").fill("XSS Test City");
  await cinemaPanel.getByLabel("Địa chỉ").fill(`XSS fixture address ${suffix}`);
  await cinemaPanel.getByRole("button", { name: "Thêm rạp" }).click();

  const row = cinemaPanel.locator(".admin-record-row").filter({ hasText: payload });
  await expect(row).toBeVisible();
  await expect(row.getByText(payload, { exact: true })).toBeVisible();
  await expect(row.locator("img, script")).toHaveCount(0);
});

test("[TC-E2E-06] Bộ lọc phim và rạp cập nhật đúng các suất đang hiển thị", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const date = await page.getByLabel("Ngày chiếu").inputValue();
  const [moviesResponse, showtimesResponse] = await Promise.all([
    page.request.get(`${API_URL}/movies`),
    page.request.get(`${API_URL}/showtimes?date=${encodeURIComponent(date)}`),
  ]);
  expect(moviesResponse.ok()).toBeTruthy();
  expect(showtimesResponse.ok()).toBeTruthy();
  const movies = await moviesResponse.json() as Array<{ id: string; title: string }>;
  const dayShowtimes = await showtimesResponse.json() as Array<{ id: string; movieId: string; cinemaId: string }>;
  expect(movies.length).toBeGreaterThan(1);
  expect(dayShowtimes.length).toBeGreaterThan(0);

  const selectedMovieCard = page.getByTestId("movie-card").nth(1);
  const selectedMovieTitle = (await selectedMovieCard.locator("h3").innerText()).trim();
  const selectedMovie = movies.find((movie) => movie.title === selectedMovieTitle);
  expect(selectedMovie, "Selected movie should exist in the public catalog").toBeTruthy();
  await selectedMovieCard.getByRole("button", { name: "Xem suất chiếu" }).click();
  await expect(page.getByRole("heading", { level: 2, name: `Suất chiếu · ${selectedMovieTitle}` })).toBeVisible();
  const expectedMovieCount = dayShowtimes.filter((showtime) => showtime.movieId === selectedMovie!.id).length;
  await expect(page.locator(".showtime-card")).toHaveCount(expectedMovieCount);

  const selectedCinemaId = dayShowtimes[0]!.cinemaId;
  await expect(page.getByLabel("Rạp").locator(`option[value="${selectedCinemaId}"]`)).toHaveCount(1);
  const filteredResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/showtimes") && url.searchParams.get("cinemaId") === selectedCinemaId;
  });
  await page.getByLabel("Rạp").selectOption(selectedCinemaId);
  const filteredResponse = await filteredResponsePromise;
  expect(filteredResponse.ok()).toBeTruthy();
  const filteredShowtimes = await filteredResponse.json() as Array<{ movieId: string; cinemaId: string }>;
  const expectedFilteredCount = filteredShowtimes.filter((showtime) => showtime.movieId === selectedMovie!.id && showtime.cinemaId === selectedCinemaId).length;
  await expect(page.locator(".showtime-card")).toHaveCount(expectedFilteredCount);
});

test("[TC-E2E-07] Bộ lọc ngày làm mới lịch chiếu theo ngày đã chọn", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const movieTitle = (await page.getByTestId("movie-card").first().locator("h3").innerText()).trim();
  const moviesResponse = await page.request.get(`${API_URL}/movies`);
  expect(moviesResponse.ok()).toBeTruthy();
  const movies = await moviesResponse.json() as Array<{ id: string; title: string }>;
  const selectedMovie = movies.find((movie) => movie.title === movieTitle);
  expect(selectedMovie).toBeTruthy();

  const dateSelect = page.getByLabel("Ngày chiếu");
  const laterDate = await dateSelect.locator("option").nth(1).getAttribute("value");
  expect(laterDate).toBeTruthy();
  const expectedResponse = await page.request.get(`${API_URL}/showtimes?date=${encodeURIComponent(laterDate!)}`);
  expect(expectedResponse.ok()).toBeTruthy();
  const expectedShowtimes = await expectedResponse.json() as Array<{ movieId: string }>;
  const expectedCount = expectedShowtimes.filter((showtime) => showtime.movieId === selectedMovie!.id).length;

  const refreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/showtimes") && url.searchParams.get("date") === laterDate;
  });
  await dateSelect.selectOption(laterDate!);
  const refreshed = await refreshPromise;
  expect(refreshed.ok()).toBeTruthy();
  await expect(page.locator(".showtime-card")).toHaveCount(expectedCount);
});

test("[TC-E2E-08] Axe không báo lỗi serious hoặc critical ở sơ đồ ghế và checkout", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "customer@cinema.local", "CinemaCustomer123!");
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();

  const seatDialog = page.getByRole("dialog");
  const availableSeat = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])').first();
  await expect(availableSeat).toBeVisible();
  await waitForOverlayAnimations(page);
  expect(seriousAxeViolations((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);

  await page.route("**/api/holds", async (route) => {
    const input = route.request().postDataJSON() as { showtimeId: string; seatIds: string[] };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      id: `axe-hold-${Date.now()}`,
      showtimeId: input.showtimeId,
      seatIds: input.seatIds,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      totalVnd: 85_000,
      status: "HELD",
    }) });
  });
  await availableSeat.click();
  await seatDialog.getByTestId("hold-submit").click();
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await expect(page.getByTestId("checkout-submit")).toBeEnabled();
  await waitForOverlayAnimations(page);
  expect(seriousAxeViolations((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
});

test("[TC-E2E-09][TC-PLAN-06] Bàn phím đi từ đăng nhập đến ghế chọn và nút checkout", async ({ page }) => {
  const keyboardEmail = uniqueEmail();
  const registration = await page.request.post(`${API_URL}/auth/register`, { data: { name: "Keyboard QA Customer", email: keyboardEmail, password: "CinemaQa123!" } });
  expect(registration.status()).toBe(201);
  await page.goto("/");

  const desktopLogin = page.getByRole("button", { name: "Đăng nhập", exact: true });
  const loginLauncher = await desktopLogin.isVisible() ? desktopLogin : page.getByRole("button", { name: "Mở tài khoản" });
  await tabUntilFocused(page, loginLauncher, 30);
  await expectVisibleKeyboardFocus(loginLauncher);
  await page.keyboard.press("Enter");

  const loginDialog = page.getByRole("dialog");
  const email = loginDialog.getByLabel("Email");
  const password = loginDialog.getByLabel("Mật khẩu");
  await expect(email).toBeFocused();
  await expectVisibleKeyboardFocus(email);
  await expect(email).toHaveAccessibleName("Email");
  await page.keyboard.type(keyboardEmail);
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await expect(password).toHaveAccessibleName("Mật khẩu");
  await page.keyboard.type("CinemaQa123!");
  await page.keyboard.press("Tab");
  const loginSubmit = loginDialog.getByRole("button", { name: "Đăng nhập", exact: true });
  await expectVisibleKeyboardFocus(loginSubmit);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);

  const movieContinue = page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" });
  await tabUntilFocused(page, movieContinue, 40);
  await expectVisibleKeyboardFocus(movieContinue);
  await page.keyboard.press("Enter");
  const showtime = page.getByTestId("showtime-option").first();
  await tabUntilFocused(page, showtime, 80);
  await expectVisibleKeyboardFocus(showtime);
  await page.keyboard.press("Enter");

  const seatDialog = page.getByRole("dialog");
  const closeSeats = seatDialog.getByRole("button", { name: "Đóng" });
  await expect(closeSeats).toBeFocused();
  const availableSeats = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])');
  const availableSeat = availableSeats.first();
  await expect(availableSeat).toBeVisible();
  await tabUntilFocused(page, availableSeat, (await seatDialog.getByTestId("seat").count()) + 3);
  await expectVisibleKeyboardFocus(availableSeat);
  await expect(availableSeat).toHaveAccessibleName(/Ghế [A-Z] \d+ — trống/);
  await page.keyboard.press("Space");
  await expect(availableSeat).toHaveAttribute("aria-pressed", "true");

  const holdButton = seatDialog.getByTestId("hold-submit");
  await tabUntilFocused(page, holdButton, (await seatDialog.getByTestId("seat").count()) + 5);
  await expectVisibleKeyboardFocus(holdButton);
  await page.keyboard.press("Enter");

  const checkoutDialog = page.getByRole("dialog");
  await expect(checkoutDialog).toBeVisible();
  const closeCheckout = checkoutDialog.getByRole("button", { name: "Đóng" });
  await expect(closeCheckout).toBeFocused();
  const checkoutButton = checkoutDialog.getByTestId("checkout-submit");
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(checkoutButton);
  await expect(checkoutButton).toHaveAccessibleName("Tiếp tục thanh toán");
  // The test stops at the focused checkout action; it creates no order or payment.
});
