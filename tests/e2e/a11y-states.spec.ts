import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const movie = {
  id: "a11y-movie",
  slug: "a11y-feature-film",
  title: "Accessibility Feature Film",
  genre: "Drama",
  synopsis: "A fixture movie for accessibility browser checks.",
  runtimeMinutes: 100,
  ageRating: "P",
  posterUrl: null,
  releaseDate: "2026-01-01",
  status: "ACTIVE",
};

const cinema = {
  id: "a11y-cinema",
  name: "Accessibility Cinema",
  city: "Test City",
  address: "1 QA Street",
  status: "ACTIVE",
};

const auditorium = {
  id: "a11y-auditorium",
  cinemaId: cinema.id,
  cinemaName: cinema.name,
  name: "Accessibility Room",
  screenType: "STANDARD",
  seatCount: 2,
  seats: [
    { id: "a11y-seat-1", label: "A1", row: "A", column: 1, type: "STANDARD", isAccessible: false },
    { id: "a11y-seat-2", label: "A2", row: "A", column: 2, type: "ACCESSIBLE", isAccessible: true },
  ],
};

const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
const endAt = new Date(Date.parse(startAt) + 100 * 60 * 1000).toISOString();
const showtime = {
  id: "a11y-showtime",
  movieId: movie.id,
  movieTitle: movie.title,
  cinemaId: cinema.id,
  cinemaName: cinema.name,
  city: cinema.city,
  auditoriumName: auditorium.name,
  startAt,
  endAt,
  date: startAt.slice(0, 10),
  priceVnd: 85_000,
  premiumSurchargeVnd: 30_000,
  screenType: "STANDARD",
  status: "ACTIVE",
};

const seatMap = {
  showtime,
  seats: [
    { id: "a11y-seat-available", label: "A1", row: "A", column: 1, type: "STANDARD", isAccessible: false, status: "AVAILABLE", priceVnd: 85_000 },
    { id: "a11y-seat-accessible", label: "A2", row: "A", column: 2, type: "ACCESSIBLE", isAccessible: true, status: "AVAILABLE", priceVnd: 85_000 },
    { id: "a11y-seat-held", label: "A3", row: "A", column: 3, type: "PREMIUM", isAccessible: false, status: "HELD", priceVnd: 115_000 },
    { id: "a11y-seat-sold", label: "A4", row: "A", column: 4, type: "ACCESSIBLE", isAccessible: true, status: "SOLD", priceVnd: 85_000 },
  ],
};

