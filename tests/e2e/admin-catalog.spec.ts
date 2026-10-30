import { expect, test, type Page } from "@playwright/test";

const API_URL = process.env.E2E_API_URL || "http://127.0.0.1:4000/api";

async function signInAsAdmin(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("movie-card").first()).toBeVisible();

  const desktopLogin = page.getByRole("button", { name: "Đăng nhập", exact: true });
  if (await desktopLogin.isVisible()) await desktopLogin.click();
  else await page.getByRole("button", { name: "Mở tài khoản" }).click();

  await page.getByLabel("Email").fill("admin@cinema.local");
  await page.getByLabel("Mật khẩu").fill("CinemaAdmin123!");
  await page.getByRole("dialog").getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Quản trị" }).click();
  await expect(page.getByRole("heading", { name: "Vận hành rạp phim" })).toBeVisible();
}

test("[TC-E2E-15] Admin tạo phim, phòng ghế, suất chiếu và lưu giá mới", async ({ page }) => {
  await signInAsAdmin(page);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const movieTitle = `QA E2E Movie ${suffix}`;
  const auditoriumName = `QA E2E Room ${suffix}`;
  const updatedAuditoriumName = auditoriumName + " Edited";

  const moviePanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Thêm phim" }) });
  await moviePanel.getByLabel("Tên phim").fill(movieTitle);
  await moviePanel.getByLabel("Thể loại").fill("Kiểm thử tự động");
  await moviePanel.getByLabel("Thời lượng (phút)").fill("100");
  await moviePanel.getByLabel("Tóm tắt").fill("Phim fixture để kiểm tra luồng quản trị danh mục.");
  const createMovieButton = moviePanel.getByRole("button", { name: "Thêm vào danh mục" });
  await createMovieButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Đã thêm phim mới.");
  await expect(createMovieButton).toBeFocused();

  const showtimePanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Tạo suất chiếu" }) });
  const movieSelect = showtimePanel.getByLabel("Phim");
  const movieOption = movieSelect.locator("option").filter({ hasText: movieTitle });
  await expect(movieOption).toHaveCount(1);
  const movieId = await movieOption.getAttribute("value");
  expect(movieId).toBeTruthy();

  const updatedSynopsis = "Mô tả đã được Admin cập nhật qua giao diện.";
  const movieEditForm = page.getByTestId("admin-movie-edit-form-" + movieId);
  const movieDetails = page.locator("details.admin-record-detail").filter({ has: movieEditForm });
  await movieDetails.locator("summary").click();
  await expect(movieEditForm).toBeVisible();
  await movieEditForm.getByLabel("Tóm tắt").fill(updatedSynopsis);
  let releaseUpdate!: () => void;
  const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
  await page.route(`**/api/admin/movies/${movieId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await updateGate;
    await route.continue();
  });
  const updateRequest = page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === `/api/admin/movies/${movieId}`);
  await movieEditForm.getByRole("button", { name: "Lưu phim" }).focus();
  await page.keyboard.press("Enter");
  await updateRequest;
  await movieEditForm.getByLabel("Tóm tắt").focus();
  releaseUpdate();
  await expect(page.getByRole("status")).toContainText("Đã cập nhật phim.");
  await expect(movieEditForm.getByLabel("Tóm tắt")).toBeFocused();
  await page.unroute(`**/api/admin/movies/${movieId}`);

  const auditoriumPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Tạo phòng và sơ đồ ghế" }) });
  const auditoriumCreateForm = auditoriumPanel.locator("form.admin-create-form");
  const cinemaSelect = auditoriumCreateForm.getByLabel("Rạp");
  await expect(cinemaSelect.locator("option").first()).toBeAttached();
  await cinemaSelect.selectOption({ index: 0 });
  await auditoriumCreateForm.getByLabel("Tên phòng").fill(auditoriumName);
  await auditoriumCreateForm.getByLabel("Định dạng").fill("STANDARD");
  await auditoriumCreateForm.getByLabel("Số hàng").fill("2");
  await auditoriumCreateForm.getByLabel("Số ghế mỗi hàng").fill("3");
  const createRoomButton = auditoriumCreateForm.getByRole("button", { name: "Tạo phòng" });
  await createRoomButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Đã tạo phòng và sơ đồ ghế.");
  await expect(createRoomButton).toBeFocused();

  const roomDetails = auditoriumPanel.locator(".admin-record-detail").filter({ hasText: auditoriumName });
  await expect(roomDetails).toBeVisible();
  await expect(roomDetails.locator("summary").first()).toContainText("6 ghế · STANDARD");

  await roomDetails.locator("summary").first().click();
  const auditoriumEditForm = roomDetails.locator("form[data-auditorium-id]");
  await auditoriumEditForm.getByLabel("Tên phòng").fill(updatedAuditoriumName);
  await auditoriumEditForm.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("status")).toContainText("Đã cập nhật thông tin phòng.");
  if (!(await roomDetails.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await roomDetails.locator("summary").first().click();
  }

  const seatManagement = roomDetails.locator(".admin-seat-detail");
  await seatManagement.locator("summary").click();
  const firstSeatForm = seatManagement.locator("form.admin-seat-form").first();
  await expect(firstSeatForm).toBeVisible();
  const seatId = await firstSeatForm.getAttribute("data-seat-id");
  expect(seatId).toBeTruthy();
  const seatLabel = await firstSeatForm.getByRole("button").innerText();
  await firstSeatForm.getByLabel("Loại ghế").selectOption("ACCESSIBLE");
  await firstSeatForm.getByRole("button", { name: seatLabel, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Đã cập nhật sơ đồ ghế.");

  await movieSelect.selectOption(movieId!);

  const roomSelect = showtimePanel.getByLabel("Phòng");
  const roomOption = roomSelect.locator("option").filter({ hasText: updatedAuditoriumName });
  await expect(roomOption).toHaveCount(1);
  const auditoriumId = await roomOption.getAttribute("value");
  expect(auditoriumId).toBeTruthy();
  await roomSelect.selectOption(auditoriumId!);

  const startAt = await page.evaluate(() => {
    const date = new Date(Date.now() + 48 * 60 * 60 * 1000);
    date.setHours(18, 0, 0, 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await showtimePanel.getByLabel("Thời gian bắt đầu").fill(startAt);
  await showtimePanel.getByLabel("Giá vé (VND)").fill("110000");
  await showtimePanel.getByRole("button", { name: "Tạo suất chiếu" }).click();
  await expect(page.getByRole("status")).toContainText("Đã tạo suất chiếu.");

  const createdShowtime = page.locator(".admin-showtime-row").filter({ hasText: movieTitle });
  await expect(createdShowtime).toBeVisible();
  await expect(createdShowtime).toContainText(updatedAuditoriumName);
  await expect(createdShowtime.getByLabel("Giá vé")).toHaveValue("110000");

  await createdShowtime.getByLabel("Giá vé").fill("123000");
  await createdShowtime.getByRole("button", { name: "Cập nhật" }).click();
  await expect(page.getByRole("status")).toContainText("Đã cập nhật giá và trạng thái suất chiếu.");

  await page.reload();
  await page.getByRole("button", { name: "Quản trị" }).click();
  const persistedShowtime = page.locator(".admin-showtime-row").filter({ hasText: movieTitle });
  await expect(persistedShowtime).toBeVisible();
  await expect(persistedShowtime).toContainText(updatedAuditoriumName);
  await expect(persistedShowtime.getByLabel("Giá vé")).toHaveValue("123000");

  const persistedMovieForm = page.getByTestId("admin-movie-edit-form-" + movieId);
  const persistedMovieDetails = page.locator("details.admin-record-detail").filter({ has: persistedMovieForm });
  await persistedMovieDetails.locator("summary").click();
  await expect(persistedMovieForm.getByLabel("Tóm tắt")).toHaveValue(updatedSynopsis);

  const persistedRoom = page.locator("details.admin-record-detail").filter({ hasText: updatedAuditoriumName });
  await persistedRoom.locator("summary").first().click();
  await expect(persistedRoom.locator("form[data-auditorium-id]").getByLabel("Tên phòng")).toHaveValue(updatedAuditoriumName);
  const persistedSeatManagement = persistedRoom.locator(".admin-seat-detail");
  await persistedSeatManagement.locator("summary").click();
  await expect(page.getByTestId("admin-seat-edit-form-" + seatId).getByLabel("Loại ghế")).toHaveValue("ACCESSIBLE");
});

test("[TC-E2E-22] Admin nhận lỗi khi thiếu buffer lịch chiếu và tạo được suất đúng buffer", async ({ page }) => {
  await signInAsAdmin(page);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const movieTitle = `QA Schedule Movie ${suffix}`;
  const auditoriumName = `QA Schedule Room ${suffix}`;
  const moviePanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Thêm phim" }) });
  await moviePanel.getByLabel("Tên phim").fill(movieTitle);
  await moviePanel.getByLabel("Thể loại").fill("Kiểm thử lịch chiếu");
  await moviePanel.getByLabel("Thời lượng (phút)").fill("100");
  await moviePanel.getByLabel("Tóm tắt").fill("Fixture để kiểm tra giới hạn buffer lịch chiếu.");
  await moviePanel.getByRole("button", { name: "Thêm vào danh mục" }).click();
  await expect(page.getByRole("status")).toContainText("Đã thêm phim mới.");

  const showtimePanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Tạo suất chiếu" }) });
  const movieSelect = showtimePanel.getByLabel("Phim");
  const movieOption = movieSelect.locator("option").filter({ hasText: movieTitle });
  await expect(movieOption).toHaveCount(1);
  const movieId = await movieOption.getAttribute("value");
  expect(movieId).toBeTruthy();

  const auditoriumPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Tạo phòng và sơ đồ ghế" }) });
  const auditoriumForm = auditoriumPanel.locator("form.admin-create-form");
  await auditoriumForm.getByLabel("Rạp").selectOption({ index: 0 });
  await auditoriumForm.getByLabel("Tên phòng").fill(auditoriumName);
  await auditoriumForm.getByLabel("Định dạng").fill("STANDARD");
  await auditoriumForm.getByLabel("Số hàng").fill("2");
  await auditoriumForm.getByLabel("Số ghế mỗi hàng").fill("3");
  await auditoriumForm.getByRole("button", { name: "Tạo phòng" }).click();
  await expect(page.getByRole("status")).toContainText("Đã tạo phòng và sơ đồ ghế.");

  const roomOption = showtimePanel.getByLabel("Phòng").locator("option").filter({ hasText: auditoriumName });
  await expect(roomOption).toHaveCount(1);
  const auditoriumId = await roomOption.getAttribute("value");
  expect(auditoriumId).toBeTruthy();

  const firstStartAt = await page.evaluate(() => {
    const date = new Date(Date.now() + 48 * 60 * 60 * 1000);
    date.setHours(18, 0, 0, 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  const atOffset = async (minutes: number) => page.evaluate(({ startAt, offset }) => {
    const date = new Date(startAt);
    date.setMinutes(date.getMinutes() + offset);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, { startAt: firstStartAt, offset: minutes });

  await movieSelect.selectOption(movieId!);
  await showtimePanel.getByLabel("Phòng").selectOption(auditoriumId!);
  await showtimePanel.getByLabel("Thời gian bắt đầu").fill(firstStartAt);
  await showtimePanel.getByRole("button", { name: "Tạo suất chiếu" }).click();
  await expect(page.getByRole("status")).toContainText("Đã tạo suất chiếu.");
  const createdShowtimes = page.locator(".admin-showtime-row").filter({ hasText: movieTitle });
  await expect(createdShowtimes).toHaveCount(1);

  await movieSelect.selectOption(movieId!);
  await showtimePanel.getByLabel("Phòng").selectOption(auditoriumId!);
  await showtimePanel.getByLabel("Thời gian bắt đầu").fill(await atOffset(90));
  const createShowtimeButton = showtimePanel.getByRole("button", { name: "Tạo suất chiếu" });
  await createShowtimeButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Suất chiếu bị chồng thời gian với lịch đang có.");
  await expect(createShowtimeButton).toBeFocused();
  await expect(createdShowtimes).toHaveCount(1);

  await showtimePanel.getByLabel("Thời gian bắt đầu").fill(await atOffset(120));
  await showtimePanel.getByRole("button", { name: "Tạo suất chiếu" }).click();
  await expect(page.getByRole("status")).toContainText("Đã tạo suất chiếu.");
  await expect(createdShowtimes).toHaveCount(2);
});

test("[TC-E2E-28] Admin cập nhật role, rạp Staff và phân trang danh sách người dùng bằng bàn phím", async ({ page, request }) => {
  await signInAsAdmin(page);

  const userRow = page.locator(".admin-user-row").filter({ hasText: "staff@cinema.local" });
  await expect(userRow).toBeVisible();
  const assignedCinema = userRow.getByLabel("Rạp phân công cho staff@cinema.local");
  const assignedCinemaId = await assignedCinema.inputValue();
  expect(assignedCinemaId).toBeTruthy();
  const adminToken = await page.evaluate(() => (JSON.parse(localStorage.getItem("cinemabooking.session") || "null") as { token?: string } | null)?.token);
  expect(adminToken).toBeTruthy();
  const staffId = await userRow.locator("form.admin-user-role-form").getAttribute("data-user-id");
  expect(staffId).toBeTruthy();

  let cinemaName: string | undefined;
  let testCinemaId: string | undefined;
  let testFailed = false;
  let testFailure: unknown;
  const cleanupFailures: string[] = [];

  try {

    const roleSelect = userRow.getByLabel("Vai trò của staff@cinema.local");
    await roleSelect.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    await expect(userRow.getByRole("button", { name: "Lưu vai trò" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Đã cập nhật vai trò người dùng.");

    const customerRow = page.locator(".admin-user-row").filter({ hasText: "staff@cinema.local" });
    await expect(customerRow.getByLabel("Vai trò của staff@cinema.local")).toHaveValue("CUSTOMER");
    await expect(customerRow).toContainText("Chưa phân công rạp");
    const staffRoleSelect = customerRow.getByLabel("Vai trò của staff@cinema.local");
    await staffRoleSelect.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Đã cập nhật vai trò người dùng.");

    const restoredStaffRow = page.locator(".admin-user-row").filter({ hasText: "staff@cinema.local" });
    await expect(restoredStaffRow.getByLabel("Vai trò của staff@cinema.local")).toHaveValue("STAFF");
    const cinemaSelect = restoredStaffRow.getByLabel("Rạp phân công cho staff@cinema.local");
    cinemaName = `QA Keyboard Cinema ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const cinemaPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Quản lý rạp" }) });
    await cinemaPanel.getByLabel("Tên rạp").fill(cinemaName);
    await cinemaPanel.getByLabel("Thành phố").fill("Hồ Chí Minh");
    await cinemaPanel.getByLabel("Địa chỉ").fill(`Địa chỉ kiểm thử ${Date.now()}`);
    await cinemaPanel.getByRole("button", { name: "Thêm rạp" }).click();
    await expect(page.getByRole("status")).toContainText("Đã thêm rạp mới.");

    const newCinemaId = await cinemaSelect.locator("option").filter({ hasText: cinemaName }).getAttribute("value");
    testCinemaId = newCinemaId ?? undefined;
    expect(newCinemaId).toBeTruthy();
    const cinemaOptionValues = await cinemaSelect.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    const newCinemaOptionIndex = cinemaOptionValues.indexOf(newCinemaId!);
    expect(newCinemaOptionIndex).toBeGreaterThan(0);
    await cinemaSelect.focus();
    await page.keyboard.press("Home");
    for (let index = 0; index < newCinemaOptionIndex; index += 1) await page.keyboard.press("ArrowDown");
    await expect(cinemaSelect).toHaveValue(newCinemaId!);
    await page.keyboard.press("Tab");
    await expect(restoredStaffRow.getByRole("button", { name: "Lưu rạp" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Đã cập nhật rạp phân công cho Staff.");
    await expect(restoredStaffRow.getByLabel("Rạp phân công cho staff@cinema.local")).toHaveValue(newCinemaId!);
    await expect(restoredStaffRow).not.toContainText("passwordHash");
    await expect(restoredStaffRow).not.toContainText("authVersion");

    await page.reload();
    await page.getByRole("button", { name: "Quản trị" }).click();
    const persistedStaffRow = page.locator(".admin-user-row").filter({ hasText: "staff@cinema.local" });
    await expect(persistedStaffRow.getByLabel("Vai trò của staff@cinema.local")).toHaveValue("STAFF");
    const persistedCinemaSelect = persistedStaffRow.getByLabel("Rạp phân công cho staff@cinema.local");
    await expect(persistedCinemaSelect).toHaveValue(newCinemaId!);

    // Restore the seeded Staff assignment so later browser cases keep using the expected cinema.
    const originalCinemaOptionIndex = (await persistedCinemaSelect.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).indexOf(assignedCinemaId!);
    expect(originalCinemaOptionIndex).toBeGreaterThan(0);
    await persistedCinemaSelect.focus();
    await page.keyboard.press("Home");
    for (let index = 0; index < originalCinemaOptionIndex; index += 1) await page.keyboard.press("ArrowDown");
    await expect(persistedCinemaSelect).toHaveValue(assignedCinemaId!);
    await page.keyboard.press("Tab");
    await expect(persistedStaffRow.getByRole("button", { name: "Lưu rạp" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Đã cập nhật rạp phân công cho Staff.");
    await expect(persistedCinemaSelect).toHaveValue(assignedCinemaId!);

    const newCinemaRow = cinemaPanel.locator(".admin-record-row").filter({ hasText: cinemaName });
    await newCinemaRow.getByRole("button", { name: "Đang hoạt động · Tạm dừng" }).click();
    await expect(page.getByRole("status")).toContainText("Đã cập nhật trạng thái rạp.");

    const paginatedEmails = Array.from({ length: 21 }, (_, index) => `qa-pagination-${Date.now()}-${index}@example.test`);
    for (const email of paginatedEmails) {
      const response = await request.post(`${process.env.E2E_API_URL || "http://127.0.0.1:4000/api"}/auth/register`, {
        data: { name: "QA Pagination Customer", email, password: "CinemaQa123!" }
      });
      expect(response.status(), `Register ${email} for the paginated Admin user list`).toBe(201);
    }

    await page.reload();
    await page.getByRole("button", { name: "Quản trị" }).click();
    const userRows = page.locator(".admin-users-panel .admin-user-row");
    await expect(userRows).toHaveCount(20);
    const loadMore = page.getByRole("button", { name: "Tải thêm người dùng" });
    let pageCount = 0;
    while (await loadMore.isVisible()) {
      const nextPage = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/admin/users" && new URL(response.url()).searchParams.has("cursor"));
      await loadMore.focus();
      await page.keyboard.press("Enter");
      await nextPage;
      await expect.poll(async () => (await loadMore.isHidden()) || (await loadMore.isEnabled())).toBe(true);
      if (await loadMore.isVisible()) await expect(loadMore).toBeFocused();
      else await expect(page.getByRole("heading", { name: "Quản lý người dùng" })).toBeFocused();
      pageCount += 1;
      if (pageCount > 5) throw new Error("Admin user pagination exceeded the expected fixture pages.");
    }
    expect(pageCount).toBeGreaterThan(0);
    const renderedEmails = await userRows.locator(".admin-user-identity span").allTextContents();
    expect(new Set(renderedEmails).size).toBe(renderedEmails.length);
    expect(paginatedEmails.every((email) => renderedEmails.includes(email))).toBe(true);
  } catch (error) {
    testFailed = true;
    testFailure = error;
  } finally {
    const authorization = { authorization: `Bearer ${adminToken}` };
    const attemptCleanup = async (label: string, action: () => Promise<{ ok(): boolean; status(): number }>) => {
      try {
        const response = await action();
        if (!response.ok()) cleanupFailures.push(`${label} returned HTTP ${response.status()}`);
      } catch (error) {
        cleanupFailures.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await attemptCleanup("Restore Staff role", () => request.patch(`${API_URL}/admin/users/${encodeURIComponent(staffId!)}/role`, { headers: authorization, data: { role: "STAFF" } }));
    await attemptCleanup("Restore Staff cinema assignment", () => request.patch(`${API_URL}/admin/users/${encodeURIComponent(staffId!)}/assigned-cinema`, { headers: authorization, data: { cinemaId: assignedCinemaId } }));

    if (cinemaName) {
      let cinemaId = testCinemaId;
      if (!cinemaId) {
        try {
          const response = await request.get(`${API_URL}/admin/cinemas`, { headers: authorization });
          if (!response.ok()) cleanupFailures.push(`Find temporary cinema returned HTTP ${response.status()}`);
          else {
            const cinemas = await response.json() as Array<{ id: string; name: string }>;
            cinemaId = cinemas.find((cinema) => cinema.name === cinemaName)?.id;
          }
        } catch (error) {
          cleanupFailures.push(`Find temporary cinema failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (cinemaId) {
        await attemptCleanup("Deactivate temporary cinema", () => request.patch(`${API_URL}/admin/cinemas/${encodeURIComponent(cinemaId!)}`, { headers: authorization, data: { status: "INACTIVE" } }));
      }
    }
  }

  if (testFailed) throw testFailure;
  expect(cleanupFailures, "Test cleanup must restore seeded Staff and deactivate temporary cinema").toEqual([]);
});

test("[TC-E2E-29] Admin user controls reflow without horizontal page overflow at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await signInAsAdmin(page);

  const userManagement = page.locator(".admin-users-panel");
  await expect(userManagement.getByRole("heading", { name: "Quản lý người dùng" })).toBeVisible();
  await expect(userManagement.locator(".admin-user-row").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const staffRow = userManagement.locator(".admin-user-row").filter({ hasText: "staff@cinema.local" });
  await expect(staffRow.getByLabel("Vai trò của staff@cinema.local")).toBeVisible();
  expect(await staffRow.evaluate((element) => element.getBoundingClientRect().right <= document.documentElement.clientWidth + 1)).toBe(true);
});
