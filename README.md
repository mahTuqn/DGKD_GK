# CinemaBooking QA

Ứng dụng trình diễn đặt vé xem phim và hồ sơ kiểm định chất lượng. Mã nguồn đang được xây dựng theo [kế hoạch dự án](CinemaBooking_QA_Plan.md).

## Yêu cầu

- Node.js 22 trở lên và npm
- Docker Desktop đang chạy

## Chạy toàn bộ ứng dụng bằng Docker Compose

Docker Desktop phải đang chạy. Từ thư mục gốc:

```powershell
docker compose up --build -d
docker compose --profile seed run --rm seed
```

Compose khởi chạy PostgreSQL, áp dụng migrations trước khi API và worker chạy, rồi phục vụ frontend qua Nginx. Worker dọn hold hết hạn và đưa callback thanh toán thành công đến muộn vào hàng đối soát thủ công. Lệnh seed tạo tài khoản demo, phim, rạp, phòng và suất chiếu mẫu.

- Web: `http://localhost:8080`
- API health: `http://localhost:8080/api/health`
- PostgreSQL: `localhost:5434` (database `cinema`, user `cinema`, mật khẩu demo `cinema_dev`)

Kiểm tra trạng thái bằng `docker compose ps`; xem log bằng `docker compose logs -f api worker web`. PostgreSQL lưu dữ liệu trong volume `cinema_postgres_data`. Các secret mặc định trong Compose chỉ dành cho demo local; hãy thay bằng secret riêng trước khi triển khai.

## Chạy ở chế độ phát triển trên máy host

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
npm install
npm run db:setup
npm run dev
```

Chế độ này chỉ chạy PostgreSQL trong Docker; API và frontend chạy bằng Node/Vite trên host.

- Web: `http://localhost:5173`
- API: `http://localhost:4000/api/health`
- PostgreSQL: `localhost:5434` (đổi khỏi cổng 5433 đang được dịch vụ PostgreSQL cục bộ khác sử dụng)

Tài khoản demo (dữ liệu seed):

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Khách hàng | `customer@cinema.local` | `CinemaCustomer123!` |
| Nhân viên | `staff@cinema.local` | `CinemaStaff123!` |
| Quản trị viên | `admin@cinema.local` | `CinemaAdmin123!` |

Thanh toán demo chỉ tạo kết quả giả lập; ứng dụng không thu thập dữ liệu thẻ.

Nhân viên chỉ có thể quét/check-in vé tại rạp được Admin phân công. Tài khoản Staff chưa được phân công không thể soát vé; Admin có thể soát tại mọi rạp và cập nhật phân công Staff trong khu vực Quản trị.

Admin tạo hoặc sửa suất chiếu không thể xếp hai suất trong cùng phòng chồng thời gian hoặc cách nhau dưới 20 phút sau thời lượng suất trước; buffer này dành cho vệ sinh/chuyển ca.

## Kiểm thử

```powershell
npm run test:api
npx playwright install chromium
npm run test:browser
npm run build
```

`npm test` chạy liền API/integration và browser E2E trên Chromium desktop + mobile. Trước khi chạy, hãy dựng database theo bước `npm run db:setup` ở trên; API integration cần `DATABASE_URL_TEST` trỏ tới database test đã migrate.

Test browser chạy qua Playwright trên Chromium và tự khởi động web/API development server theo cấu hình E2E. Chạy `npm run test:browser:ui` để mở Playwright UI. Các test PostgreSQL trong API suite chỉ chạy khi đặt `DATABASE_URL_TEST` tới một database test đã migrate; nếu bỏ trống, Vitest sẽ skip các ca cần DB.

```powershell
$env:DATABASE_URL_TEST = "postgresql://cinema:cinema_dev@localhost:5434/cinema?schema=public"
npm run test:api
```

## Quy tắc phát triển

- Thay đổi nghiệp vụ cần có test và cập nhật ma trận truy vết nếu yêu cầu thay đổi.
- PostgreSQL là nguồn dữ liệu chính cho trạng thái giữ ghế và vé.
- Không ghi secret, dữ liệu thanh toán thật hoặc thông tin cá nhân vào repository/evidence.
- Lệnh `db:setup` khởi tạo môi trường phát triển và seed dữ liệu demo; không dùng credential mặc định trên môi trường triển khai.

## Tài liệu QA

- [SRS](docs/01-srs.md) và [kế hoạch kiểm thử](docs/02-test-plan.md)
- [RTM](docs/03-rtm.csv), [test catalog](docs/04-test-cases.csv) và [tóm tắt evidence](docs/07-test-summary.md)
- [OpenAPI](docs/openapi.yaml) — bao gồm role Staff theo cinema được phân công và buffer 20 phút giữa suất trong cùng phòng
- [Manifest evidence final](docs/evidence/final/manifest.json) — lệnh, kết quả, artifact và SHA-256
- [Manifest follow-up clean clone](docs/evidence/followup/2026-10-28-manifest.json) — commit `5ae4c2b`, test local và SHA-256 artifact