type MockOptions = {
  loginError?: { status: number; error: string; message: string };
  registrationError?: { status: number; error: string; message: string };
  movieTitles?: string[];
  discoveryFilterFixture?: {
    cinemas: Array<Pick<typeof cinema, "id" | "name" | "city">>;
    showtimes: Array<typeof showtime>;
  };
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockApi(page: Page, options: MockOptions = {}) {
  const requests = { login: 0, registration: 0 };
  let discoveryFixtureAvailableDate: string | null = null;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (request.method() === "GET" && pathname === "/api/movies") {
      const movies = options.movieTitles?.length
        ? options.movieTitles.map((title, index) => ({
          ...movie,
          id: index === 0 ? movie.id : `${movie.id}-${index}`,
          slug: index === 0 ? movie.slug : `${movie.slug}-${index}`,
          title,
        }))
        : [movie];
      await fulfillJson(route, 200, movies);
    } else if (request.method() === "GET" && pathname === "/api/showtimes") {
      const fixture = options.discoveryFilterFixture;
      if (!fixture) {
        await fulfillJson(route, 200, [showtime]);
      } else {
        const url = new URL(request.url());
        const date = url.searchParams.get("date");
        const cinemaId = url.searchParams.get("cinemaId");
        if (discoveryFixtureAvailableDate === null && date !== null) discoveryFixtureAvailableDate = date;
        const cinemaById = new Map(fixture.cinemas.map((value) => [value.id, value]));
        const fixtureShowtimes = fixture.showtimes.map((item, index) => {
          const fixtureDate = discoveryFixtureAvailableDate ?? item.date;
          const startAt = new Date(`${fixtureDate}T${18 + index * 2}:00:00+07:00`);
          return {
            ...item,
            date: fixtureDate,
            startAt: startAt.toISOString(),
            endAt: new Date(startAt.getTime() + 100 * 60_000).toISOString(),
          };
        });
        const filteredShowtimes = fixtureShowtimes
          .filter((item) => item.date === date && (!cinemaId || item.cinemaId === cinemaId))
          .map((item) => {
            const selectedCinema = cinemaById.get(item.cinemaId);
            return selectedCinema
              ? { ...item, cinemaName: selectedCinema.name, city: selectedCinema.city }
              : item;
          });
        await fulfillJson(route, 200, filteredShowtimes);
      }
    } else if (request.method() === "GET" && pathname === `/api/showtimes/${showtime.id}/seats`) {
      await fulfillJson(route, 200, seatMap);
    } else if (request.method() === "POST" && pathname === "/api/auth/login") {
      requests.login += 1;
      const error = options.loginError;
      await fulfillJson(route, error?.status ?? 401, error ?? { error: "UNAUTHORIZED", message: "Email hoặc mật khẩu không đúng." });
    } else if (request.method() === "POST" && pathname === "/api/auth/register") {
      requests.registration += 1;
      const error = options.registrationError;
      await fulfillJson(route, error?.status ?? 409, error ?? { error: "EMAIL_TAKEN", message: "Email này đã được đăng ký." });
    } else if (request.method() === "GET" && pathname === "/api/admin/summary") {
      await fulfillJson(route, 200, {
        movies: 1,
        showtimes: 1,
        orders: 0,
        tickets: 0,
        confirmedRevenueVnd: 0,
        occupancy: { showtimeCount: 1, soldSeats: 0, capacitySeats: 2, fillRatePercent: 0, definition: "Fixture occupancy." },
      });
    } else if (request.method() === "GET" && pathname === "/api/admin/users") {
      await fulfillJson(route, 200, { items: [], nextCursor: null });
    } else if (request.method() === "GET" && pathname === "/api/admin/movies") {
      await fulfillJson(route, 200, [movie]);
    } else if (request.method() === "GET" && pathname === "/api/admin/cinemas") {
      await fulfillJson(route, 200, [{ ...cinema, auditoriums: [{ id: auditorium.id, name: auditorium.name, screenType: auditorium.screenType, seatCount: auditorium.seatCount }] }]);
    } else if (request.method() === "GET" && pathname === "/api/admin/auditoriums") {
      await fulfillJson(route, 200, [auditorium]);
    } else if (request.method() === "GET" && pathname === "/api/admin/showtimes") {
      await fulfillJson(route, 200, [showtime]);
    } else {
      await fulfillJson(route, 404, { error: "NOT_FOUND", message: "Unexpected mocked API request." });
    }
  });

  return requests;
}

function allAxeViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target), failureSummaries: nodes.map((node) => node.failureSummary) }));
}

async function expectNoWcagAxeViolations(page: Page, selector: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include(selector).analyze();
  expect(allAxeViolations(result.violations)).toEqual([]);
}

type CssRgb = { red: number; green: number; blue: number; alpha: number };

