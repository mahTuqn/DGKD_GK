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
| Browser E2E | Health → khám phá phim/suất → giữ ghế → thanh toán demo → vé → staff soát vé; admin CRUD, bộ lọc, security headers, HTML injection, hold expiry, session/logout và payment-response-loss recovery | GitHub Actions run [40680542571](https://github.com/mahTuqn/DGKD_GK/actions/runs/40680542571), commit `3ec10eb`: **46/46** lượt (23 case × Chromium desktop/Pixel 7 mobile), không fail/skip/flaky |
| Accessibility | Axe discovery, login dialog, seat map, checkout, ticket, Admin; keyboard/focus, form validation and announced error states | Run 40680542571: **46/46**; axe across six scopes, keyboard/focus, alerts, Admin details and mobile logout accessible name verified. Manual WCAG/screen-reader review remains |
| Security | BOLA, RBAC, token, rate limit, error disclosure, dependency/secret scan, authenticated and unauthenticated DAST | CI 40680542571 passed audit, Gitleaks, and all three Compose DAST scopes. No Critical/High/Medium; authenticated API retains one triaged Low-confidence JSON markup observation. Exhaustive BOLA/ASVS and production/staging review remain unverified |
| Hiệu năng | Đọc danh sách và hold ghế | k6 local baseline: 50 VU/5 phút; showtime p95 9.85ms, hold p95 265.35ms, lỗi ngoài conflict 0%; đạt ngưỡng đã đặt nhưng chưa phải staging |
| Backup/restore | PostgreSQL custom-format dump, restore vào database mới và kiểm tra record counts | Rehearsal đã đạt trên PostgreSQL 17 với source/target UTF8; chưa thay thế backup schedule/PITR/RPO/RTO/production restore |

## Quy tắc test

- Tên test tự động bắt đầu bằng test ID trong `docs/04-test-cases.csv`.
- Browser flow đăng ký email mới cho mỗi lần chạy, lấy ghế khả dụng tại thời điểm chạy và chỉ dùng QR token tạo trong chính flow. Không dùng vé hoặc ghế cố định.
- Staff soát vé chạy trong cùng journey sau khi customer mua vé; lần soát thứ hai phải bị từ chối. Test lấy token QR mới nhất qua endpoint có xác thực rồi gửi qua UI staff.
- API check-in phải kiểm tra ticket ID và QR với Staff đúng cinema, Staff ngoài scope/chưa phân công và Admin toàn cục; API profile chỉ cho chủ tài khoản sửa name/email.
- Lịch mới cùng auditorium cần tối thiểu 20 phút giữa endAt của suất trước và startAt kế tiếp; test kiểm tra cả create và patch.
- Test race dùng một suất/ghế fixture chuyên dụng hoặc reset DB trước suite; chỉ kiểm tra đúng một thành công.
- Các kiểm tra thời gian deterministic dùng clock có thể điều khiển trong unit/API; suite live TTL 5 phút chạy riêng để không kéo dài suite nhanh.
- `TC-UNIT-08` và `TC-WORKER-03` kiểm tra biên chính xác; live HTTP `TC-WORKER-03` đạt 1/1 trong 301.60 giây, xác nhận 409 trước hạn, worker persisted expiry/audit/release và giữ lại ghế sau hạn.
- Mỗi bug có steps, expected/actual, severity, commit fix và retest.
- Browser test dùng Playwright; evidence gồm report, trace/screenshot nếu fail. Không lấy pass của browser thay cho kiểm tra invariant database.

## Frozen-baseline evidence — 27/10/2026

`npm test` exit 0: API 17/17 trên 4 Vitest files; Playwright 24/24 (12 case × 2 project), có TC-E2E-11 kiểm tra payload markup hiển thị an toàn như text. `npm run qa:trace` PASS: 40 test cases/24 requirements; validator kiểm tra test ID markers trên mọi source `.ts/.js/.mjs/.yaml/.yml`, hỗ trợ prefix `Automated`, gồm markers trong hai ZAP config. Redocly OpenAPI lint pass không warning; build, dependency audit và start smoke đều đạt. Local Gitleaks v8.30.1 pass: 1 commit/~706 KB, không có leak. Coverage domain 100% line/branch/function; mutation 81.82%; k6 local baseline 50 VU/5 phút (showtime p95 27.57ms, hold p95 349.70ms, lỗi ngoài conflict 0%). Historical ZAP reports ghi nhận unauthenticated API 0 High/Medium/Low và 1 Info, report auth 0 High/Medium, 1 Low-confidence alert và 1 Info, built preview 0 High/Medium/Low và 1 Info. Config authenticated cũ không khai báo authentication/user/header, nên không xác nhận được report auth có thực sự đăng nhập; không tính đây là cổng authenticated đã đạt. TC-E2E-11 xác nhận Admin UI render markup nhập vào như text và không tạo node `img`/`script`; dữ liệu JSON vẫn cần escaping theo consumer.

Các kết quả trên là baseline local trên Windows/PostgreSQL 17, không phải chứng nhận staging/production. Backup/restore rehearsal UTF8 vẫn đạt lúc 13:55 +07. Chi tiết artifact và hash được ghi trong [evidence manifest](evidence/final/manifest.json); tóm tắt phạm vi ở [test summary](07-test-summary.md).

Rehearsal ban đầu dùng encoding đích mặc định WIN1258 nên không restore được source UTF8; lượt đạt tạo database đích UTF8 từ `template0`.

## Follow-up trên working tree — 27/10/2026

Sau frozen baseline, dự án bổ sung Compose cho PostgreSQL/API/worker/web, worker hết hạn hold và đơn chờ, outbox cho callback thành công đến muộn, BOLA ownership tests và hai browser journeys cho payment failure/lost-seat conflict. Kết quả đã xác nhận trên working tree: API/PostgreSQL integration 20/20 ở 6 Vitest files; browser 28/28 (14 case × Chromium desktop + Pixel 7) chạy với web/API trong Docker QA; `npm run qa:trace` PASS với 45 test cases/25 requirements. Docker demo đang chạy tại `http://localhost:8080`, PostgreSQL port 5434; Docker QA dùng database/volume riêng tại web 8081 và PostgreSQL 5435. Worker expiry và catch-up sau restart đã được smoke test trên Docker QA; soak hoặc multi-instance rehearsal vẫn còn thiếu.

Kết quả working tree xác nhận API, browser, traceability, build/OpenAPI, coverage, mutation, dependency audit, backup/restore và k6. Restore rehearsal sau migrations mới đạt trên PostgreSQL 17/UTF8; artifact và counts tại `reports/generated/recovery/followup-20261027.json`. Mutation đạt 81.82% (153 killed/34 survived/0 timeout). K6 local Docker QA đạt 50 VU/5 phút: showtime p95 9.85ms, hold p95 265.35ms, unexpected error 0%; artifact tại `reports/generated/k6/followup-20261027-metadata.json`. Clean clone ngày 28/10 của commit `5ae4c2b7b25e5e5b6b4d80c675fc190763743125` đạt API 20/20, browser 28/28, build/OpenAPI/traceability/audit; Gitleaks v8.30.1 quét 5 commits và không phát hiện leak. ZAP chưa chạy lại trên delta mới. Staging/production, manual WCAG review, gateway thật, worker soak/multi-instance, PITR/RPO/RTO và exhaustive ASVS/BOLA review vẫn là cổng còn lại.

## Rerun local PostgreSQL cô lập — 28/10/2026

Working tree hiện tại được chạy lại với cluster PostgreSQL 17.11 tạm, chỉ bind `127.0.0.1:55432`, tách database app/test và không dùng Docker hay PostgreSQL service hiện có. `npm test` đạt API 21/21 trên 6 files và browser 28/28 (14 case × Chromium desktop/Pixel 7 mobile). Browser axe hiện bao phủ discovery, login dialog, seat map, checkout, ticket và Admin. `TC-WORKER-03` xác nhận expiry đúng tại `boundaryAt` và hold vẫn còn hiệu lực tại `boundaryAt + 1 ms`. Build và traceability 46/25 cũng đạt. Manifest và hash nằm tại [local PostgreSQL rerun evidence](evidence/followup/2026-10-28-local-postgres-rerun.json). Đây là kiểm chứng working tree local, không thay cho clean-clone/Docker run; ZAP, remote CI và các giới hạn production ở trên vẫn mở.

## Expanded final local PostgreSQL rerun — 28/10/2026

Ở lượt mở rộng trước đó sau khi thêm E2E-14/15, TC-WORKER-04 và keyboard assertions cho TC-E2E-02, `npm test` đạt API 22/22 trên 6 Vitest files, TC-WORKER-05 process soak/restart 1/1 và browser 32/32 (16 case × desktop/mobile), không fail/skip/flaky. TC-WORKER-05 chạy hai worker loop trong hai tiến trình Node trên DB PostgreSQL biệt lập suốt 60 giây, nạp event định kỳ, kiểm tra mỗi event chỉ có một attempt/case, dừng graceful rồi khởi động worker thay thế để xác nhận event mới được bắt kịp. Đây là rehearsal local một phút, không chứng minh soak production dài hạn. Evidence và hashes nằm trong [worker process suite manifest](evidence/followup/2026-10-28-local-postgres-worker-process.json). Docker/ZAP chưa chạy do Docker Desktop offline; kết quả local không thay cho Docker clean clone, CI remote hay staging.

## Lệnh thực thi

Từ thư mục gốc:

`npm test` chạy API suite, TC-WORKER-05 trên database được cấu hình qua `DATABASE_URL_WORKER_PROCESS_TEST`, rồi browser suite. Live TTL test TC-WORKER-03 chạy riêng bằng `npm run test:worker-live`; `DATABASE_URL_TEST` và `DATABASE_URL_WORKER_PROCESS_TEST` phải trỏ cùng một database rehearsal riêng đã migrate, đồng thời đặt `HOLD_TTL_SECONDS=300`. Không chạy suite live trên database development có dữ liệu cần giữ. CI quality job tạo/migrate database worker riêng và chạy cả process suite lẫn live TTL suite.

TC-WORKER-06 là cổng opt-in local riêng: `npm run test:worker-soak` chạy hai worker process trong 300 giây, giữ mặc định TC-WORKER-05 ở 60 giây để không kéo dài `npm test`. Local gate chưa chạy do máy thiếu khoảng trống RAM và chưa cấu hình URL DB soak riêng. Cổng CI tương ứng đã đạt ở run [`40674582910`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40674582910): hai worker chạy **306.17 giây**, graceful shutdown và worker thay thế bắt kịp event pending. Cả local và CI dùng database PostgreSQL loopback riêng; preflight từ chối URL thiếu/remote/tên database không đúng và không tự tạo/xóa database.

```powershell
npm run qa:trace
npm run lint:openapi
npm test
npm run test:api
npm run test:worker-live
npx playwright install chromium
npm run test:browser
npm run build
npm audit --audit-level=high
```

`playwright.config.ts` tự khởi động API và Vite, chờ health/UI trước khi test. Báo cáo Playwright được lưu trong `reports/generated/`; lệnh `npm run test:browser:ui` mở giao diện Playwright.

## Earlier P0 gap follow-up snapshot — 28/10/2026 (historical)

Đây là snapshot cũ trước lượt full rerun sau đó. Khi đó, sau khi bổ sung regression cho ba rủi ro P0, `npm test` trên PostgreSQL 17.11 cô lập đạt API **25/25 trên 7 Vitest files**, worker-process soak/restart **1/1**, và Playwright **40/40** (20 case × Chromium desktop/Pixel 7 mobile), không fail/skip/flaky. API mới kiểm tra Customer không thể hoàn tất thanh toán của người khác, profile từ chối mass assignment `role`/`assignedCinemaId`, và đủ 18 route Admin trả 403 cho Customer. `TC-E2E-19` mô phỏng payment đã commit nhưng browser mất response; retry cùng order khôi phục trạng thái mà không nhân đôi vé. `TC-WORKER-03` live HTTP test riêng đạt **1/1 trong 301.60 giây**. Traceability tại snapshot này là **57 test cases/25 requirements**; số liệu mới hơn nằm trong mục Full rerun bên dưới.

Test accessibility mới kiểm tra validation/alert đăng ký, alert đăng nhập sai và accessible name của Admin details. Trong lúc đó đã sửa lỗi phân loại copy theo mã lỗi: đăng nhập sai không còn báo phiên hết hạn, email trùng không còn báo xung đột ghế; UI cũng giải thích trạng thái chưa rõ khi mất response thanh toán và giữ thao tác retry an toàn. Mutation hiện tại đạt **81.82%** (153 killed, 34 survived, 0 timeout/error; ngưỡng 70%); `npm audit --audit-level=high` ghi nhận **0 vulnerabilities**. Log chạy mới nhất: `reports/generated/local-postgres-20261028-current-full-regression.log`.

Cluster kiểm thử full suite chỉ bind `127.0.0.1:55432`, tách DB API và worker; không dùng Docker. Sau khi mở rộng TC-E2E-11, `npm test` tại snapshot này đạt API **25/25** trên 7 files, worker-process **1/1**, browser **40/40** trên desktop/mobile, không fail/skip/flaky. Docker Desktop lúc đó dừng nên Compose database/demo container và Compose-based DAST chưa xác minh. Ba native ZAP 2.17.0 scan trên DB tạm riêng đạt 401 unauthenticated, 200 Admin và built Vite preview; không có High/Medium, có một finding Low-confidence về dữ liệu markup trong JSON. `TC-E2E-11` xác nhận markup hiển thị như text trên desktop/mobile. Gitleaks lịch sử quét sạch 7 commit và 18 mục mã nguồn/cấu hình/tài liệu; lượt mới nhất sau các thay đổi này bị Docker Engine chặn trước khi quét, nên không chứng minh working tree hiện tại sạch secret. Xem [native ZAP evidence](evidence/followup/2026-10-28-native-zap-dast.json), [Gitleaks evidence](evidence/followup/2026-10-28-gitleaks-current-working-tree.json) và [current regression manifest](evidence/followup/2026-10-28-local-postgres-p0-gap-regression.json).
Cluster kiểm thử full suite chỉ bind `127.0.0.1:55432`, tách DB API và worker; không dùng Docker. Sau khi mở rộng TC-E2E-11, `npm test` chạy lại đạt API **25/25** trên 7 files, worker-process **1/1**, browser **40/40** trên desktop/mobile, không fail/skip/flaky. Docker Desktop vẫn dừng nên Compose database/demo container và Compose-based DAST chưa xác minh. Bổ sung, ba native ZAP 2.17.0 scan trên DB tạm riêng đã chạy: API unauthenticated `/api/auth/me` = 401, API authenticated Admin `/api/admin/summary` = 200 và built Vite preview; không có High/Medium, có một finding Low-confidence về dữ liệu markup trả lại trong JSON. Host filter được sửa từ `api:4000` thành `api` vì ZAP so hostname không gồm port. `TC-E2E-11` kiểm tra tên/thành phố/địa chỉ hiển thị như text, không tạo `img/script/svg` node, 2/2 desktop/mobile. Vite preview native không thay thế Docker/Nginx image check. Gitleaks v8.30.1 quét sạch 7 commit và 18 mục mã nguồn/cấu hình/tài liệu trong working tree; lượt quét toàn thư mục riêng chỉ khớp rule JWT trong ba artifact thuộc `reports/generated` (đã bị Git ignore). Xem [native ZAP evidence](evidence/followup/2026-10-28-native-zap-dast.json), [Gitleaks evidence](evidence/followup/2026-10-28-gitleaks-current-working-tree.json) và [current regression manifest](evidence/followup/2026-10-28-local-postgres-p0-gap-regression.json). GitHub Actions remote, manual WCAG/screen-reader, staging/production, gateway/refund thật, prolonged soak, PITR/RPO/RTO và exhaustive ASVS/BOLA review còn mở.

## Full rerun sau team follow-up — 28/10/2026

Sau khi bổ sung `TC-SEC-07` (Customer B dùng hold của Customer A), mở rộng `TC-E2E-15` để sửa tên phòng và kiểm tra sau reload, đồng thời thêm keyboard disclosure assertions vào `TC-E2E-18`, full `npm test` chạy lại với PostgreSQL 17.11 biệt lập tại `127.0.0.1:55434` và đạt **API 26/26 trên 7 Vitest files, worker-process 1/1, Playwright 40/40** (20 case × Chromium desktop/Pixel 7 mobile), không fail/skip/flaky. `npm run qa:trace` đạt **58 test cases/25 requirements** ở snapshot đó; một focused run riêng của authorization suite hẹp hơn đạt 8/8, cùng với TC-E2E-15 2/2 và TC-E2E-18 2/2. Kết quả auth 8/8 là evidence trước khi ma trận Guest/Customer/Staff mở rộng được thêm; một lượt focused sau đó đã xác minh ma trận mở rộng 7/7, được ghi ở cuối `docs/07-test-summary.md`. Browser report và log full suite ở `reports/generated/playwright-results.json` và `reports/generated/local-postgres-20261028-current-full-regression.log`.

Lượt chạy dùng database mới, migrate/seed riêng; không dùng Docker hoặc PostgreSQL service trên máy. Docker Desktop launch attempt mới dừng với lỗi Windows 1920 khi backend không thể xóa reparse point `%LOCALAPPDATA%\Docker\run\sailor-ingest.sock`; Docker API vẫn không kết nối được. Không xóa Docker volume hay reset data disk. Xem [Docker Desktop blocker evidence](evidence/followup/2026-10-28-docker-desktop-blocker.json). Compose database/DAST, Docker/Nginx image preview và remote GitHub Actions vì thế vẫn chưa xác minh. Manual WCAG/screen-reader, staging/production, payment gateway/refund thật, prolonged soak, PITR/RPO/RTO và exhaustive ASVS/BOLA review tiếp tục là cổng mở.

## Docker runtime recovery and browser verification — 28/10/2026

Docker Desktop được khôi phục bằng cách giữ nguyên rồi đổi tên thư mục runtime `%LOCALAPPDATA%\Docker\run` sang `run.codex-preserved-20261028-01`; hai socket cũ được bảo toàn. Không xóa volume, reset Docker, sửa VHDX hoặc dừng PostgreSQL service. Engine 29.7.2 chạy lại; Compose `dgkd_gk` và `cinema-qa` có PostgreSQL/API/web/worker hoạt động, hai database PostgreSQL healthy trên cổng 5434 và 5435. Demo DB trả lời được query; web demo `/healthz` trả 200.

Để kiểm tra source mới nhất mà không thay đổi DB demo hoặc rebuild image khi ổ C gần đầy, đã tạo DB disposable riêng trong container PostgreSQL QA, chạy migrate/seed rồi chạy Playwright với API/frontend hiện tại trên host. Browser suite đạt **40/40**, không fail/skip/flaky; DB disposable được xóa sau lượt chạy, hai Compose stack và volumes vẫn giữ nguyên. Đây là browser verification với PostgreSQL trong Docker, chưa phải kiểm thử API/web Docker image hiện tại.

Lượt thử trước dùng `E2E_BASE_URL` trỏ trực tiếp tới web container nên không khởi động các test servers mà suite cần ở `localhost:4000` và `localhost:5174`; 34/40 test fail vì cấu hình đó và image container cũ, không được tính là kết quả code. Tại snapshot Docker này, Compose DAST chưa chạy vì pinned ZAP digest chưa có local và ổ C còn khoảng 0.15 GB; một lượt thử sau đó đã bắt đầu nhưng bị ngắt do Engine HTTP 500, được ghi ở mục Latest Docker DAST attempt. Chi tiết browser pass và giới hạn ở [Docker runtime recovery evidence](evidence/followup/2026-10-28-docker-runtime-recovery-browser.json).

### Latest Docker DAST attempt — 28/10/2026

Sau khi Docker phục hồi và chuyển npm cache sang ổ E, Compose DAST dựng image riêng, migrate/seed đạt, ZAP import 35 OpenAPI URL rồi bắt đầu active scan. Lượt bị ngắt khi Docker Engine trả HTTP 500; không có report pass và cleanup Compose không hoàn tất. `DAST_KEEP_VOLUMES=1` giữ cờ xóa volume khỏi lệnh cleanup; trạng thái resource tạm không thể kiểm kê khi Engine mất phản hồi. Thử restart Desktop vượt deadline; `docker-desktop` WSL distro và `com.docker.service` vẫn stopped, web ports 8080/8081 hiện không kết nối. Không xóa/reset volume, không factory reset, không sửa VHDX và Windows PostgreSQL service vẫn Running. Xem [evidence lượt DAST bị ngắt](evidence/followup/2026-10-28-docker-engine-dast-interruption.json).

**Lượt CI trước (28/10/2026):** GitHub Actions run [`40674582910`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40674582910) trên commit `5188ab7` đã **thành công cả quality và DAST** từ clean checkout. Quality: API **32/32** trên 8 files, worker-process TC-WORKER-05 **1/1** trong 62.15 giây, live HTTP expiry TC-WORKER-03 **1/1** trong 300.76 giây, TC-WORKER-06 soak/restart **1/1** trong 306.17 giây, browser **40/40**, OpenAPI lint, traceability **65/25** và production build. DAST đã qua unauthenticated API, authenticated API và production web preview; [artifact](https://github.com/mahTuqn/DGKD_GK/actions/runs/40674582910/artifacts/12809594145) không có Critical/High/Medium. Authenticated API có một alert Low, confidence 1, về markup tồn tại trong JSON; E2E-11 xác nhận Admin UI render markup như text. Local run riêng gần nhất ghi nhận focused authorization **8/8**, cấu hình bảo mật **4/4** và Gitleaks không có findings. Máy local còn 461 MiB RAM trống lúc kiểm tra nên DAST/soak không chạy tại chỗ. Manual WCAG/screen-reader, staging/production thật, gateway/refund thật, prolonged reliability soak, PITR/RPO/RTO và exhaustive ASVS/BOLA vẫn là gate mở.

## Latest exact-head verification — commit `3ec10eb` — 28/10/2026

GitHub Actions run [40680542571](https://github.com/mahTuqn/DGKD_GK/actions/runs/40680542571) completed both quality and DAST successfully from a clean checkout at `3ec10eb53967093e97bf34ebd6ff513e1550b497`. Quality passed API **32/32** on 8 files, TC-WORKER-05 **1/1** in 62.19 seconds, live HTTP expiry TC-WORKER-03 **1/1** in 300.89 seconds, TC-WORKER-06 two-worker soak/restart **1/1** in 306.42 seconds, build, OpenAPI lint, dependency audit (0 vulnerabilities), traceability **68/25**, and Playwright **46/46** (23 cases × Chromium desktop/Pixel 7 mobile; no failures, skips, or flaky tests). TC-E2E-20, TC-E2E-21 and TC-E2E-22 each passed 2/2 across desktop/mobile. E2E-21 also retested the mobile logout fix (BUG-010).

DAST passed unauthenticated API, authenticated API and production web preview. There were no Critical/High/Medium alerts; authenticated API retained one triaged Low-confidence persistent-markup observation in JSON. Sanitized reports are in [artifact 12813440250](https://github.com/mahTuqn/DGKD_GK/actions/runs/40680542571/artifacts/12813440250), and the browser report is in [artifact 12813541109](https://github.com/mahTuqn/DGKD_GK/actions/runs/40680542571/artifacts/12813541109). The evidence manifest is [2026-10-28-github-actions-3ec10eb.json](evidence/followup/2026-10-28-github-actions-3ec10eb.json).

Manual WCAG/screen-reader review, staging/production behavior, backup schedule/PITR/RPO/RTO and production restore, exhaustive ASVS/BOLA review, and reliability beyond the five-minute worker soak remain unmeasured. The SRS uses mock payment, so a real gateway/refund is outside this project's acceptance scope.
