# Kế hoạch kiểm thử CinemaBooking

## Mục tiêu

Kiểm tra các yêu cầu trong [SRS](01-srs.md), tập trung rủi ro bán trùng ghế, hold hết hạn, thanh toán lặp, truy cập đơn của người khác, lịch cùng phòng thiếu buffer, profile và giới hạn check-in theo cinema. Kết quả chỉ đại diện cho commit, dữ liệu seed và môi trường được lưu trong evidence.

## Chiến lược và cổng chất lượng

| Tầng | Phạm vi | Cổng đề xuất |
|---|---|---|
| Unit/domain | TTL, giá VND, trạng thái đơn/vé, giới hạn ghế | Đạt: 100% line/branch/function; mutation mục hold/payment tổng thể 81.82% (ngưỡng 70%) |
| API/integration | Auth/RBAC, validation, ownership, payment/hold/order/check-in | PostgreSQL test DB; mutation có assertion dữ liệu sau cùng |
| Contract/OpenAPI | Cấu trúc OpenAPI và rule lint | `npm run lint:openapi` chạy trong CI; Redocly lint không warning. Đây là lint contract document, chưa phải runtime contract test cho mọi endpoint |
| Concurrency | Nhiều request cùng ghế/suất | 100 request ở nhiều browser/context/process; tối đa 1 hold/sale active; conflict còn lại là 409 |
| Browser E2E | Health → khám phá phim/suất → giữ ghế → thanh toán demo → vé → staff soát vé; thêm admin CRUD, bộ lọc phim/rạp/ngày, security headers và HTML injection rendering | Đạt 24/24: 12 case trên Chromium desktop và Pixel 7 mobile |
| Accessibility | Axe discovery, seat map, checkout; tự động kiểm tra keyboard/focus đến checkout | Axe serious/critical = 0 trong các màn đã quét; TC-E2E-09 pass; review thủ công đầy đủ vẫn cần riêng |
| Security | BOLA, RBAC, token, rate limit, lỗi không lộ stack, dependency và secret scan | ZAP không có Critical/High trong scope; local Gitleaks v8.30.1 pass với 1 commit/~706 KB, không có leak; GitHub Actions remote chưa chạy |
| Hiệu năng | Đọc danh sách và hold ghế | k6 local baseline: 50 VU/5 phút; showtime p95 9.85ms, hold p95 265.35ms, lỗi ngoài conflict 0%; đạt ngưỡng đã đặt nhưng chưa phải staging |
| Backup/restore | PostgreSQL custom-format dump, restore vào database mới và kiểm tra record counts | Rehearsal đã đạt trên PostgreSQL 17 với source/target UTF8; chưa thay thế backup schedule/PITR/RPO/RTO/production restore |

## Quy tắc test

- Tên test tự động bắt đầu bằng test ID trong `docs/04-test-cases.csv`.
- Browser flow đăng ký email mới cho mỗi lần chạy, lấy ghế khả dụng tại thời điểm chạy và chỉ dùng QR token tạo trong chính flow. Không dùng vé hoặc ghế cố định.
- Staff soát vé chạy trong cùng journey sau khi customer mua vé; lần soát thứ hai phải bị từ chối. Test lấy token QR mới nhất qua endpoint có xác thực rồi gửi qua UI staff.
- API check-in phải kiểm tra ticket ID và QR với Staff đúng cinema, Staff ngoài scope/chưa phân công và Admin toàn cục; API profile chỉ cho chủ tài khoản sửa name/email.
- Lịch mới cùng auditorium cần tối thiểu 20 phút giữa endAt của suất trước và startAt kế tiếp; test kiểm tra cả create và patch.
- Test race dùng một suất/ghế fixture chuyên dụng hoặc reset DB trước suite; chỉ kiểm tra đúng một thành công.
- Các kiểm tra thời gian dùng clock có thể điều khiển ở unit/API, không chờ 5 phút trong suite nhanh.
- `TC-UNIT-08` kiểm tra expiresAt nhỏ hơn, bằng và lớn hơn `now`; đã pass trong final `npm test`. Chưa có integration test chờ thực quanh TTL 5 phút.
- Mỗi bug có steps, expected/actual, severity, commit fix và retest.
- Browser test dùng Playwright; evidence gồm report, trace/screenshot nếu fail. Không lấy pass của browser thay cho kiểm tra invariant database.

