import { expect, test } from "@playwright/test";

const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:4000/api";

// This test handles disposable ticket credentials; do not store them in traces,
// videos, screenshots, or test output, even when an assertion fails.
test.use({ trace: "off", screenshot: "off", video: "off" });

function nextBusinessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day") + 1)).toISOString().slice(0, 10);
}

test("[TC-E2E-32] nội dung QR có thể được chọn bằng bàn phím và dùng để soát vé", async ({ page, request }) => {
  const staffLogin = await request.post(`${API_URL}/auth/login`, { data: { email: "staff@cinema.local", password: "CinemaStaff123!" } });
  expect(staffLogin.ok()).toBeTruthy();
  const staff = await staffLogin.json() as { user: { assignedCinemaId: string } };
  const registration = await request.post(`${API_URL}/auth/register`, {
    data: { name: "QA Manual QR", email: `qa-manual-qr-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: "CinemaQa123!" },
  });
  expect(registration.status()).toBe(201);
  const customer = await registration.json() as { token: string; user: { id: string; name: string; email: string; role: string } };
  const customerHeaders = { authorization: `Bearer ${customer.token}` };
  const showtimesResponse = await request.get(`${API_URL}/showtimes?date=${nextBusinessDate()}&cinemaId=${encodeURIComponent(staff.user.assignedCinemaId)}`);
  expect(showtimesResponse.ok()).toBeTruthy();
  const showtimes = await showtimesResponse.json() as Array<{ id: string }>;
  let selection: { showtimeId: string; seatIds: string[] } | undefined;
  for (const showtime of showtimes) {
    const seatResponse = await request.get(`${API_URL}/showtimes/${encodeURIComponent(showtime.id)}/seats`);
    expect(seatResponse.ok()).toBeTruthy();
    const map = await seatResponse.json() as { seats: Array<{ id: string; status: string }> };
    const seatIds = map.seats.filter((seat) => seat.status === "AVAILABLE").slice(0, 2).map((seat) => seat.id);
    if (seatIds.length === 2) { selection = { showtimeId: showtime.id, seatIds }; break; }
  }
  expect(selection, "The disposable Staff cinema needs two available seats").toBeDefined();
  const holdResponse = await request.post(`${API_URL}/holds`, { headers: customerHeaders, data: selection });
  expect(holdResponse.status()).toBe(201);
  const hold = await holdResponse.json() as { id: string };
  const orderResponse = await request.post(`${API_URL}/orders`, { headers: customerHeaders, data: { holdId: hold.id } });
  expect(orderResponse.status()).toBe(201);
  const order = await orderResponse.json() as { id: string };
  const paymentResponse = await request.post(`${API_URL}/payments/mock/complete`, { headers: customerHeaders, data: { orderId: order.id } });
  expect(paymentResponse.ok()).toBeTruthy();
  const payment = await paymentResponse.json() as { tickets: Array<{ id: string; qrToken: string }> };
  expect(payment.tickets).toHaveLength(2);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript((session) => localStorage.setItem("cinemabooking.session", JSON.stringify(session)), customer);
  await page.goto("/");
  await page.getByRole("button", { name: "Vé của tôi", exact: true }).click();
  const card = page.getByTestId("ticket-card").first();
  await expect(card).toBeVisible();
  const disclosures = card.locator("details.ticket-manual-code");
  await expect(disclosures).toHaveCount(2);
  await expect(disclosures.first()).not.toHaveAttribute("open", "");
  const summary = disclosures.first().locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosures.first()).toHaveAttribute("open", "");
  const textField = disclosures.first().getByRole("textbox", { name: /^Nội dung mã QR vé 1/ });
  await expect(textField).toHaveAttribute("readonly", "");
  await page.keyboard.press("Tab");
  await expect(textField).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  const manualCode = await textField.inputValue();
  const selectionIsComplete = await textField.evaluate((element) => {
    const field = element as HTMLTextAreaElement;
    return field.selectionStart === 0 && field.selectionEnd === field.value.length;
  });
  expect(selectionIsComplete, "Keyboard selection should include the entire QR content").toBe(true);
  expect(payment.tickets.some((ticket) => ticket.qrToken === manualCode), "Displayed QR content must match a purchased ticket").toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await disclosures.nth(1).locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(disclosures.nth(1).getByRole("textbox", { name: /^Nội dung mã QR vé 2/ })).toBeVisible();
  await expect(disclosures.first().getByRole("textbox")).toHaveCount(1);
  await expect(card.locator("textarea")).toHaveCount(2);

  for (const viewport of [{ width: 320, height: 800 }, { width: 800, height: 320 }]) {
    await page.setViewportSize(viewport);
    const layout = await card.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        cardLeft: bounds.left,
        cardRight: bounds.right,
        viewportWidth: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
    expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth);
    const ticketContentSelector = [
      ".ticket-main",
      ".ticket-meta",
      ".ticket-main h3",
      ".ticket-details",
      ".ticket-bottom",
      ".ticket-codes",
      ".ticket-code",
      ".ticket-code svg",
      ".ticket-manual-code",
      "textarea",
    ].join(", ");
    const nestedContent = await card.locator(ticketContentSelector).evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      }),
    );
    expect(nestedContent.length).toBeGreaterThan(0);
    expect(nestedContent.every(({ left, right, scrollWidth, clientWidth }) =>
      left >= layout.cardLeft - 1 && right <= layout.cardRight + 1 && scrollWidth <= clientWidth + 1,
    )).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 800 });

  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByRole("button", { name: /Mở tài khoản/ }).click();
  await page.getByLabel("Email").fill("staff@cinema.local");
  await page.getByLabel("Mật khẩu").fill("CinemaStaff123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Soát vé", exact: true }).click();
  await page.getByLabel("Mã QR vé").fill(manualCode);
  await page.getByRole("button", { name: "Xác nhận vào rạp" }).click();
  await expect(page.getByRole("status")).toContainText("Vé hợp lệ");
  await page.getByLabel("Mã QR vé").fill(manualCode);
  await page.getByRole("button", { name: "Xác nhận vào rạp" }).click();
  await expect(page.getByRole("alert")).toContainText("đã được sử dụng");
  const ordersResponse = await request.get(`${API_URL}/orders/me`, { headers: customerHeaders });
  expect(ordersResponse.ok()).toBeTruthy();
  const orders = await ordersResponse.json() as { items: Array<{ id: string; seats: Array<{ label: string }>; tickets: Array<{ qrToken: string; seatLabel: string | null; checkedInAt: string | null }> }> };
  const purchased = orders.items.find((item) => item.id === order.id)!;
  expect(purchased.tickets.map((item) => item.seatLabel).sort()).toEqual(purchased.seats.map((item) => item.label).sort());
  expect(purchased.tickets.filter((item) => item.checkedInAt)).toHaveLength(1);
  expect(purchased.tickets.find((item) => item.qrToken === manualCode)?.checkedInAt).toBeTruthy();
  const otherRegistration = await request.post(`${API_URL}/auth/register`, {
    data: { name: "QA Other Customer", email: `qa-other-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: "CinemaQa123!" },
  });
  expect(otherRegistration.status()).toBe(201);
  const otherCustomer = await otherRegistration.json() as { token: string };
  const otherHeaders = { authorization: `Bearer ${otherCustomer.token}` };
  expect((await request.get(`${API_URL}/orders/${encodeURIComponent(order.id)}`, { headers: otherHeaders })).status()).toBe(404);
  const otherOrders = await request.get(`${API_URL}/orders/me`, { headers: otherHeaders });
  expect(otherOrders.ok()).toBeTruthy();
  const otherPage = await otherOrders.json() as { items: Array<{ id: string }> };
  expect(otherPage.items.some((item) => item.id === order.id)).toBe(false);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByRole("button", { name: /Mở tài khoản/ }).click();
  await page.getByLabel("Email").fill(customer.user.email);
  await page.getByLabel("Mật khẩu").fill("CinemaQa123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Vé của tôi", exact: true }).click();
  for (const ticket of purchased.tickets) {
    const code = page.getByTestId("ticket-card").first().locator(".ticket-code").filter({ has: page.getByText(`Ghế ${ticket.seatLabel}`, { exact: true }) });
    await expect(code).toContainText(ticket.checkedInAt ? "Đã vào rạp" : "Chưa vào rạp");
  }
});