function parseCssRgb(value: string): CssRgb {
  const channels = value.match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unsupported computed CSS color: ${value}`);
  return { red: channels[0], green: channels[1], blue: channels[2], alpha: channels[3] ?? 1 };
}

function composite(foreground: CssRgb, background: CssRgb, opacity = 1): CssRgb {
  const alpha = foreground.alpha * opacity;
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
    alpha: 1,
  };
}

function relativeLuminance(color: CssRgb) {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(color.red) + 0.7152 * linearize(color.green) + 0.0722 * linearize(color.blue);
}

function contrastRatioOver(foregroundColor: string, backgroundColor: string, foregroundOpacity = 1) {
  const background = parseCssRgb(backgroundColor);
  const foreground = composite(parseCssRgb(foregroundColor), background, foregroundOpacity);
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test("[TC-E2E-27] mobile shows every movie title without clipping and keeps targets large enough", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const movieTitles = [
    "Thành Phố Lúc Nửa Đêm",
    "SupercalifragilisticexpialidociousCinema",
    "A11y Mobile Film Three",
    "A11y Mobile Film Four",
  ];
  await mockApi(page, { movieTitles });
  await page.goto("/");
  const movieCards = page.getByTestId("movie-card");
  await expect(movieCards).toHaveCount(movieTitles.length);
  for (const title of movieTitles) await expect(page.getByRole("heading", { name: title, level: 3 })).toBeVisible();
  const movieTitleBoxes = await page.locator(".movie-info h3").evaluateAll((elements) => {
    return elements.map((element) => ({
      clipped: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
    }));
  });
  expect(movieTitleBoxes).toHaveLength(movieTitles.length);
  expect(movieTitleBoxes.every(({ clipped }) => !clipped)).toBe(true);
  const movieActionTargets = await movieCards.getByRole("button", { name: "Xem suất chiếu" }).evaluateAll((elements) => {
    return elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
  });
  expect(movieActionTargets).toHaveLength(movieTitles.length);
  expect(movieActionTargets.every(({ width, height }) => width >= 24 && height >= 24)).toBe(true);
  const moviePageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(moviePageWidth.scrollWidth).toBeLessThanOrEqual(moviePageWidth.clientWidth);
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(movieCards).toHaveCount(movieTitles.length);
  for (const title of movieTitles) await expect(page.getByRole("heading", { name: title, level: 3 })).toBeVisible();
  const tabletMovieTitleBoxes = await page.locator(".movie-info h3").evaluateAll((elements) => {
    return elements.map((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
  });
  expect(tabletMovieTitleBoxes).toHaveLength(movieTitles.length);
  expect(tabletMovieTitleBoxes.every((clipped) => !clipped)).toBe(true);
  const tabletPageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(tabletPageWidth.scrollWidth).toBeLessThanOrEqual(tabletPageWidth.clientWidth);
  await page.setViewportSize({ width: 800, height: 320 });
  await expect(movieCards).toHaveCount(movieTitles.length);
  for (const title of movieTitles) await expect(page.getByRole("heading", { name: title, level: 3 })).toBeVisible();
  const landscapeMovieTitleBoxes = await page.locator(".movie-info h3").evaluateAll((elements) => {
    return elements.map((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
  });
  expect(landscapeMovieTitleBoxes).toHaveLength(movieTitles.length);
  expect(landscapeMovieTitleBoxes.every((clipped) => !clipped)).toBe(true);
  const landscapeActionTargets = await movieCards.getByRole("button", { name: "Xem suất chiếu" }).evaluateAll((elements) => {
    return elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
  });
  expect(landscapeActionTargets).toHaveLength(movieTitles.length);
  expect(landscapeActionTargets.every(({ width, height }) => width >= 24 && height >= 24)).toBe(true);
  const landscapePageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(landscapePageWidth.scrollWidth).toBeLessThanOrEqual(landscapePageWidth.clientWidth);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();

  const dialog = page.getByRole("dialog", { name: movie.title });
  await expect(dialog.getByTestId("seat").first()).toBeVisible();
  const seatTargetDimensions = await dialog.getByTestId("seat").evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  expect(seatTargetDimensions.length).toBeGreaterThan(0);
  expect(seatTargetDimensions.every(({ width, height }) => width >= 24 && height >= 24)).toBe(true);

  const availableSeat = dialog.getByRole("button", { name: "Ghế A 1 — trống — ghế tiêu chuẩn" });
  await expect(availableSeat).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Ghế A 2 — trống — ghế hỗ trợ tiếp cận" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Ghế A 3 — đang giữ — ghế cao cấp" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Ghế A 4 — đã bán — ghế hỗ trợ tiếp cận" })).toBeDisabled();
  await expect(dialog.locator(".seat-legend").getByText("Đang giữ", { exact: true })).toBeVisible();
  const heldPattern = await dialog.getByRole("button", { name: "Ghế A 3 — đang giữ — ghế cao cấp" }).evaluate((element) => getComputedStyle(element).backgroundImage);
  const soldPattern = await dialog.getByRole("button", { name: "Ghế A 4 — đã bán — ghế hỗ trợ tiếp cận" }).evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(heldPattern).toContain("repeating-linear-gradient");
  expect(soldPattern).toBe("none");

  const seatColors = await availableSeat.evaluate((element) => {
    const style = getComputedStyle(element);
    const panel = getComputedStyle(element.closest(".seat-dialog")!);
    return { border: style.borderTopColor, fill: style.backgroundColor, panel: panel.backgroundColor };
  });
  expect(contrastRatioOver(seatColors.border, seatColors.fill)).toBeGreaterThanOrEqual(3);
  expect(contrastRatioOver(seatColors.border, seatColors.panel)).toBeGreaterThanOrEqual(3);

  const rowLabelColors = await dialog.locator(".row-label").evaluateAll((elements) => elements.map((element) => {
    const labelStyle = getComputedStyle(element);
    const dialogStyle = getComputedStyle(element.closest(".seat-dialog")!);
    return { text: labelStyle.color, background: dialogStyle.backgroundColor };
  }));
  expect(rowLabelColors.length).toBeGreaterThan(0);
  for (const colors of rowLabelColors) {
    expect(contrastRatioOver(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  }

  const documentWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentWidth.scrollWidth).toBeLessThanOrEqual(documentWidth.clientWidth);

  const closeButton = dialog.getByRole("button", { name: "Đóng" });
  const holdButton = dialog.getByTestId("hold-submit");
  await expect(closeButton).toBeVisible();
  await expect(closeButton).toBeInViewport({ ratio: 1 });
  await expect(holdButton).toBeVisible();
  await expect(holdButton).toBeInViewport({ ratio: 1 });
});

async function openLogin(page: Page) {
  const desktopButton = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopButton.isVisible()) await desktopButton.click();
  else await page.getByRole("button", { name: "Mở tài khoản" }).click();
}

async function tabUntilFocused(page: Page, target: import("@playwright/test").Locator, maxTabs = 80) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach the expected control using Tab within ${maxTabs} steps.`);
}

