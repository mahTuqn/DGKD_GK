# Báo cáo tổng hợp kiểm thử

## Baseline local — 27/10/2026

| Cổng | Kết quả | Phạm vi/evidence |
|---|---|---|
| API, unit và PostgreSQL integration | Đạt: 17/17 trên 4 Vitest files | `npm test`; gồm API auth/RBAC/profile, concurrency 100 request, expiry/late webhook, order retry/payment, schedule buffer, Staff cinema scope, database uniqueness và callback idempotency |
| Browser E2E | Đạt: 24/24 | 12 case × Chromium desktop + Pixel 7; gồm `TC-E2E-11` kiểm tra markup do Admin nhập được render như text; report `reports/generated/playwright-results.json` |
| Accessibility | Đạt trong scope tự động | Axe 0 serious/critical ở discovery, seat map và checkout; keyboard/focus đến checkout pass; manual review và screen coverage còn thiếu |
| Build | Đạt | `npm run build`; backend TypeScript/Prisma và frontend TypeScript/Vite; log `reports/generated/final-build-results.log` |
| OpenAPI lint/CI | Đạt theo lần chạy cuối của nhóm | `npm run lint:openapi`; Redocly không có warning; gate đã được thêm vào CI. Lint kiểm tra tài liệu/schema, không thay thế contract test runtime trên toàn bộ endpoint |
| CI workflow configuration | Đã cấu hình; remote run chưa có | `ci.yml` gọi Gitleaks Action v3 cùng Gitleaks v8.30.1, Node 24, audit moderate, OpenAPI lint, traceability và test/build gates; GitHub Actions chưa được chạy trên remote |
| Coverage | Đạt | Domain 100% lines (35/35), branches (47/47), functions (14/14); 13 test domain; ngưỡng 90% line/80% branch |
| Mutation | Đạt | Stryker 81.82%, 153 killed, 34 survived, 0 timeout/error; ngưỡng 70% |
| Performance | Đạt trên local baseline, chưa phải staging | k6 50 VU/5 phút; showtime p95 27.57ms, hold p95 349.70ms, unexpected error 0%; ngưỡng lần lượt ≤500ms, ≤800ms, <1% |
| Security scan | Không có Critical/High trong phạm vi quét; còn alert Low cần triage | ZAP unauth API: H/M/L 0, Info 1; auth API: H/M 0, Low 1 (confidence thấp), Info 1; built preview: H/M/L 0, Info 1. Chi tiết ở `docs/05-bug-reports.md` |
| Dependency audit | Đạt | `npm audit --audit-level=moderate`: 0 vulnerabilities |
| Backup/restore rehearsal | Đạt: 27/10/2026 13:55 +07 | PostgreSQL 17 custom dump, restore vào UTF8 database từ `template0`; verify cinema=8, movie=3, user=153, showtime=4; artifact `reports/generated/recovery/restore-rehearsal.json` |
| Traceability | Đạt: 40 test cases/24 requirements | `npm run qa:trace` PASS. Validator kiểm tra test ID markers trên source `.ts/.js/.mjs/.yaml/.yml`, hỗ trợ prefix `Automated`; marker trong hai ZAP config được resolve |
| Start smoke | Đạt | Khởi chạy production backend bằng `npm start --workspace backend` và xác nhận health; log `reports/generated/start-smoke.log` |
| Secret scan | Đạt trong local scan scope | `npm run scan:secrets` bằng Gitleaks v8.30.1: 1 commit, ~706 KB, không có leak; log/JSON ở `reports/generated/final-gitleaks-results.log` và `final-gitleaks.json` |
| Frozen clean-clone verification | Đạt | Commit `2be2d911c635cbdbe810bd4f77eca71b73928d1f`; clone sạch chạy install, DB generate/deploy/seed, secret scan, OpenAPI lint, traceability 40/24, API 17/17, build, browser 24/24, coverage 100% và mutation 81.82%; log ở `reports/generated/clean-clone/` |

Các phép đo unit/coverage, hiệu năng, ZAP và Gitleaks dùng fixture/history local. Không suy rộng thành chứng nhận staging hoặc production. Traceability pass với 40 test cases/24 requirements sau khi validator quét marker trên source TypeScript/JavaScript/YAML, hỗ trợ prefix `Automated`. Manifest ghi nhận commit đã kiểm tra, kết quả clone sạch và SHA-256 cho các artifact được liệt kê. GitHub Actions workflow đã được cấu hình nhưng chưa có remote run.

## Test đã triển khai

- Browser: health, đăng ký/đặt vé/thanh toán demo/QR, staff check-in một lần, Admin occupancy/CRUD, lọc phim-rạp-ngày, axe trên discovery/seat map/checkout, keyboard/focus, security headers trên built preview và kiểm tra markup do Admin nhập được render an toàn. 24/24 trên hai cấu hình Chromium.
- HTTP/PostgreSQL integration: auth/RBAC/profile, schedule overlap/buffer, hold limit/race/expiry, price snapshot/order retry, payment idempotency/late callback/revenue, admin và staff scope; unique seat claim và callback đồng thời trong DB.
- Domain: 13 test; timezone, deadline, pricing, unique seat IDs, occupancy/input boundaries và bốn fixed-seed property tests.
- Performance: 50 virtual users trong năm phút với backend build và PostgreSQL 17 riêng trên máy local.
- Security: ZAP OpenAPI-driven unauthenticated/authenticated API scans và active scan trên frontend production preview; dữ liệu scanner nằm trong disposable database.
- Backup/restore: PostgreSQL custom-format dump được khôi phục vào UTF8 database rồi kiểm tra counts; dump giữ trong gitignored `reports/generated/recovery/`.

## Lỗi đã sửa và quan sát bảo mật

- `BUG-001` — Payment success làm mất modal khi `hold=null`; đã sửa và retest browser flow.
- `BUG-002` — Axe tìm accessible name không khớp nội dung ở logo/áp phích; đã sửa, axe không còn serious/critical ở các màn đã quét.
- `BUG-003` — CSP chặn React Refresh inline preamble trong Vite dev; đã giới hạn CSP vào built preview và chuyển E2E header check sang preview. Retest browser suite đạt 24/24.
- `SEC-OBS-01` — ZAP authenticated scan lưu payload script vào trường cinema rồi thấy lại trong JSON. Alert Low/Low confidence do JSON không phải HTML; `TC-E2E-11` pass và xác nhận Admin UI render markup như text, không tạo node `img/script`. Alert không tái hiện thành thực thi script trong UI đã kiểm tra; API JSON consumers khác vẫn phải escape nội dung.

## Còn thiếu so với kế hoạch

- k6 mới là baseline local, chưa chạy staging, soak, hoặc reliability test đa instance/worker restart.
- Browser suite chưa bao phủ riêng lost-seat contention, payment failure và chờ TTL năm phút; các nhánh API/policy có test nhưng không thay cho journey trình duyệt.
- ZAP scan scope hữu hạn; cần xác minh `SEC-OBS-01`, review BOLA/IDOR theo ma trận object/role và checklist ASVS/API Top 10. Một ZAP pass không chứng minh ứng dụng an toàn toàn diện.
- Accessibility chưa có manual WCAG 2.2 AA review; axe chưa quét riêng login, ticket, admin.
- Restore rehearsal không đánh giá lịch backup, PITR, RPO/RTO hay production restore. Cũng chưa thử worker/job restart, reconciliation và gateway timeout.
- Không có hazard analysis; safety chưa đánh giá. Payment vẫn là mock, không phải cổng thanh toán thật.