## Frozen-baseline evidence — 27/10/2026

`npm test` exit 0: API 17/17 trên 4 Vitest files; Playwright 24/24 (12 case × 2 project), có TC-E2E-11 kiểm tra payload markup hiển thị an toàn như text. `npm run qa:trace` PASS: 40 test cases/24 requirements; validator kiểm tra test ID markers trên mọi source `.ts/.js/.mjs/.yaml/.yml`, hỗ trợ prefix `Automated`, gồm markers trong hai ZAP config. Redocly OpenAPI lint pass không warning; build, dependency audit và start smoke đều đạt. Local Gitleaks v8.30.1 pass: 1 commit/~706 KB, không có leak. Coverage domain 100% line/branch/function; mutation 81.82%; k6 local baseline 50 VU/5 phút (showtime p95 27.57ms, hold p95 349.70ms, lỗi ngoài conflict 0%). ZAP API unauthenticated có 0 High/Medium/Low và 1 Info; authenticated có 0 High/Medium, 1 Low-confidence alert và 1 Info; built preview có 0 High/Medium/Low và 1 Info. TC-E2E-11 xác nhận Admin UI render markup nhập vào như text và không tạo node `img`/`script`; ZAP alert vẫn chỉ áp dụng cho JSON response và consumers khác cần escape dữ liệu.

Các kết quả trên là baseline local trên Windows/PostgreSQL 17, không phải chứng nhận staging/production. Backup/restore rehearsal UTF8 vẫn đạt lúc 13:55 +07. Chi tiết artifact và hash được ghi trong [evidence manifest](evidence/final/manifest.json); tóm tắt phạm vi ở [test summary](07-test-summary.md).

Rehearsal ban đầu dùng encoding đích mặc định WIN1258 nên không restore được source UTF8; lượt đạt tạo database đích UTF8 từ `template0`.

## Follow-up trên working tree — 27/10/2026

Sau frozen baseline, dự án bổ sung Compose cho PostgreSQL/API/worker/web, worker hết hạn hold và đơn chờ, outbox cho callback thành công đến muộn, BOLA ownership tests và hai browser journeys cho payment failure/lost-seat conflict. Kết quả đã xác nhận trên working tree: API/PostgreSQL integration 20/20 ở 6 Vitest files; browser 28/28 (14 case × Chromium desktop + Pixel 7) chạy với web/API trong Docker QA; `npm run qa:trace` PASS với 45 test cases/25 requirements. Docker demo đang chạy tại `http://localhost:8080`, PostgreSQL port 5434; Docker QA dùng database/volume riêng tại web 8081 và PostgreSQL 5435. Worker expiry và catch-up sau restart đã được smoke test trên Docker QA; soak hoặc multi-instance rehearsal vẫn còn thiếu.

Kết quả working tree xác nhận API, browser, traceability, build/OpenAPI, coverage, mutation, dependency audit, backup/restore và k6. Restore rehearsal sau migrations mới đạt trên PostgreSQL 17/UTF8; artifact và counts tại `reports/generated/recovery/followup-20261027.json`. Mutation đạt 81.82% (153 killed/34 survived/0 timeout). K6 local Docker QA đạt 50 VU/5 phút: showtime p95 9.85ms, hold p95 265.35ms, unexpected error 0%; artifact tại `reports/generated/k6/followup-20261027-metadata.json`. Clean clone ngày 28/10 của commit `5ae4c2b7b25e5e5b6b4d80c675fc190763743125` đạt API 20/20, browser 28/28, build/OpenAPI/traceability/audit; Gitleaks v8.30.1 quét 5 commits và không phát hiện leak. ZAP chưa chạy lại trên delta mới. Staging/production, manual WCAG review, gateway thật, worker soak/multi-instance, PITR/RPO/RTO và exhaustive ASVS/BOLA review vẫn là cổng còn lại.

## Lệnh thực thi

Từ thư mục gốc:

```powershell
npm run qa:trace
npm run lint:openapi
npm test
npm run test:api
npx playwright install chromium
npm run test:browser
npm run build
npm audit --audit-level=high
```

`playwright.config.ts` tự khởi động API và Vite, chờ health/UI trước khi test. Báo cáo Playwright được lưu trong `reports/generated/`; lệnh `npm run test:browser:ui` mở giao diện Playwright.