test("[TC-E2E-16] dialog đăng ký có tên trường và trạng thái validation/error dễ tiếp cận", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const requests = await mockApi(page, {
    registrationError: { status: 409, error: "EMAIL_TAKEN", message: "Email này đã được đăng ký." },
  });
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  await openLogin(page);
  await page.getByRole("button", { name: "Tạo tài khoản mới" }).click();

  const dialog = page.locator(".auth-dialog");
  await expect(dialog.getByRole("heading", { name: "Tạo tài khoản mới" })).toBeVisible();
  const name = dialog.getByLabel("Họ và tên");
  const email = dialog.getByLabel("Email");
  const password = dialog.getByLabel("Mật khẩu");
  const submitButton = dialog.getByRole("button", { name: "Tạo tài khoản", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(name).toBeVisible();
  await expect(name).toBeInViewport({ ratio: 1 });
  await expect(email).toBeVisible();
  await expect(email).toBeInViewport({ ratio: 1 });
  await expect(password).toBeVisible();
  await expect(password).toBeInViewport({ ratio: 1 });
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeInViewport({ ratio: 1 });
  const widths = await dialog.evaluate((element) => ({
    document: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
    dialog: { client: element.clientWidth, scroll: element.scrollWidth },
  }));
  expect(widths.document.scroll).toBeLessThanOrEqual(widths.document.client);
  expect(widths.dialog.scroll).toBeLessThanOrEqual(widths.dialog.client);
  await tabUntilFocused(page, name);
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(submitButton).toBeFocused();
  await expect(submitButton).toBeInViewport({ ratio: 1 });
  const submitFocusStyle = await submitButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(submitFocusStyle.outlineStyle).toBe("solid");
  expect(submitFocusStyle.outlineWidth).toBeGreaterThan(0);
  await expect(name).toHaveAccessibleName("Họ và tên");
  await expect(email).toHaveAccessibleName("Email");
  await expect(password).toHaveAccessibleName("Mật khẩu");
  await expect(name).toHaveAttribute("required", "");
  await expect(email).toHaveAttribute("required", "");
  await expect(password).toHaveAttribute("required", "");
  const placeholderColors = await email.evaluate((input) => {
    const placeholder = getComputedStyle(input, "::placeholder");
    return { text: placeholder.color, opacity: Number.parseFloat(placeholder.opacity), background: getComputedStyle(input).backgroundColor };
  });
  expect(contrastRatioOver(placeholderColors.text, placeholderColors.background, placeholderColors.opacity)).toBeGreaterThanOrEqual(4.5);

  const inputColors = await email.evaluate((input) => {
    const style = getComputedStyle(input);
    const panel = getComputedStyle(input.closest(".dialog")!);
    return { border: style.borderTopColor, fill: style.backgroundColor, panel: panel.backgroundColor };
  });
  expect(contrastRatioOver(inputColors.border, inputColors.fill)).toBeGreaterThanOrEqual(3);
  expect(contrastRatioOver(inputColors.border, inputColors.panel)).toBeGreaterThanOrEqual(3);
  await expectNoWcagAxeViolations(page, ".auth-dialog");

  await submitButton.click();
  expect(await name.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(await password.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(requests.registration).toBe(0);

  await name.fill("QA Accessibility User");
  await email.fill("invalid-email");
  await password.fill("short");
  await submitButton.click();
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(await password.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(requests.registration).toBe(0);

  await email.fill("existing@example.test");
  await password.fill("CinemaQa123!");
  await submitButton.click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText("Email này đã được đăng ký.");
  expect(requests.registration).toBe(1);
  await expectNoWcagAxeViolations(page, ".auth-dialog");
});

test("[TC-E2E-17] lỗi đăng nhập được đưa vào live alert trong dialog", async ({ page }) => {
  await mockApi(page, { loginError: { status: 401, error: "INVALID_CREDENTIALS", message: "Email hoặc mật khẩu không chính xác." } });
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  await openLogin(page);

  const dialog = page.locator(".auth-dialog");
  await dialog.getByLabel("Email").fill("wrong@example.test");
  await dialog.getByLabel("Mật khẩu").fill("wrong-password");
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click();

  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText("Email hoặc mật khẩu không chính xác.");
  await expect(alert).toHaveAttribute("role", "alert");
  await expectNoWcagAxeViolations(page, ".auth-dialog");
});

test("[TC-E2E-18] Admin details mở rộng có thể truy cập bằng tên summary và axe", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cinemabooking.session", JSON.stringify({
      token: "a11y-admin-test-token",
      user: { id: "a11y-admin", name: "Accessibility Admin", email: "admin@example.test", role: "ADMIN" },
    }));
  });
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Quản trị" }).click();
  await expect(page.getByRole("heading", { name: "Vận hành rạp phim" })).toBeVisible();

  const movieSection = page.locator(".admin-section").filter({ has: page.getByRole("heading", { name: "Chỉnh sửa phim" }) });
  const movieDetails = movieSection.locator("details.admin-record-detail").filter({ hasText: movie.title });
  const movieSummary = movieDetails.locator("summary");
  await expect(movieSummary).toHaveAccessibleName(new RegExp(movie.title));
  await tabUntilFocused(page, movieSummary);
  const summaryOutline = await movieSummary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(summaryOutline.style).not.toBe("none");
  expect(summaryOutline.width).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(movieDetails).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(movieDetails).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(movieDetails.getByTestId(`admin-movie-edit-form-${movie.id}`)).toBeVisible();

  const auditoriumSection = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Tạo phòng và sơ đồ ghế" }) });
  const auditoriumDetails = auditoriumSection.locator("details.admin-record-detail").filter({ hasText: auditorium.name });
  const auditoriumSummary = auditoriumDetails.locator("summary").first();
  await expect(auditoriumSummary).toHaveAccessibleName(new RegExp(auditorium.name));
  await auditoriumSummary.click();
  const seatDetails = auditoriumDetails.locator("details.admin-seat-detail");
  const seatSummary = seatDetails.locator("summary");
  await expect(seatSummary).toHaveAccessibleName(/Quản lý sơ đồ ghế/);
  await seatSummary.focus();
  await page.keyboard.press("Enter");
  await expect(seatDetails).toHaveAttribute("open", "");
  await expect(page.getByTestId("admin-seat-edit-form-a11y-seat-1").getByLabel("Loại ghế")).toBeVisible();

  await expectNoWcagAxeViolations(page, ".admin-view");
});

