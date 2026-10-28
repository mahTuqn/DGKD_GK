import { expect, test, type Page } from "@playwright/test";

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
  await moviePanel.getByRole("button", { name: "Thêm vào danh mục" }).click();
  await expect(page.getByRole("status")).toContainText("Đã thêm phim mới.");

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
  await movieEditForm.getByRole("button", { name: "Lưu phim" }).click();
  await expect(page.getByRole("status")).toContainText("Đã cập nhật phim.");

  const auditoriumPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Tạo phòng và sơ đồ ghế" }) });
  const auditoriumCreateForm = auditoriumPanel.locator("form.admin-create-form");
  const cinemaSelect = auditoriumCreateForm.getByLabel("Rạp");
  await expect(cinemaSelect.locator("option").first()).toBeAttached();
  await cinemaSelect.selectOption({ index: 0 });
  await auditoriumCreateForm.getByLabel("Tên phòng").fill(auditoriumName);
  await auditoriumCreateForm.getByLabel("Định dạng").fill("STANDARD");
  await auditoriumCreateForm.getByLabel("Số hàng").fill("2");
  await auditoriumCreateForm.getByLabel("Số ghế mỗi hàng").fill("3");
  await auditoriumCreateForm.getByRole("button", { name: "Tạo phòng" }).click();
  await expect(page.getByRole("status")).toContainText("Đã tạo phòng và sơ đồ ghế.");

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
