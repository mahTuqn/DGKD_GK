import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:4000/api";
const PREVIEW_URL = process.env.E2E_PREVIEW_URL || "http://127.0.0.1:5174/";
const uniqueEmail = () => `qa-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
const amountFromCurrencyText = (text: string) => Number(text.replace(/\D/g, ""));
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function wcagAxe(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS);
}

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

function axeViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target), failureSummaries: nodes.map((node) => node.failureSummary) }));
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
  const holdResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/api/holds"));
  await seatDialog.getByTestId("hold-submit").click();
  const holdResponse = await holdResponsePromise;
  expect(holdResponse.ok()).toBeTruthy();
  const hold = await holdResponse.json() as { totalVnd: number };
  expect(Number.isSafeInteger(hold.totalVnd)).toBe(true);
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
  await expect(page.locator(".checkout-dialog").getByRole("button", { name: "Đóng" })).toBeFocused();
  const displayedTotal = page.locator(".summary-total b");
  await expect.poll(async () => amountFromCurrencyText(await displayedTotal.innerText())).toBe(hold.totalVnd);
  const orderResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/api/orders"));
  await page.getByTestId("checkout-submit").focus();
  await expect(page.getByTestId("checkout-submit")).toBeFocused();
  await page.keyboard.press("Enter");
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.ok()).toBeTruthy();
  const order = await orderResponse.json() as { totalVnd: number };
  expect(order.totalVnd).toBe(hold.totalVnd);
  await expect(page.getByTestId("pay-submit")).toBeVisible();
  await expect(page.getByTestId("pay-submit")).toBeFocused();
  await expect.poll(async () => amountFromCurrencyText(await page.getByTestId("pay-submit").innerText())).toBe(order.totalVnd);
  await expect.poll(async () => amountFromCurrencyText(await displayedTotal.innerText())).toBe(order.totalVnd);
  await page.keyboard.press("Enter");
  const checkoutDialog = page.locator(".checkout-dialog");
  await expect(checkoutDialog.getByRole("heading", { name: "Hẹn gặp bạn tại rạp." })).toBeVisible();
  await expect(checkoutDialog.getByText("Thanh toán demo thành công.")).toBeVisible();
  await expect(checkoutDialog.getByRole("button", { name: "Xem vé của tôi" })).toBeFocused();
  await waitForOverlayAnimations(page);
  expect(axeViolations((await wcagAxe(page).include(".checkout-dialog").analyze()).violations)).toEqual([]);
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
  const orders = await response.json() as { items: Array<{ tickets: Array<{ qrToken: string }> }>; nextCursor: string | null };
  const qrToken = orders.items.flatMap((order) => order.tickets).at(0)?.qrToken;
  expect(qrToken, "The confirmed order should contain a QR token").toBeTruthy();
  return qrToken as string;
}

function businessDateOffset(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day") + days)).toISOString().slice(0, 10);
}

async function createPaidOrders(request: APIRequestContext, page: Page, count: number) {
  const token = await page.evaluate(() => (JSON.parse(localStorage.getItem("cinemabooking.session") || "null") as { token?: string } | null)?.token);
  expect(token, "Customer session token should exist before creating pagination fixtures").toBeTruthy();
  const headers = { authorization: `Bearer ${token}` };
  const showtimesResponse = await request.get(`${API_URL}/showtimes?date=${businessDateOffset(1)}`);
  expect(showtimesResponse.ok()).toBeTruthy();
  const showtimes = await showtimesResponse.json() as Array<{ id: string }>;
  expect(showtimes.length, "The seeded test database should contain showtimes for the next business day").toBeGreaterThan(0);

  const seatGroups = await Promise.all(showtimes.map(async (showtime) => {
    const seatsResponse = await request.get(`${API_URL}/showtimes/${encodeURIComponent(showtime.id)}/seats`);
    expect(seatsResponse.ok(), `Load seat map for showtime ${showtime.id}`).toBeTruthy();
    const seatMap = await seatsResponse.json() as { seats: Array<{ id: string; status: string }> };
    return { showtimeId: showtime.id, seats: seatMap.seats.filter((seat) => seat.status === "AVAILABLE") };
  }));

  // Spread purchased fixtures round-robin so both browser projects can run against the same DB
  // without exhausting one seeded showtime's auditorium.
  const availableSeats: Array<{ showtimeId: string; id: string }> = [];
  for (let seatIndex = 0; availableSeats.length < count; seatIndex += 1) {
    for (const group of seatGroups) {
      const seat = group.seats[seatIndex];
      if (seat && availableSeats.length < count) availableSeats.push({ showtimeId: group.showtimeId, id: seat.id });
    }
    if (seatGroups.every((group) => seatIndex >= group.seats.length)) break;
  }
  expect(availableSeats, "The available seeded showtimes should have enough free seats for the isolated history fixture").toHaveLength(count);

  for (const seat of availableSeats) {
    const holdResponse = await request.post(`${API_URL}/holds`, { headers, data: { showtimeId: seat.showtimeId, seatIds: [seat.id] } });
    expect(holdResponse.status(), `Hold seat ${seat.id}`).toBe(201);
    const hold = await holdResponse.json() as { id: string };
    const orderResponse = await request.post(`${API_URL}/orders`, { headers, data: { holdId: hold.id } });
    expect(orderResponse.status(), `Create order for seat ${seat.id}`).toBe(201);
    const order = await orderResponse.json() as { id: string };
    const paymentResponse = await request.post(`${API_URL}/payments/mock/complete`, { headers, data: { orderId: order.id } });
    expect(paymentResponse.ok(), `Complete demo payment for seat ${seat.id}`).toBeTruthy();
  }
}

async function loginApi(request: APIRequestContext, email: string, password: string) {
  const response = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  expect(response.ok(), `API login for ${email}`).toBeTruthy();
  return await response.json() as { token: string; user: { id: string; assignedCinemaId: string | null } };
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

test("[TC-E2E-01][TC-E2E-26] customer đăng ký, đặt vé, quét axe màn hình thanh toán thành công và xem vé", async ({ page }) => {
  await registerCustomer(page);
  await buyOneTicket(page);
  expect(axeViolations((await wcagAxe(page).include(".content-page").analyze()).violations)).toEqual([]);
});

test("[TC-E2E-30] customer tải tiếp lịch sử vé qua cursor và không trùng đơn", async ({ page, request }) => {
  test.setTimeout(60_000);
  await registerCustomer(page);
  await buyOneTicket(page);
  await createPaidOrders(request, page, 20);

  await page.getByRole("button", { name: /Cập nhật vé/ }).click();
  const ticketCards = page.getByTestId("ticket-card");
  await expect(ticketCards).toHaveCount(20);
  const loadMore = page.getByRole("button", { name: "Tải thêm vé" });
  await expect(loadMore).toBeVisible();
  await loadMore.click();
  await expect(ticketCards).toHaveCount(21);
  await expect(loadMore).toHaveCount(0);

  const orderLabels = await ticketCards.locator(".ticket-meta .muted").allTextContents();
  expect(new Set(orderLabels).size).toBe(21);
});

test("[TC-E2E-31] Staff nhận cảnh báo khi quét vé ngoài rạp được phân công", async ({ page, request }) => {
  await registerCustomer(page);
  await buyOneTicket(page);
  const qrToken = await getNewestTicketQrToken(page);

  const adminSession = await loginApi(request, "admin@cinema.local", "CinemaAdmin123!");
  const staffSession = await loginApi(request, "staff@cinema.local", "CinemaStaff123!");
  const originalStaffCinemaId = staffSession.user.assignedCinemaId;
  expect(originalStaffCinemaId, "Seeded Staff account should have an assigned cinema").toBeTruthy();
  const cinemaName = `QA Wrong-Cinema ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let cinemaId: string | undefined;
  let testFailed = false;
  let testFailure: unknown;
  const cleanupFailures: string[] = [];

  try {
    const newCinemaResponse = await request.post(`${API_URL}/admin/cinemas`, {
      headers: { authorization: `Bearer ${adminSession.token}` },
      data: { name: cinemaName, city: "Hồ Chí Minh", address: "Địa chỉ kiểm thử soát vé sai rạp" }
    });
    expect(newCinemaResponse.status()).toBe(201);
    const cinema = await newCinemaResponse.json() as { id: string };
    cinemaId = cinema.id;
    const reassignment = await request.patch(`${API_URL}/admin/users/${encodeURIComponent(staffSession.user.id)}/assigned-cinema`, {
      headers: { authorization: `Bearer ${adminSession.token}` },
      data: { cinemaId }
    });
    expect(reassignment.ok()).toBeTruthy();

    await page.evaluate(() => localStorage.removeItem("cinemabooking.session"));
    await page.reload();
    await openLogin(page);
    await page.getByLabel("Email").fill("staff@cinema.local");
    await page.getByLabel("Mật khẩu").fill("CinemaStaff123!");
    await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.getByRole("button", { name: "Soát vé" }).click();

    await page.getByLabel("Mã QR vé").fill(qrToken);
    await page.getByRole("button", { name: "Xác nhận vào rạp" }).click();
    await expect(page.getByRole("alert")).toContainText("Nhân viên chỉ được soát vé tại rạp được phân công.");
    await expect(page.getByRole("status")).toHaveCount(0);

    // The Admin can still scan the ticket, proving the rejected Staff attempt did not consume it.
    const adminScan = await request.post(`${API_URL}/tickets/scan`, {
      headers: { authorization: `Bearer ${adminSession.token}` },
      data: { qrToken }
    });
    expect(adminScan.status()).toBe(200);
  } catch (error) {
    testFailed = true;
    testFailure = error;
  } finally {
    const authorization = { authorization: `Bearer ${adminSession.token}` };
    const attemptCleanup = async (label: string, action: () => Promise<{ ok(): boolean; status(): number }>) => {
      try {
        const response = await action();
        if (!response.ok()) cleanupFailures.push(`${label} returned HTTP ${response.status()}`);
      } catch (error) {
        cleanupFailures.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await attemptCleanup("Restore seeded Staff cinema assignment", () => request.patch(`${API_URL}/admin/users/${encodeURIComponent(staffSession.user.id)}/assigned-cinema`, {
      headers: authorization,
      data: { cinemaId: originalStaffCinemaId }
    }));
    if (!cinemaId) {
      try {
        const response = await request.get(`${API_URL}/admin/cinemas`, { headers: authorization });
        if (!response.ok()) cleanupFailures.push(`Find temporary wrong-cinema fixture returned HTTP ${response.status()}`);
        else {
          const cinemas = await response.json() as Array<{ id: string; name: string }>;
          cinemaId = cinemas.find((cinema) => cinema.name === cinemaName)?.id;
        }
      } catch (error) {
        cleanupFailures.push(`Find temporary wrong-cinema fixture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (cinemaId) {
      await attemptCleanup("Deactivate temporary wrong-cinema fixture", () => request.patch(`${API_URL}/admin/cinemas/${encodeURIComponent(cinemaId!)}`, {
        headers: authorization,
        data: { status: "INACTIVE" }
      }));
    }
  }

  if (testFailed) throw testFailure;
  expect(cleanupFailures, "Test cleanup must restore Staff and deactivate the temporary cinema").toEqual([]);
});

test("[TC-E2E-02] trang khám phá và dialog đăng nhập không có lỗi axe nghiêm trọng", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  const result = await wcagAxe(page).analyze();
  expect(axeViolations(result.violations)).toEqual([]);

  const desktopLogin = page.getByRole("button", { name: "Đăng nhập", exact: true });
  const restoreFocus = await desktopLogin.isVisible() ? desktopLogin : page.getByRole("button", { name: "Mở tài khoản" });
  await openLogin(page);
  const loginDialog = page.locator(".auth-dialog");
  await expect(loginDialog).toBeVisible();
  await waitForOverlayAnimations(page);
  expect(axeViolations((await wcagAxe(page).include(".auth-dialog").analyze()).violations)).toEqual([]);

  const email = loginDialog.getByLabel("Email");
  await expect(email).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(loginDialog.getByRole("button", { name: "Đóng" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(loginDialog.getByRole("button", { name: "Tạo tài khoản mới" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(loginDialog.getByRole("button", { name: "Đóng" })).toBeFocused();
  await expect(loginDialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Shift+Tab");
  await expect(loginDialog.getByRole("button", { name: "Tạo tài khoản mới" })).toBeFocused();
  await expect(loginDialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(loginDialog).toBeHidden();
  await expect(restoreFocus).toBeFocused();
});

test("[TC-E2E-03][TC-E2E-25] Staff soát QR bằng bàn phím ở 320px và thông báo thành công/lỗi có thể tiếp cận", async ({ page }) => {
  await registerCustomer(page);
  await buyOneTicket(page);
  const qrToken = await getNewestTicketQrToken(page);

  // Prepare the small-viewport Staff flow before the keyboard-only section begins.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => localStorage.removeItem("cinemabooking.session"));
  await page.reload();

  const loginLauncher = page.getByRole("button", { name: "Mở tài khoản", exact: true });
  await tabUntilFocused(page, loginLauncher, 30);
  await expectVisibleKeyboardFocus(loginLauncher);
  await expect(loginLauncher).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");

  const loginDialog = page.getByRole("dialog");
  const email = loginDialog.getByLabel("Email");
  const password = loginDialog.getByLabel("Mật khẩu");
  await expectVisibleKeyboardFocus(email);
  await expect(email).toBeInViewport({ ratio: 1 });
  await page.keyboard.type("staff@cinema.local");
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(password);
  await expect(password).toBeInViewport({ ratio: 1 });
  await page.keyboard.type("CinemaStaff123!");
  await page.keyboard.press("Tab");
  const loginSubmit = loginDialog.getByRole("button", { name: "Đăng nhập", exact: true });
  await expectVisibleKeyboardFocus(loginSubmit);
  await expect(loginSubmit).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("cinemabooking.session")))).toBe(true);
  const discoverNavigation = page.getByRole("button", { name: "Khám phá", exact: true });
  await expectVisibleKeyboardFocus(discoverNavigation);
  await expect(discoverNavigation).toBeInViewport({ ratio: 1 });

  const staffNavigation = page.getByRole("button", { name: "Soát vé", exact: true });
  await expect(staffNavigation).toBeVisible();
  await tabUntilFocused(page, staffNavigation, 40);
  await expectVisibleKeyboardFocus(staffNavigation);
  await expect(staffNavigation).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Soát vé tại cửa" })).toBeVisible();
  await expectVisibleKeyboardFocus(staffNavigation);
  await expect(staffNavigation).toBeInViewport({ ratio: 1 });
  const scanInput = page.getByLabel("Mã QR vé");
  await tabUntilFocused(page, scanInput, 40);
  await expectVisibleKeyboardFocus(scanInput);
  await expect(scanInput).toBeInViewport({ ratio: 1 });
  await page.keyboard.type(qrToken);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Vé hợp lệ");
  await expectVisibleKeyboardFocus(scanInput);
  await expect(scanInput).toBeInViewport({ ratio: 1 });
  expect(axeViolations((await wcagAxe(page).include(".scan-panel").analyze()).violations)).toEqual([]);

  await page.keyboard.type(qrToken);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("đã được sử dụng");
  await expectVisibleKeyboardFocus(scanInput);
  await expect(scanInput).toBeInViewport({ ratio: 1 });
  expect(axeViolations((await wcagAxe(page).include(".scan-panel").analyze()).violations)).toEqual([]);

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("invalid-qr-token-that-is-not-in-db");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Mã vé không hợp lệ");
  await expectVisibleKeyboardFocus(scanInput);
  await expect(scanInput).toBeInViewport({ ratio: 1 });
  expect(axeViolations((await wcagAxe(page).include(".scan-panel").analyze()).violations)).toEqual([]);
});

test("[TC-E2E-23] hai lượt quét QR đồng thời chỉ ghi nhận một vé", async ({ page }) => {
  await registerCustomer(page);
  await buyOneTicket(page);
  const qrToken = await getNewestTicketQrToken(page);

  await page.evaluate(() => localStorage.removeItem("cinemabooking.session"));
  await page.reload();
  await openLogin(page);
  await page.getByLabel("Email").fill("staff@cinema.local");
  await page.getByLabel("Mật khẩu").fill("CinemaStaff123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Soát vé" }).click();

  const competingPage = await page.context().newPage();
  await competingPage.goto("/");
  await expect(competingPage.getByTestId("movie-card").first()).toBeVisible();
  await expect(competingPage.getByRole("button", { name: "Soát vé", exact: true })).toBeVisible();
  await competingPage.getByRole("button", { name: "Soát vé", exact: true }).click();

  const scannerPages = [page, competingPage];
  for (const scannerPage of scannerPages) {
    await scannerPage.getByLabel("Mã QR vé").fill(qrToken);
  }

  let releaseConcurrentScans!: () => void;
  const bothScansQueued = new Promise<void>((resolve) => {
    releaseConcurrentScans = resolve;
  });
  let queuedScanCount = 0;
  await page.context().route("**/api/tickets/scan", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    queuedScanCount += 1;
    if (queuedScanCount === 2) releaseConcurrentScans();
    await bothScansQueued;
    await route.continue();
  });

  const responsePromises = scannerPages.map((scannerPage) => scannerPage.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/tickets/scan",
  ));
  await Promise.all(scannerPages.map((scannerPage) =>
    scannerPage.getByRole("button", { name: "Xác nhận vào rạp" }).click(),
  ));
  const scanResponses = await Promise.all(responsePromises);

  expect(scanResponses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const winnerIndex = scanResponses.findIndex((response) => response.status() === 200);
  const conflictIndex = scanResponses.findIndex((response) => response.status() === 409);
  expect(winnerIndex).toBeGreaterThanOrEqual(0);
  expect(conflictIndex).toBeGreaterThanOrEqual(0);
  await expect(scannerPages[winnerIndex]!.getByRole("status")).toContainText("Vé hợp lệ");
  await expect(scannerPages[conflictIndex]!.getByRole("alert")).toContainText("đã được sử dụng");
});





test("[TC-E2E-04] Admin xem báo cáo doanh thu và tỉ lệ lấp đầy ở chế độ chỉ đọc", async ({ page }) => {
  await page.goto("/");
  await openLogin(page);
  await page.getByLabel("Email").fill("admin@cinema.local");
  await page.getByLabel("Mật khẩu").fill("CinemaAdmin123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const summaryResponsePromise = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/api/admin/summary"));
  await page.getByRole("button", { name: "Quản trị" }).click();
  const summaryResponse = await summaryResponsePromise;
  expect(summaryResponse.ok()).toBeTruthy();
  const summary = await summaryResponse.json() as { confirmedRevenueVnd: number };

  const revenue = page.locator(".metric-revenue");
  await expect(revenue).toContainText("Doanh thu xác nhận");
  await expect.poll(async () => amountFromCurrencyText(await revenue.locator("b").innerText())).toBe(summary.confirmedRevenueVnd);
  const occupancy = page.locator(".occupancy-panel");
  await expect(occupancy).toBeVisible();
  await expect(occupancy.getByRole("heading", { name: "Mức lấp đầy chỗ ngồi" })).toBeVisible();
  await expect(occupancy.getByText(/[\d.,]+ \/ [\d.,]+ ghế đã bán/)).toBeVisible();
  await expect(occupancy.getByText(/\d+ suất đang mở/)).toBeVisible();
  const occupancyProgress = occupancy.getByRole("progressbar", { name: "Tỉ lệ lấp đầy ghế" });
  await expect(occupancyProgress).toHaveAttribute("value", /\d/);
  expect(axeViolations((await wcagAxe(page).include(".admin-view").analyze()).violations)).toEqual([]);

  const metricLabels = ["Phim đang chiếu", "Suất chiếu", "Đơn đặt vé", "Vé đã phát", "Tỉ lệ lấp đầy", "Doanh thu xác nhận"];
  for (const viewport of [{ width: 320, height: 800 }, { width: 800, height: 320 }]) {
    await page.setViewportSize(viewport);

    const widths = await page.evaluate(() => {
      const dashboard = document.querySelector<HTMLElement>(".admin-view");
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        dashboardClient: dashboard?.clientWidth ?? 0,
        dashboardScroll: dashboard?.scrollWidth ?? 0
      };
    });
    expect(widths.document, `document must not overflow horizontally at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(widths.viewport);
    expect(widths.dashboardClient, "Admin dashboard should remain mounted").toBeGreaterThan(0);
    expect(widths.dashboardScroll, `Admin dashboard must not overflow horizontally at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(widths.dashboardClient);

    for (const label of metricLabels) {
      await expect(page.locator(".admin-metrics").getByText(label, { exact: true }), `${label} remains available at ${viewport.width}×${viewport.height}`).toBeVisible();
    }
    await expect(occupancy, `occupancy summary remains available at ${viewport.width}×${viewport.height}`).toBeVisible();
    await expect(occupancyProgress, `occupancy progressbar remains available at ${viewport.width}×${viewport.height}`).toBeVisible();
    await occupancyProgress.scrollIntoViewIfNeeded();
    await expect(occupancyProgress).toBeInViewport();
  }
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
  await page.addInitScript(() => {
    (window as Window & { __cinemaXss?: number }).__cinemaXss = 0;
  });
  await page.goto("/");
  await signIn(page, "admin@cinema.local", "CinemaAdmin123!");
  await page.getByRole("button", { name: "Quản trị" }).click();

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const payload = `<img src=x data-qa="${suffix}" onerror="window.__cinemaXss=1">`;
  const cityPayload = `<svg data-qa-city="${suffix}" onload="window.__cinemaXss=2">XSS City ${suffix}</svg>`;
  const addressPayload = `<script data-qa-address="${suffix}">window.__cinemaXss=3</script>`;
  const cinemaPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Quản lý rạp" }) });
  await cinemaPanel.getByLabel("Tên rạp").fill(payload);
  await cinemaPanel.getByLabel("Thành phố").fill(cityPayload);
  await cinemaPanel.getByLabel("Địa chỉ").fill(addressPayload);
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/cinemas",
  );
  await cinemaPanel.getByRole("button", { name: "Thêm rạp" }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  expect(await createResponse.json()).toMatchObject({
    name: payload,
    city: cityPayload,
    address: addressPayload,
  });

  const row = cinemaPanel.locator(".admin-record-row").filter({ hasText: payload });
  await expect(row).toBeVisible();
  await expect(row.getByText(payload, { exact: true })).toBeVisible();
  await expect(row.locator("span")).toContainText(cityPayload);
  await expect(row.locator("span")).toContainText(addressPayload);
  await expect(row.locator("img, script, svg")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { __cinemaXss?: number }).__cinemaXss)).toBe(0);
});

test("[TC-E2E-06] Bộ lọc phim và rạp cập nhật đúng các suất đang hiển thị", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const date = await page.getByLabel("Ngày xem phim").inputValue();
  await expect(page.getByLabel("Ngày xem phim")).toHaveAccessibleName("Ngày xem phim");
  await expect(page.getByLabel("Rạp chiếu")).toHaveAccessibleName("Rạp chiếu");
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
  await expect(page.getByLabel("Rạp chiếu").locator(`option[value="${selectedCinemaId}"]`)).toHaveCount(1);
  const filteredResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/showtimes") && url.searchParams.get("cinemaId") === selectedCinemaId;
  });
  await page.getByLabel("Rạp chiếu").selectOption(selectedCinemaId);
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

  const dateSelect = page.getByLabel("Ngày xem phim");
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
  await expect(page.locator("#schedule").getByRole("status")).toHaveText(expectedCount
    ? `${expectedCount} suất chiếu phù hợp cho ${movieTitle}.`
    : "Không có suất chiếu phù hợp. Hãy thử ngày hoặc rạp khác.");
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
  expect(axeViolations((await wcagAxe(page).analyze()).violations)).toEqual([]);

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
  expect(axeViolations((await wcagAxe(page).analyze()).violations)).toEqual([]);
});

test("[TC-E2E-39] Checkout reflows and keeps keyboard focus visible at narrow portrait and landscape sizes", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await signIn(page, "customer@cinema.local", "CinemaCustomer123!");
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();

  const seatDialog = page.getByRole("dialog");
  const availableSeat = seatDialog.locator('[data-testid="seat"][aria-label*="trống"]:not([disabled])').first();
  await expect(availableSeat).toBeVisible();
  await page.route("**/api/holds", async (route) => {
    const input = route.request().postDataJSON() as { showtimeId: string; seatIds: string[] };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      id: `a11y-reflow-hold-${Date.now()}`,
      showtimeId: input.showtimeId,
      seatIds: input.seatIds,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      totalVnd: 85_000,
      status: "HELD",
    }) });
  });
  await availableSeat.click();
  await seatDialog.getByTestId("hold-submit").click();

  const checkoutDialog = page.getByRole("dialog", { name: "Một bước nữa thôi." });
  const closeButton = checkoutDialog.getByRole("button", { name: "Đóng" });
  const checkoutButton = checkoutDialog.getByTestId("checkout-submit");
  const summary = checkoutDialog.locator(".checkout-summary");
  await expect(checkoutDialog).toBeVisible();
  await expect(summary).toContainText("Ghế:");
  await expect(summary).toContainText("Tạm tính");
  await expect(summary).toContainText("Tổng thanh toán");
  await expect(checkoutButton).toBeEnabled();

  const expectNoHorizontalOverflow = async () => {
    const dimensions = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".checkout-dialog");
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        dialogClientWidth: dialog?.clientWidth ?? 0,
        dialogScrollWidth: dialog?.scrollWidth ?? 0,
      };
    });
    expect(dimensions.pageScrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.dialogClientWidth).toBeGreaterThan(0);
    expect(dimensions.dialogScrollWidth).toBeLessThanOrEqual(dimensions.dialogClientWidth);
  };

  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(checkoutButton);
  await expect(checkoutButton).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Shift+Tab");
  await expectVisibleKeyboardFocus(closeButton);
  await expect(closeButton).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(checkoutButton);
  await expect(checkoutButton).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow();

  await page.setViewportSize({ width: 800, height: 320 });
  await page.keyboard.press("Shift+Tab");
  await expectVisibleKeyboardFocus(closeButton);
  await expect(closeButton).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(checkoutButton);
  await expect(checkoutButton).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow();

  // Stop before order creation or payment; this regression is limited to checkout reflow and focus.
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
  await expect(page.locator("#schedule h2")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Ngày xem phim")).toBeFocused();
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
  const lastAvailableSeat = availableSeats.last();
  await page.keyboard.press("Shift+Tab");
  await expect(lastAvailableSeat).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeSeats).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(availableSeat).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(seatDialog).toBeHidden();
  await expect(showtime).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(seatDialog).toBeVisible();
  await expect(closeSeats).toBeFocused();
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
  await page.keyboard.press("Shift+Tab");
  await expectVisibleKeyboardFocus(checkoutButton);
  await page.keyboard.press("Tab");
  await expect(closeCheckout).toBeFocused();
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(checkoutButton);
  await expect(checkoutButton).toHaveAccessibleName("Tiếp tục thanh toán");

  let releaseOrder!: () => void;
  const orderGate = new Promise<void>((resolve) => { releaseOrder = resolve; });
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await orderGate;
    await route.continue();
  });
  const orderRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/api/orders"));
  await page.keyboard.press("Enter");
  await orderRequest;
  await closeCheckout.focus();
  releaseOrder();
  await expect(checkoutDialog.getByTestId("pay-submit")).toBeVisible();
  await expect(closeCheckout).toBeFocused();
  await page.unroute("**/api/orders");
  await page.keyboard.press("Escape");
  await expect(checkoutDialog).toBeHidden();
  await expect(showtime).toBeFocused();
  // The test creates an order but stops without making a payment.
});