test("[TC-E2E-33] Seat limit provides feedback and allows changing selection", async ({ page }) => {
  await mockApi(page);
  await page.route(`**/api/showtimes/${showtime.id}/seats`, async (route) => {
    await fulfillJson(route, 200, { showtime, seats: Array.from({ length: 9 }, (_, index) => ({
      id: `limit-${index}`, label: `A${index + 1}`, row: "A", column: index + 1,
      type: "STANDARD", isAccessible: false, status: "AVAILABLE", priceVnd: 85000,
    })) });
  });
  await page.goto("/");
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();
  const dialog = page.getByRole("dialog", { name: movie.title });
  const seats = dialog.getByTestId("seat");
  for (let index = 0; index < 8; index++) { await seats.nth(index).focus(); await page.keyboard.press("Space"); }
  await seats.nth(8).focus();
  await page.keyboard.press("Space");
  await expect(seats.nth(8)).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.getByRole("status")).toContainText("Mỗi đơn tối đa 8 ghế");
  await expect(seats.nth(8)).toBeFocused();
  await seats.nth(0).focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("status")).toBeEmpty();
  await seats.nth(8).focus();
  await page.keyboard.press("Space");
  await expect(seats.nth(8)).toHaveAttribute("aria-pressed", "true");
});

test("[TC-E2E-40] Seat availability and type are exposed in accessible names", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByTestId("movie-card").first().getByRole("button", { name: "Xem suất chiếu" }).click();
  await page.getByTestId("showtime-option").first().click();

  const dialog = page.getByRole("dialog", { name: movie.title });
  const availableStandard = dialog.getByRole("button", { name: "Ghế A 1 — trống — ghế tiêu chuẩn" });
  const availableAccessible = dialog.getByRole("button", { name: "Ghế A 2 — trống — ghế hỗ trợ tiếp cận" });
  const heldPremium = dialog.getByRole("button", { name: "Ghế A 3 — đang giữ — ghế cao cấp" });
  const soldAccessible = dialog.getByRole("button", { name: "Ghế A 4 — đã bán — ghế hỗ trợ tiếp cận" });

  await expect(availableStandard).toBeEnabled();
  await expect(availableAccessible).toBeEnabled();
  await expect(heldPremium).toBeDisabled();
  await expect(soldAccessible).toBeDisabled();
  await expect(availableStandard).toHaveAttribute("aria-pressed", "false");
  await expect(heldPremium).toHaveAttribute("aria-pressed", "false");
  await expect(soldAccessible).toHaveAttribute("aria-pressed", "false");

  await availableStandard.focus();
  await page.keyboard.press("Space");
  await expect(availableStandard).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".seat-footer")).toContainText("1 ghế đã chọn");
  await expect(heldPremium).toBeDisabled();
  await expect(soldAccessible).toBeDisabled();
});

