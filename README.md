# CinemaBooking QA

Ứng dụng trình diễn đặt vé xem phim và hồ sơ kiểm định chất lượng. Mã nguồn đang được xây dựng theo [kế hoạch dự án](CinemaBooking_QA_Plan.md).

## Yêu cầu

- Node.js 22 trở lên và npm
- Docker Desktop đang chạy

## Chạy toàn bộ ứng dụng bằng Docker Compose

Docker Desktop phải đang chạy. Từ thư mục gốc:

```powershell
npm run env:compose
docker compose up --build -d
docker compose --profile seed run --rm seed
```

`npm run env:compose` tạo `.env` bị Git ignore với secret ngẫu nhiên riêng cho PostgreSQL, JWT và mock payment; lệnh từ chối ghi đè `.env` có sẵn hoặc tạo mật khẩu mới nếu volume PostgreSQL của project đã tồn tại. Hãy giữ `.env` cùng volume dữ liệu vì PostgreSQL không tự đổi mật khẩu role khi volume đã được khởi tạo. Cả web và PostgreSQL chỉ bind vào loopback theo mặc định. Compose bắt buộc cung cấp secret và không có giá trị production mặc định công khai.

Compose khởi chạy PostgreSQL, áp dụng migrations trước khi API và worker chạy, rồi phục vụ frontend qua Nginx. Worker dọn hold hết hạn và đưa callback thanh toán thành công đến muộn vào hàng đối soát thủ công. Lệnh seed tạo tài khoản demo, phim, rạp, phòng và suất chiếu mẫu; không chạy profile seed với dữ liệu hoặc môi trường production.

- Web: `http://localhost:8080`
- API health: `http://localhost:8080/api/health`
- PostgreSQL: `localhost:5434` (database/user `cinema`; mật khẩu lấy từ `.env`)

Kiểm tra trạng thái bằng `docker compose ps`; xem log bằng `docker compose logs -f api worker web`. PostgreSQL lưu dữ liệu trong volume `cinema_postgres_data`. Khi triển khai ngoài local, tự quản lý secret qua secret manager, cấu hình đúng số proxy tin cậy và thay dữ liệu demo bằng dữ liệu phù hợp.

## Khởi chạy Docker QA tách biệt

Stack QA dùng secrets trong `.env`, nhưng có Compose project và PostgreSQL volume riêng. Nếu chưa có `.env`, tạo một lần trước khi khởi chạy. Từ thư mục gốc:

```powershell
if (-not (Test-Path .env)) { npm run env:compose }
npm run compose:qa:up
```

Lệnh này dùng project `cinema-qa`, bind PostgreSQL ở `127.0.0.1:5435` và web ở `127.0.0.1:8081`, rồi chờ PostgreSQL/API/web health checks. Worker có healthcheck nội bộ tại `127.0.0.1:4001/healthz`; endpoint chỉ trả healthy sau khi một chu kỳ xử lý DB/outbox hoàn tất thành công trong vòng 30 giây gần nhất. Cổng này không publish ra host. Docker đánh dấu worker unhealthy sau các lần probe liên tiếp thất bại; restart policy vẫn chỉ tự khởi động lại khi process thoát. CORS tự thêm origin QA. Với một volume QA mới, nạp dữ liệu demo một lần:

```powershell
docker compose -p cinema-qa --profile seed run --rm seed
```

Không chạy seed profile trên dữ liệu cần giữ. Nếu hai cổng mặc định đang bận, đặt `QA_POSTGRES_HOST_PORT` hoặc `QA_WEB_HOST_PORT` trước lệnh launcher; `QA_CORS_ORIGIN` cho phép chỉ định danh sách origin riêng. Nếu mã runtime, Dockerfile hoặc migration thay đổi, rebuild image khi áp dụng:

```powershell
npm run compose:qa:up -- --build
```

QA PostgreSQL lưu trong volume `cinema-qa_cinema_postgres_data`, tách khỏi `dgkd_gk_cinema_postgres_data`. Không dùng `docker compose down -v` khi muốn giữ dữ liệu. Kiểm tra bằng `docker compose -p cinema-qa ps` và `http://localhost:8081/api/health`.

## Chạy ở chế độ phát triển trên máy host

```powershell
if (-not (Test-Path .env)) { npm run env:compose }
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
$composeEnv = @{}
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { $composeEnv[$matches[1]] = $matches[2] } }
$env:DATABASE_URL = "postgresql://cinema:$($composeEnv.POSTGRES_PASSWORD)@localhost:$($composeEnv.POSTGRES_HOST_PORT)/cinema?schema=public"
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
npm run typecheck:tests
npm run test:api
npx playwright install chromium
npm run test:browser
npm run test:worker-live
npm run build
```

`npm run typecheck:tests` chạy TypeScript strict trên backend source, seed, Vitest configs và toàn bộ test/harness TypeScript. CI chạy cổng này trước API tests; lệnh không cần truy cập database.

`npm test` chạy liền API/integration và browser E2E trên Chromium desktop + mobile. Các test API và E2E tạo dữ liệu; không trỏ `DATABASE_URL_TEST` hoặc `DATABASE_URL` vào database demo `cinema` trên cổng 5434. Local browser suite cần một database test riêng đã migrate/seed và không được dùng lại API đang chạy.

Test browser chạy qua Playwright trên Chromium và tự khởi động web/API development server theo cấu hình E2E. Chạy `npm run test:browser:ui` để mở Playwright UI. Các test PostgreSQL trong API suite chỉ chạy khi đặt `DATABASE_URL_TEST` tới một database test đã migrate; nếu bỏ trống, Vitest sẽ skip các ca cần DB.

`npm test` bao gồm API, worker process soak/restart và browser desktop/mobile. Bài live hold-expiry 5 phút được tách riêng để suite nhanh không phải chờ; chạy `npm run test:worker-live` với `DATABASE_URL_TEST` và `DATABASE_URL_WORKER_PROCESS_TEST` cùng trỏ tới một PostgreSQL database rehearsal đã migrate riêng, và `HOLD_TTL_SECONDS=300`.

```powershell
# Mỗi lượt dùng một database test mới trong PostgreSQL của stack QA.
$testDatabaseName = "cinema_browser_test_$([guid]::NewGuid().ToString('N').Substring(0, 8))"
docker compose -p cinema-qa exec -T postgres psql -U cinema -d postgres -c "CREATE DATABASE $testDatabaseName"
$composeEnv = @{}
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { $composeEnv[$matches[1]] = $matches[2] } }
$testDatabaseUrl = "postgresql://cinema:$($composeEnv.POSTGRES_PASSWORD)@localhost:5435/$testDatabaseName?schema=public"
$env:DATABASE_URL = $testDatabaseUrl
$env:DATABASE_URL_TEST = $testDatabaseUrl
npm run db:deploy
npm run db:seed
npx playwright install chromium
npm run test:browser
# Sau khi test xong và mọi process test đã dừng, có thể xóa đúng database dùng một lần này.
docker compose -p cinema-qa exec -T postgres dropdb -U cinema $testDatabaseName
```

API/integration tests also write fixture data, so point both `DATABASE_URL` and `DATABASE_URL_TEST` to an isolated test database before running `npm run test:api`. Browser tests modify catalog and booking data in their database; keep that data disposable and separate from the demo database. CI runs against a fresh PostgreSQL service and uploads the Playwright report.

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