test("[TC-E2E-35] discovery text reflows under WCAG text-spacing overrides and filters remain keyboard operable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockApi(page, { movieTitles: [movie.title, "SupercalifragilisticexpialidociousCinema"] });
  const spacingStyles = `
    *, *::before, *::after {
      line-height: 1.5 !important;
      letter-spacing: 0.12em !important;
      word-spacing: 0.16em !important;
    }
    p { margin-block-end: 2em !important; }
  `;
  await page.route("**/__test__/tc-e2e-35-text-spacing.css", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/css; charset=utf-8",
      body: spacingStyles,
    }),
  );
  await page.goto("/");
  await page.addStyleTag({ url: "/__test__/tc-e2e-35-text-spacing.css" });

  const paragraph = page.locator(".hero-content > p");
  const spacing = await paragraph.evaluate((element) => {
    const style = getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize);
    return {
      fontSize,
      lineHeight: Number.parseFloat(style.lineHeight),
      letterSpacing: Number.parseFloat(style.letterSpacing),
      wordSpacing: Number.parseFloat(style.wordSpacing),
      paragraphSpacing: Number.parseFloat(style.marginBlockEnd),
    };
  });
  expect(spacing.lineHeight).toBeGreaterThanOrEqual(spacing.fontSize * 1.5 - 0.1);
  expect(spacing.letterSpacing).toBeGreaterThanOrEqual(spacing.fontSize * 0.12 - 0.1);
  expect(spacing.wordSpacing).toBeGreaterThanOrEqual(spacing.fontSize * 0.16 - 0.1);
  expect(spacing.paragraphSpacing).toBeGreaterThanOrEqual(spacing.fontSize * 2 - 0.1);

  const keyText = await page.locator(".hero h1, .hero-content > p, .section-heading h2, .movie-info h3, .movie-info p").evaluateAll((elements) => {
    return elements.filter((element) => element.getClientRects().length > 0).map((element) => ({
      text: element.textContent?.trim() || "",
      clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
    }));
  });
  expect(keyText.length).toBeGreaterThan(0);
  expect(keyText.filter(({ clipped, text }) => clipped || text.length === 0)).toEqual([]);
  await expect(page.getByRole("heading", { name: "SupercalifragilisticexpialidociousCinema" })).toBeVisible();

  const dateFilter = page.getByLabel("Ngày xem phim");
  await expect(dateFilter).toHaveAccessibleName("Ngày xem phim");
  await tabUntilFocused(page, dateFilter);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dateFilter).toBeFocused();

  const pageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);
});

test("[TC-E2E-36] discovery date and cinema filters update results by keyboard at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });

  const firstCinema = { id: "a11y-filter-cinema-a", name: "Keyboard Cinema A", city: "Test City" };
  const secondCinema = { id: "a11y-filter-cinema-b", name: "Keyboard Cinema B", city: "Test City" };
  const filterFixture = {
    cinemas: [firstCinema, secondCinema],
    showtimes: [
      {
        ...showtime,
        id: "a11y-filter-showtime-a",
        cinemaId: firstCinema.id,
        cinemaName: firstCinema.name,
        city: firstCinema.city,
      },
      {
        ...showtime,
        id: "a11y-filter-showtime-b",
        cinemaId: secondCinema.id,
        cinemaName: secondCinema.name,
        city: secondCinema.city,
      },
    ],
  };
  await mockApi(page, { discoveryFilterFixture: filterFixture });
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const dateFilter = page.getByLabel("Ngày xem phim");
  const cinemaFilter = page.getByLabel("Rạp chiếu");
  const scheduleStatus = page.locator("#schedule").getByRole("status");
  const selectedDate = await dateFilter.inputValue();
  const firstDateOption = await dateFilter.locator("option").nth(0).getAttribute("value");
  const nextDateOption = await dateFilter.locator("option").nth(1).getAttribute("value");
  if (!firstDateOption || !nextDateOption) throw new Error("Expected at least two date filter options after the page loads.");
  const availableDate = firstDateOption;
  expect(selectedDate).toBe(availableDate);
  expect(firstDateOption).toBe(selectedDate);
  await expect(cinemaFilter).toHaveAccessibleName("Rạp chiếu");
  await expect(scheduleStatus).toHaveText(`2 suất chiếu phù hợp cho ${movie.title}.`);
  await expect(page.locator(".showtime-card")).toHaveCount(2);

  const waitForShowtimes = (date: string, cinemaId: string | null) => page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/showtimes"
      && url.searchParams.get("date") === date
      && url.searchParams.get("cinemaId") === cinemaId;
  });

  await tabUntilFocused(page, dateFilter);
  const emptyDateResponsePromise = waitForShowtimes(nextDateOption, null);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const emptyDateResponse = await emptyDateResponsePromise;
  expect(emptyDateResponse.ok()).toBeTruthy();
  await expect(dateFilter).toBeFocused();
  await expect(dateFilter).toHaveValue(nextDateOption);
  await expect(scheduleStatus).toHaveText("Không có suất chiếu phù hợp. Hãy thử ngày hoặc rạp khác.");
  await expect(page.locator(".showtime-card")).toHaveCount(0);

  const firstDateResponsePromise = waitForShowtimes(firstDateOption, null);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  const firstDateResponse = await firstDateResponsePromise;
  expect(firstDateResponse.ok()).toBeTruthy();
  await expect(dateFilter).toBeFocused();
  await expect(dateFilter).toHaveValue(firstDateOption);
  await expect(scheduleStatus).toHaveText(`2 suất chiếu phù hợp cho ${movie.title}.`);
  await expect(page.locator(".showtime-card")).toHaveCount(2);

  await tabUntilFocused(page, cinemaFilter);
  await expect(cinemaFilter).toBeFocused();
  await expect(cinemaFilter).toHaveValue("");
  await expect(cinemaFilter.locator("option")).toHaveCount(3);
  const lastCinemaOption = await cinemaFilter.locator("option").last().getAttribute("value");
  expect(lastCinemaOption).toBe(secondCinema.id);
  const cinemaResponsePromise = waitForShowtimes(firstDateOption, lastCinemaOption);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const cinemaResponse = await cinemaResponsePromise;
  expect(cinemaResponse.ok()).toBeTruthy();
  await expect(cinemaFilter).toBeFocused();
  await expect(cinemaFilter).toHaveValue(lastCinemaOption!);
  await expect(scheduleStatus).toHaveText(`1 suất chiếu phù hợp cho ${movie.title}.`);
  await expect(page.locator(".showtime-card")).toHaveCount(1);
  await expect(page.locator(".showtime-card").first()).toContainText(secondCinema.name);
});

test("[TC-E2E-37] stale showtime responses cannot replace the latest date and cinema filters", async ({ page }) => {
  const staleCinemaA = { id: "a11y-stale-cinema-a", name: "Stale Cinema A", city: "Test City" };
  const staleCinemaB = { id: "a11y-stale-cinema-b", name: "Stale Cinema B", city: "Test City" };
  const latestCinemaA = { id: "a11y-latest-cinema-a", name: "Latest Cinema A", city: "Test City" };
  const latestCinemaB = { id: "a11y-latest-cinema-b", name: "Latest Cinema B", city: "Test City" };
  const makeShowtime = (id: string, venue: typeof latestCinemaA, date: string, hour: number) => {
    const start = new Date(`${date}T${hour}:00:00+07:00`);
    return {
      ...showtime,
      id,
      cinemaId: venue.id,
      cinemaName: venue.name,
      city: venue.city,
      date,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 100 * 60_000).toISOString(),
    };
  };

  let releaseInitialResponse!: () => void;
  const initialResponseGate = new Promise<void>((resolve) => { releaseInitialResponse = resolve; });
  let signalInitialRequest!: (date: string) => void;
  const initialRequestStarted = new Promise<string>((resolve) => { signalInitialRequest = resolve; });
  let initialDate: string | null = null;

  await mockApi(page);
  await page.route("**/api/showtimes*", async (route) => {
    const url = new URL(route.request().url());
    const requestedDate = url.searchParams.get("date");
    if (!requestedDate) throw new Error("Expected showtime requests to include a date.");

    if (initialDate === null) {
      initialDate = requestedDate;
      signalInitialRequest(requestedDate);
    }
    const isInitialDateResponse = requestedDate === initialDate;
    if (isInitialDateResponse) await initialResponseGate;

    const responseShowtimes = requestedDate === initialDate
      ? [
        makeShowtime("a11y-stale-showtime-a", staleCinemaA, requestedDate, 18),
        makeShowtime("a11y-stale-showtime-b", staleCinemaB, requestedDate, 20),
      ]
      : [
        makeShowtime("a11y-latest-showtime-a", latestCinemaA, requestedDate, 18),
        makeShowtime("a11y-latest-showtime-b", latestCinemaB, requestedDate, 20),
      ].filter((item) => !url.searchParams.get("cinemaId") || item.cinemaId === url.searchParams.get("cinemaId"));
    await fulfillJson(route, 200, responseShowtimes);
  });

  try {
    await page.goto("/");
    await expect(page.getByTestId("movie-card").first()).toBeVisible();
    const dateFilter = page.getByLabel("Ngày xem phim");
    const scheduleStatus = page.locator("#schedule").getByRole("status");
    const selectedDate = await dateFilter.inputValue();
    const firstDateOption = await dateFilter.locator("option").nth(0).getAttribute("value");
    const latestDateOption = await dateFilter.locator("option").nth(1).getAttribute("value");
    if (!firstDateOption || !latestDateOption) throw new Error("Expected at least two date options.");
    expect(latestDateOption).not.toBe(firstDateOption);
    expect(selectedDate).toBe(firstDateOption);
    expect(await initialRequestStarted).toBe(selectedDate);

    const waitForShowtimes = (date: string, cinemaId: string | null) => page.waitForResponse((response) => {
      const responseUrl = new URL(response.url());
      return response.request().method() === "GET"
        && responseUrl.pathname === "/api/showtimes"
        && responseUrl.searchParams.get("date") === date
        && responseUrl.searchParams.get("cinemaId") === cinemaId;
    });
    const staleResponsePromise = waitForShowtimes(selectedDate, null);

    await tabUntilFocused(page, dateFilter);
    const latestDateResponsePromise = waitForShowtimes(latestDateOption, null);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const latestDateResponse = await latestDateResponsePromise;
    expect(latestDateResponse.ok()).toBeTruthy();
    await expect(dateFilter).toBeFocused();
    await expect(dateFilter).toHaveValue(latestDateOption);
    await expect(scheduleStatus).toHaveText(`2 suất chiếu phù hợp cho ${movie.title}.`);
    await expect(page.locator(".showtime-card")).toHaveCount(2);

    const cinemaFilter = page.getByLabel("Rạp chiếu");
    await tabUntilFocused(page, cinemaFilter);
    await expect(cinemaFilter.locator("option")).toHaveCount(3);
    const lastCinemaOption = await cinemaFilter.locator("option").last().getAttribute("value");
    expect(lastCinemaOption).toBe(latestCinemaB.id);
    const latestCinemaResponsePromise = waitForShowtimes(latestDateOption, latestCinemaB.id);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const latestCinemaResponse = await latestCinemaResponsePromise;
    expect(latestCinemaResponse.ok()).toBeTruthy();
    await expect(cinemaFilter).toBeFocused();
    await expect(cinemaFilter).toHaveValue(latestCinemaB.id);
    await expect(scheduleStatus).toHaveText(`1 suất chiếu phù hợp cho ${movie.title}.`);
    await expect(page.locator(".showtime-card")).toHaveCount(1);
    await expect(page.locator(".showtime-card").first()).toContainText(latestCinemaB.name);

    releaseInitialResponse();
    const staleResponse = await staleResponsePromise;
    expect(staleResponse.ok()).toBeTruthy();
    await expect(dateFilter).toHaveValue(latestDateOption);
    await expect(cinemaFilter).toHaveValue(latestCinemaB.id);
    await expect(cinemaFilter).toBeFocused();
    await expect(scheduleStatus).toHaveText(`1 suất chiếu phù hợp cho ${movie.title}.`);
    await expect(page.locator(".showtime-card")).toHaveCount(1);
    await expect(page.locator(".showtime-card").first()).toContainText(latestCinemaB.name);
    await expect(page.locator(".showtime-card")).not.toContainText(staleCinemaA.name);
    await expect(page.locator(".showtime-card")).not.toContainText(staleCinemaB.name);
  } finally {
    releaseInitialResponse();
  }
});
