# Báo cáo tổng hợp kiểm thử

## Latest exact-source CI result — `3eac808` — 29/10/2026

All three GitHub Actions workflows passed on commit `3eac80867cd5028e96430922ff324093bdecf3a3`: [quality, API, DAST, mutation and Compose run 40800961578](https://github.com/mahTuqn/DGKD_GK/actions/runs/40800961578), [Firefox/WebKit smoke 40800961547](https://github.com/mahTuqn/DGKD_GK/actions/runs/40800961547), and [15-minute worker soak 40800961561](https://github.com/mahTuqn/DGKD_GK/actions/runs/40800961561). Traceability passed at **93 cases / 26 requirements**. Quality/API included TC-PLAN-08: 100 simultaneous requests split across two OS API processes returned 1 success and 99 conflicts, with exactly one persisted HELD claim and hold. Live five-minute expiry, five-minute worker soak/restart, production build, Chromium desktop/Pixel 7 browser tests, Compose-image booking smoke, domain coverage/mutation, Firefox/WebKit desktop, and the 15-minute worker soak/restart/catch-up all passed.

The current DAST artifact was downloaded and SHA-256 verified against GitHub metadata; all three reports parsed. It contains 0 High/Medium, one Low alert record with 3 instances, and 5 Informational records with 11 instances. The Low alert is the triaged `SEC-OBS-01` JSON markup observation; the tested Admin UI still renders the submitted values as text, while other JSON consumers require context-appropriate output encoding. Alert metadata and artifact digests are in the [3eac808 evidence manifest](evidence/followup/2026-10-29-github-actions-3eac808.json); payloads were not copied into documentation. The requester will complete manual WCAG review; no staging environment is available. Backend runtime code did not change in this test-focused follow-up.

## Previous exact-source CI result — `c766be3` — 29/10/2026

All three GitHub Actions workflows passed on commit `c766be3c79266b5a214c680175a348dc11c6917d`: [quality, DAST, mutation and Compose run 40797609007](https://github.com/mahTuqn/DGKD_GK/actions/runs/40797609007), [Firefox/WebKit smoke 40797609261](https://github.com/mahTuqn/DGKD_GK/actions/runs/40797609261), and [15-minute worker soak 40797609052](https://github.com/mahTuqn/DGKD_GK/actions/runs/40797609052). Traceability passed at **92 cases / 26 requirements**. Quality/API, TC-PLAN-01’s 100-request same-seat race (1 success/99 conflicts within one Express process), live expiry, five-minute worker soak/restart, build, Chromium desktop/Pixel 7, Compose browser, domain coverage/mutation, Firefox/WebKit and the 15-minute worker soak/restart/catch-up all passed.

The worker job ran for 950 seconds and verified graceful restart and catch-up of a pending event. The current DAST artifact was downloaded, digest-verified and reviewed: 0 High/Medium, one Low alert record with 3 instances, and 5 Informational records with 12 instances. The Low finding is the triaged `SEC-OBS-01` JSON markup observation; the Admin UI regression passes, but other JSON consumers still need context-appropriate output encoding. Artifact details and digests are in the [c766be3 evidence manifest](evidence/followup/2026-10-29-github-actions-c766be3.json). The requester will complete manual WCAG review; no staging is available.

## Previous exact-source CI result — `6581a76` — 29/10/2026

Runs 40793426096, 40793426250 and 40793426201 passed on commit `6581a76`. Its DAST artifact was also reviewed: it had the same alert records and instances documented for `c766be3`. The later `c766be3` source change only corrects DAST summary counting to distinguish alert records from instances; backend, frontend and browser test sources remain unchanged.

## Previous exact-source CI result — `e28360f` — 29/10/2026

Commit `e28360f2396eeaf07b282d68bdf7ac1d29924745` passed every job in [quality + DAST + Compose run 40790766510](https://github.com/mahTuqn/DGKD_GK/actions/runs/40790766510). Traceability passed at **92 cases / 26 requirements**; API integration, live HTTP expiry, two-worker five-minute soak/restart, build, Chromium desktop/Pixel 7, Compose full-stack/browser smoke, domain coverage/mutation and the configured DAST High-alert gate all passed. TC-SEC-27 and TC-SEC-28 verify the login rate limit counts direct and proxied API requests despite changing forged `X-Forwarded-For` headers. Mutation score was **82.89% (155 killed/32 survived)** against the 70% gate.

The workflow generated current-run artifacts; names, sizes, digests and non-measured scope are in the [e28360f evidence manifest](evidence/followup/2026-10-29-github-actions-e28360f.json). Detailed DAST alerts and severity counts were not independently reviewed, so no zero-finding claim is made. The Firefox/WebKit smoke from run 40784545596 remains relevant because these follow-up commits only change tests and documentation, not application implementation.

TC-SEC-28 passed 11 requests through the built web Nginx image to the API, proving caller-supplied forwarded addresses do not bypass the limiter in the configured one-hop Compose path. The separate 15-minute worker soak on this exact source also passed as run 40790766454. Manual WCAG review remains with the requester; no staging environment is available.

## Previous exact-source CI result — `b84ba70` — 29/10/2026

Commit `b84ba704398a91d12cdca9abfd0657d40cadefc0` passed all jobs in [quality + DAST run 40784545588](https://github.com/mahTuqn/DGKD_GK/actions/runs/40784545588); [cross-browser run 40784545596](https://github.com/mahTuqn/DGKD_GK/actions/runs/40784545596) also passed. Traceability passed at **90 cases/26 requirements**. The API/browser quality job, full Compose runtime/browser smoke, domain coverage/mutation, DAST gate, Firefox and WebKit smoke all passed.

The Chromium desktop/Pixel 7 browser suite passed 24 cases (48 configured executions), including TC-E2E-24–26 for stacked modal semantics, Staff scan success/error accessibility and the payment-success dialog. API integration passed TC-CAT-06 and TC-SEC-22–26 for inactive-cinema creation, concurrent webhook idempotency, catalog BOPLA, Admin authorization transitions, exact response allowlist and malformed/unknown QR denials. TC-OPS-01 built and seeded the full isolated Compose stack, verified API/worker/web health and completed a Chromium registration, hold, order, demo-payment and ticket journey through the current web image.

The DAST job passed its configured High-alert gate, and the workflow generated a severity-count summary that omits alert names, URLs and payloads. This report does not claim a severity breakdown because the detailed findings were not independently reviewed. Artifact ids, sizes and digests are recorded in the [current evidence manifest](evidence/followup/2026-10-29-github-actions-b84ba70.json).

Manual WCAG 2.2 AA/screen-reader checks remain with the requester. No staging environment is available, so named-staging performance is not measured; production recovery/PITR/RPO/RTO and exhaustive ASVS/BOLA review remain open. This run does not certify production readiness or real-gateway/refund behavior.

## Previous exact-head CI result — `8b1fc83` — 29/10/2026

Source commit `8b1fc83c5e8f6c4a20b8106a9633e25515c25d83` was tested in clean GitHub Actions checkouts. [Quality + DAST run 40780057457](https://github.com/mahTuqn/DGKD_GK/actions/runs/40780057457), [cross-browser smoke 40780057484](https://github.com/mahTuqn/DGKD_GK/actions/runs/40780057484), and [15-minute worker soak 40780057400](https://github.com/mahTuqn/DGKD_GK/actions/runs/40780057400) completed successfully. The quality job passed secret/dependency scans, OpenAPI lint, traceability (80 cases/25 requirements), API integration, live five-minute hold expiry, five-minute worker soak/restart, build and Chromium Playwright. The new Compose worker-health smoke and TC-WORKER-08 passed. The browser config contains 24 cases across seven files and runs them in Chromium desktop and Pixel 7 emulation; the unfiltered browser step passed. DAST, domain coverage, and mutation passed; Stryker scored **82.89% (155 killed/32 survived)** against the 70% threshold. Firefox/WebKit smoke covered three critical cases on both desktop engines. DAST report contents were not reviewed, so no severity counts are claimed. See [exact-head evidence manifest](evidence/followup/2026-10-29-github-actions-8b1fc83.json), which includes run artifact sizes and digests.

The browser and API regressions include inactive-cinema availability (TC-CAT-05), non-Customer booking/payment denial (TC-SEC-21), deployment-mode secret checks (TC-SEC-13), simultaneous QR submissions from two Staff pages (TC-E2E-23), and worker readiness/container health (TC-WORKER-08). Their containing quality/browser/Compose steps passed. The DAST job passed, but this run's detailed findings artifact was not inspected, so no finding count is attributed to this commit.

Earlier exact-head reports on commits `beee211`, `bbc1b9b` and `b202848` are historical and do not replace this latest status. The requester will perform the manual WCAG 2.2 AA/screen-reader checklist. No staging environment is available, so performance on named staging is not measured (existing k6 results are only a local Docker baseline); production behavior and backup/PITR/RPO/RTO/restore and exhaustive ASVS/BOLA review remain unmeasured. Firefox/WebKit desktop smoke passed; physical devices and mobile engines other than Chromium Pixel 7 remain unmeasured. Real gateway/refund testing is outside the SRS, which specifies mock payment.

An earlier run on parent commit `36fbac5` stopped at Gitleaks because two public SHA-256 report checksums were classified as generic API keys. These exact two fingerprints are allowlisted in `.gitleaksignore`; a local pinned full-history scan then passed, and run 40749428850 passed Gitleaks. The findings were checksums only, not credentials.

The requester will perform the manual WCAG 2.2 AA/screen-reader checklist. No staging environment is available, so performance on named staging is not measured (existing k6 results are only a local Docker baseline); production behavior and backup/PITR/RPO/RTO/restore, exhaustive ASVS/BOLA review and reliability beyond 15 minutes remain unmeasured. Firefox and WebKit desktop smoke has passed; physical devices and mobile engines other than Chromium Pixel 7 remain unmeasured. Real gateway/refund testing is outside the SRS, which specifies mock payment.

Phạm vi bao gồm browser recovery khi payment đã commit nhưng response bị mất, retry idempotent một order/one ticket; API ownership/mass-assignment cases; Customer denial trên đủ 18 route Admin; và Staff chuyển Cinema A→B với token cũ bị thu hồi, quyền check-in chỉ chuyển sang rạp mới. Đây là mock payment và kiểm thử tự động trong các scope đã nêu, không phải chứng nhận cổng thanh toán thật, WCAG hay security toàn diện.

## Automated coverage follow-up — `b84ba70`

Traceability passes for 90 test cases across 26 requirements. Browser accessibility checks cover the guest-login modal stacked over seat selection, Staff scan success/error announcements, and the payment-success/QR dialog. API regressions cover concurrent identical signed webhooks, inactive-cinema auditorium creation, catalog/seat BOPLA, Admin self-demotion and inactive-cinema assignment, exact Admin-user response fields, and malformed/unknown QR scans. These cases pass in current-source CI.

CI has a dedicated current-source Compose/browser job for PostgreSQL, migrations, API, worker, and web images plus a seeded Chromium booking journey against the web container. DAST severity-count summarization is active; its counts were not independently reviewed for this report. User-owned manual WCAG review, external staging, production recovery/RPO/RTO, and full ASVS/BOLA review remain open.

## Frozen baseline — commit `2be2d911c635cbdbe810bd4f77eca71b73928d1f`

Các số liệu trong bảng dưới đây thuộc commit frozen baseline và clean clone của commit đó. Chúng không bao gồm các thay đổi worker/Docker/browser bổ sung sau này.

| Cổng | Kết quả | Phạm vi/evidence |
|---|---|---|
| API, unit và PostgreSQL integration | Đạt: 17/17 trên 4 Vitest files | `npm test`; gồm API auth/RBAC/profile, concurrency 100 request, expiry/late webhook, order retry/payment, schedule buffer, Staff cinema scope, database uniqueness và callback idempotency |
| Browser E2E | Đạt: 24/24 | 12 case × Chromium desktop + Pixel 7; gồm `TC-E2E-11` kiểm tra markup do Admin nhập được render như text; report `reports/generated/playwright-results.json` |
| Accessibility | Đạt trong scope tự động | Lượt local mới nhất axe pass ở discovery, login dialog, seat map, checkout, ticket và Admin; keyboard/focus đến checkout pass; manual WCAG/screen-reader review còn thiếu |
| Build | Đạt | `npm run build`; backend TypeScript/Prisma và frontend TypeScript/Vite; log `reports/generated/final-build-results.log` |
| OpenAPI lint/CI | Đạt theo lần chạy cuối của nhóm | `npm run lint:openapi`; Redocly không có warning; gate đã được thêm vào CI. Lint kiểm tra tài liệu/schema, không thay thế contract test runtime trên toàn bộ endpoint |
| CI workflow configuration | CI run trên `22e5fca` failed; fixes đang chờ xác nhận ở run kế tiếp | `ci.yml` chạy Gitleaks v8.30.1, audit, OpenAPI/traceability, API/browser/build gates và DAST trong job Docker 60 phút riêng; run đầu thất bại ở assertion do test file chạy song song trên cùng DB và quyền ghi report của ZAP. |
| Coverage | Đạt | Domain 100% lines (35/35), branches (47/47), functions (14/14); 13 test domain; ngưỡng 90% line/80% branch |
| Mutation | Đạt | Stryker 81.82%, 153 killed, 34 survived, 0 timeout/error; ngưỡng 70% |
| Performance | Đạt trên local baseline, chưa phải staging | k6 50 VU/5 phút; showtime p95 27.57ms, hold p95 349.70ms, unexpected error 0%; ngưỡng lần lượt ≤500ms, ≤800ms, <1% |
| Security scan | Historical reports có kết quả; authenticated gate chưa xác minh | ZAP unauth API: H/M/L 0, Info 1; report auth cũ: H/M 0, Low 1 (confidence thấp), Info 1; built preview: H/M/L 0, Info 1. Authenticated config cũ thiếu auth method/user/header nên không chứng minh request đã đăng nhập; cần rerun. Chi tiết ở `docs/05-bug-reports.md` |
| Dependency audit | Đạt | `npm audit --audit-level=moderate`: 0 vulnerabilities |
| Backup/restore rehearsal | Đạt: 27/10/2026 13:55 +07 | PostgreSQL 17 custom dump, restore vào UTF8 database từ `template0`; verify cinema=8, movie=3, user=153, showtime=4; artifact `reports/generated/recovery/restore-rehearsal.json` |
| Traceability | Đạt: 40 test cases/24 requirements | `npm run qa:trace` PASS. Validator kiểm tra test ID markers trên source `.ts/.js/.mjs/.yaml/.yml`, hỗ trợ prefix `Automated`; marker trong hai ZAP config được resolve |
| Start smoke | Đạt | Khởi chạy production backend bằng `npm start --workspace backend` và xác nhận health; log `reports/generated/start-smoke.log` |
| Secret scan | Đạt trong local scan scope | `npm run scan:secrets` bằng Gitleaks v8.30.1: 1 commit, ~706 KB, không có leak; log/JSON ở `reports/generated/final-gitleaks-results.log` và `final-gitleaks.json` |
| Frozen clean-clone verification | Đạt | Commit `2be2d911c635cbdbe810bd4f77eca71b73928d1f`; clone sạch chạy install, DB generate/deploy/seed, secret scan, OpenAPI lint, traceability 40/24, API 17/17, build, browser 24/24, coverage 100% và mutation 81.82%; log ở `reports/generated/clean-clone/` |

Các phép đo unit/coverage, hiệu năng, ZAP và Gitleaks dùng fixture/history local. Không suy rộng thành chứng nhận staging hoặc production. Traceability pass với 40 test cases/24 requirements sau khi validator quét marker trên source TypeScript/JavaScript/YAML, hỗ trợ prefix `Automated`. Manifest ghi nhận commit đã kiểm tra, kết quả clone sạch và SHA-256 cho các artifact được liệt kê. GitHub Actions workflow đã được cấu hình nhưng chưa có remote run.

## Test đã triển khai

- Browser tự động theo push/PR: 24 E2E case trên Chromium desktop và Pixel 7; CI còn chạy 3 luồng trọng yếu trên Firefox và WebKit desktop. Full Compose smoke kiểm tra hành trình đăng ký, hold, order, demo payment và ticket qua Nginx.
- HTTP/PostgreSQL integration: auth/RBAC/profile, schedule overlap/buffer, hold limit/race/expiry, price snapshot/order retry, payment idempotency/late callback/revenue, Admin/Staff scope; TC-PLAN-01 chạy 100 HTTP request cùng ghế trong một Express process và xác nhận 1 success/99 conflict. TC-PLAN-08 bổ sung race qua hai process; CI đang chờ chạy.
- Domain: 13 test; timezone, deadline, pricing, unique seat IDs, occupancy/input boundaries và bốn fixed-seed property tests; mutation threshold 70% đạt trong CI.
- Reliability: live 5-minute hold expiry, two-worker five-minute soak/restart và two-worker 15-minute soak/graceful restart/catch-up đều pass trong CI.
- Performance: k6 50 virtual users trong năm phút đạt trên Docker local; đây không phải staging/production benchmark.
- Security: exact-source ZAP unauthenticated API, authenticated API và production preview đều được parse/review; không có High/Medium trong ba scan, nhưng còn một Low-confidence JSON markup observation (`SEC-OBS-01`). Source route matrix và automated checks chưa thay thế exhaustive ASVS/API Top 10/BOLA review.
- Backup/restore: PostgreSQL custom-format dump được khôi phục vào UTF8 database rồi kiểm tra counts; rehearsal không chứng minh backup schedule/PITR/RPO/RTO/production restore.

## Lỗi đã sửa và quan sát bảo mật

- `BUG-001` — Payment success làm mất modal khi `hold=null`; đã sửa và retest browser flow.
- `BUG-002` — Axe tìm accessible name không khớp nội dung ở logo/áp phích; đã sửa, axe không còn serious/critical ở các màn đã quét.
- `BUG-003` — CSP chặn React Refresh inline preamble trong Vite dev; đã giới hạn CSP vào built preview và chuyển E2E header check sang preview. Retest browser suite đạt 24/24.
- `SEC-OBS-01` — Current exact-source authenticated ZAP uses seeded Admin preflight and reports a Low/Low-confidence persistent markup alert in JSON fields `name`, `address`, and `city`. `TC-E2E-11` confirms the tested Admin UI renders input as text and creates no `img/script/svg` nodes. This does not close other JSON consumer contexts.

## Còn thiếu so với kế hoạch

- Người yêu cầu chưa hoàn tất manual WCAG 2.2 AA/screen-reader/contrast/zoom/reflow/orientation/keyboard checklist.
- Chưa có staging; k6 local không chứng minh performance staging/production. TC-PLAN-08 đã được triển khai cho API contention giữa hai process/replica, nhưng chưa có kết quả CI; không thay thế load test trên staging.
- DAST đã được xác minh và triaged, nhưng exhaustive ASVS/API Top 10 và adversarial BOLA/IDOR review rộng hơn route matrix còn mở.
- Restore rehearsal không đánh giá lịch backup, PITR, RPO/RTO hay production restore. Worker reliability dài hơn 15 phút và gateway timeout chưa được đo.
- Không có hazard analysis; safety chưa đánh giá. Payment vẫn là mock, không phải cổng thanh toán thật.

## Follow-up trên working tree — 27/10/2026

| Cổng bổ sung | Kết quả mới nhất | Phạm vi/evidence |
|---|---|---|
| API/PostgreSQL integration | Đạt: 20/20 trên 6 Vitest files | `reports/generated/followup-api-docker.log`; gồm ma trận BOLA ownership và worker/outbox tests |
| Browser E2E trên Docker | Đạt: 28/28 | `reports/generated/followup-browser-docker-rerun.log`; 14 case × Chromium desktop + Pixel 7, có payment failure và lost-seat conflict |
| Traceability | Đạt: 45 test cases/25 requirements | `reports/generated/followup-traceability.log`; mọi marker và liên kết RTM đã được kiểm tra |
| Docker demo | Đạt: PostgreSQL, API, web và worker đang chạy | Web `http://localhost:8080`, API `/api/health`, PostgreSQL port 5434; QA stack dùng port 8081/5435 và volume riêng |
| Worker/outbox | Đạt integration và Docker smoke | Worker hết hạn hold/đơn chờ idempotently; service expiry và catch-up sau restart được kiểm tra; callback late success tạo payment reconciliation status và một hồ sơ `OPEN`; log tại `reports/generated/followup-worker-smoke.log` và `followup-worker-restart-smoke.log` |
| Build/OpenAPI/dependency audit | Đạt | `reports/generated/followup-build.log`, `followup-openapi.log`, `followup-audit.log`; build pass, Redocly không warning, 0 dependency vulnerabilities |
| Domain coverage | Đạt: 100% | `reports/generated/followup-coverage.log`; 35/35 lines, 47/47 branches, 14/14 functions |
| Mutation | Đạt: 81.82% | `reports/generated/followup-mutation.log`; 153 killed, 34 survived, 0 timeout/error; threshold 70% |
| Performance trên Docker QA | Đạt local: 50 VU/5 phút | Showtime p95 9.85ms, hold p95 265.35ms, unexpected errors 0%, 50/50 holds; `reports/generated/k6/followup-20261027-metadata.json`; chưa phải staging |
| Backup/restore với migrations mới | Đạt | PostgreSQL 17 custom-format dump → restore database UTF8; Cinema/Movie/User/Showtime/OutboxEvent/ReconciliationCase counts khớp; `reports/generated/recovery/followup-20261027.json` |

Tại thời điểm snapshot 27/10, clean clone và scan history trên delta mới còn chờ. Worker restart được kiểm tra một lần; soak/multi-instance chưa chạy. Các xác nhận mới hơn được ghi ở mục dưới.

## Xác nhận clean clone follow-up — 28/10/2026

| Cổng | Kết quả | Phạm vi/evidence |
|---|---|---|
| Commit được xác nhận | `5ae4c2b7b25e5e5b6b4d80c675fc190763743125` | Nhánh `codex/phase8-clean-clone`; clean clone độc lập tại `reports/generated/clean-clone/followup-5ae4c2b` |
| Cài dependencies và Docker | Đạt | `npm ci`: 464 packages, 0 vulnerabilities; Docker build, 4 migrations và seed đạt; PostgreSQL/API/web/worker đều healthy; `reports/generated/clean-clone-followup-5ae4c2b-compose-ps.log` và `clean-clone-followup-5ae4c2b-health.log` |
| API/PostgreSQL và browser E2E | Đạt: 20/20 và 28/28 | `reports/generated/clean-clone-followup-5ae4c2b-test.log`; 14 case trên Chromium desktop và Pixel 7 mobile |
| Build/OpenAPI/traceability/audit | Đạt | Logs `reports/generated/clean-clone-followup-5ae4c2b-build.log`, `clean-clone-followup-5ae4c2b-openapi.log`, `clean-clone-followup-5ae4c2b-trace.log`, `clean-clone-followup-5ae4c2b-audit.log`; trace 45/25, audit 0 vulnerabilities |
| Gitleaks history scan | Đạt | Gitleaks v8.30.1 quét 5 commits, không phát hiện leak; `reports/generated/final-gitleaks.json` |
| Hash manifest | Đạt | [Follow-up manifest](evidence/followup/2026-10-28-manifest.json) liệt kê SHA-256 của 20 artifact logs/reports |

Đây là kiểm chứng local cho commit đã nêu. ZAP chưa chạy lại trên delta mới; audit cho thấy authenticated plan cũ thiếu cấu hình auth nên report authenticated lịch sử chưa xác nhận trạng thái đăng nhập. Worker soak/multi-instance, staging/production, manual WCAG review, backup schedule/PITR/RPO/RTO, gateway thật và exhaustive ASVS/BOLA review chưa được thực hiện.

## Rerun working tree với PostgreSQL tạm — 28/10/2026

Trên working tree sau commit baseline `b03c99a917d5fd328dd08744fdd81bde2f7265ca`, `npm test` đạt API 21/21 trên 6 Vitest files và Playwright 28/28 (14 case × Chromium desktop + Pixel 7 mobile), không flaky/skip. Cluster PostgreSQL 17.11 mới được tạo riêng và bind loopback tại port 55432; không dùng Docker hoặc database của PostgreSQL service hiện hữu. Bổ sung `TC-WORKER-03` kiểm tra biên expiry chính xác: hold hết hạn tại `boundaryAt`, còn hiệu lực tại `boundaryAt + 1 ms`. Axe pass ở discovery, login dialog, seat map, checkout, ticket và Admin; title của QR SVG đã được bổ sung để sửa lỗi axe. `npm run build`, `npm run qa:trace` (46 test cases/25 requirements), kiểm tra cú pháp DAST runner và `git diff --check` đều đạt. Chi tiết lệnh, môi trường, thời lượng, artifact hash và giới hạn ở [rerun manifest](evidence/followup/2026-10-28-local-postgres-rerun.json). Đây không phải Docker/clean-clone/ZAP run.

## Trạng thái Docker Desktop — 28/10/2026

Trong lần thử chạy lại ZAP trên QA, active scan bị treo; sau khi dừng, Docker Desktop không khởi động lại được và báo Windows error 1920 khi mở các AF_UNIX socket tại `%LOCALAPPDATA%\Docker\run\sailor-ingest.sock` và `%LOCALAPPDATA%\docker-secrets-engine\engine.sock`. Engine hiện dừng, PostgreSQL port 5434 không lắng nghe nên trạng thái database demo chưa thể xác minh. Docker data disk VHDX còn tồn tại; không có lệnh xóa volume hoặc factory reset chạy. Các lần test pass ở trên vẫn là evidence hợp lệ tại thời điểm ghi trong manifest, nhưng không chứng minh container đang chạy sau sự cố.

## Expanded final local rerun — 28/10/2026

Sau khi bổ sung E2E-14/15, TC-WORKER-04 và keyboard assertions cho E2E-02, full suite trên working tree đạt API 22/22 (6 Vitest files) và browser 32/32 (16 case × Chromium desktop + Pixel 7 mobile), không fail/skip/flaky. Trong quá trình mở rộng, axe tìm thấy `label-content-name-mismatch` trên poster fallback do Admin tạo; BUG-004 đã được sửa bằng tên nút lấy từ nội dung poster hiển thị. TC-E2E-02/08 và keyboard focus assertions đạt trên cả hai project; axe trong full suite pass discovery, login, seat map, checkout, ticket, Admin. TC-WORKER-03 kiểm tra expiry đúng tại deadline và còn hiệu lực tại +1 ms; TC-WORKER-04 xử lý đồng thời qua hai Prisma client và xác nhận event/case chỉ xuất hiện một lần.

Build, OpenAPI lint và traceability đều đạt; trace 49 test cases/25 requirements. Báo cáo browser JSON và SHA-256 của các log nằm trong [multi-instance local PostgreSQL manifest](evidence/followup/2026-10-28-local-postgres-multi-instance.json). Cluster PostgreSQL tạm chỉ bind `127.0.0.1:55432`; đây không phải Docker/clean-clone/staging run. Docker Desktop còn dừng nên DAST/ZAP và demo DB không được xác minh trong lượt này; remote GitHub Actions, manual WCAG, process-level soak, gateway thật, PITR/RPO/RTO và exhaustive ASVS/BOLA review vẫn mở.

## Process-level worker soak/restart và full rerun — 28/10/2026

TC-WORKER-05 chạy hai worker loop có PID độc lập trong 60 giây trên database riêng `cinema_worker_process_test`, với interval 250ms. Test nạp event ban đầu và thêm sáu event định kỳ; tất cả được `PROCESSED` một lần và tạo đúng một case/event. Hai worker dừng graceful; sau đó test nạp event mới và khởi chạy worker thay thế, xác nhận event được bắt kịp và process thoát mã 0. Đây là soak/restart rehearsal local có thời lượng 60 giây; chưa chứng minh tải dài hạn, crash cưỡng bức, HA hay production reliability.

Full `npm test` sau thay đổi soak/restart đạt API 22/22 trên 6 files, TC-WORKER-05 1/1 và browser 32/32 (16 case × Chromium desktop/Pixel 7 mobile), không fail/skip/flaky. Build, OpenAPI lint và traceability 50 test cases/25 requirements đã đạt; workflow CI parse được và đã cấu hình tạo DB process riêng, migrate rồi chạy soak sau API suite. Manifest và SHA-256 nằm trong [worker process manifest](evidence/followup/2026-10-28-local-postgres-worker-process.json). Kết quả local không phải remote Actions hay Docker. Docker Desktop vẫn dừng nên DAST/ZAP chưa chạy; prolonged production soak, manual WCAG/screen-reader, staging/production, gateway/refund thật, PITR/RPO/RTO và exhaustive ASVS/BOLA vẫn còn mở.

## Live hold-expiry, accessibility states và full regression — 28/10/2026

`TC-WORKER-03` live HTTP rehearsal tạo hold TTL đúng 300 giây trên database riêng. Trước deadline, hold vẫn `HELD`, seat map hiện ghế đang giữ và Customer thứ hai nhận 409. Sau deadline, worker thực sự ghi `SeatHold=EXPIRED`, xóa liên kết và expiry trên `SeatClaim`, ghi đúng một `SEAT_HOLD_EXPIRED` audit; seat map trả `AVAILABLE`, rồi Customer thứ hai giữ cùng ghế thành công. Test đạt 1/1 trong 301.60 giây; đây là local timing rehearsal, không phải prolonged production soak.

Accessibility suite thêm TC-E2E-16/17/18: trường và validation đăng ký, thông báo live alert cho email trùng/đăng nhập sai, accessible names của Admin movie/auditorium/seat details và axe trên dialog/Admin. Qua đó phát hiện nội dung `humanError()` gán mọi 409 cho xung đột ghế và mọi 401 cho phiên hết hạn. Đã sửa server trả mã `EMAIL_TAKEN` cho unique conflict khi đăng ký và frontend chọn copy theo mã lỗi; API integration cùng browser assertions kiểm tra nội dung mới.

Full `npm test` mới nhất trên PostgreSQL 17.11 biệt lập đạt API **25/25 trên 7 Vitest files**, worker process soak/restart **1/1**, browser **40/40** (20 case × Chromium desktop/Pixel 7 mobile), không fail/skip/flaky. Traceability đạt **57/25**. `TC-WORKER-03` live HTTP test riêng đạt **1/1 trong 301.60 giây**: trước hạn ghế vẫn HELD/409; sau worker sweep hold và claim EXPIRED, có đúng một audit, seat map AVAILABLE và khách thứ hai giữ được ghế. Build, OpenAPI, CI YAML và diff checks đều pass; manifest regression liệt kê log và SHA-256.

Gitleaks v8.30.1 quét 7 commit và 18 mục mã nguồn/cấu hình/tài liệu trong working tree, không phát hiện leak. Quét toàn thư mục ban đầu chỉ tìm thấy 198 JWT-rule matches trong ba báo cáo kiểm thử thuộc `reports/generated` (được Git ignore); phạm vi và kết quả đã ghi ở [Gitleaks evidence](evidence/followup/2026-10-28-gitleaks-current-working-tree.json) và current regression manifest.

Sau khi mở rộng `TC-E2E-11`, full `npm test` rerun đạt API 25/25 trên 7 files, worker-process 1/1 và browser 40/40 desktop/mobile, không fail/skip/flaky.

Native ZAP 2.17.0 đã chạy đủ ba scope trên working tree bằng PostgreSQL tạm riêng và built Vite preview. API unauthenticated xác nhận 401; authenticated Admin xác nhận 200 và chạy active scan với hostname-only filter; Vite preview spider tìm 13 URL. Không có High/Medium; authenticated report có một cảnh báo Low-confidence/Low-risk về `name/city/address` được trả lại trong JSON. `TC-E2E-11` mở rộng kiểm tra cả ba trường hiển thị như text, không tạo DOM node `img/script/svg`, đạt 2/2 desktop/mobile và full suite pass. Preview có một informational false positive do chuỗi `http://www.w3.org/2000/svg` trong JS minified. ZAP requestor check cũng phát hiện và sửa lỗi `api:4000` không khớp hostname-only filter trong runner. Evidence là [native ZAP DAST report summary](evidence/followup/2026-10-28-native-zap-dast.json).

At this historical native-scan snapshot, Docker Desktop was stopped, so Compose DAST and remote Actions had not yet been verified. Docker later recovered and exact-head Compose DAST/Actions passed; see the current result at the top of this report. Native local scan still does not prove the named staging/production environment. Manual WCAG/screen-reader, staging performance, production backup/PITR/RPO/RTO, and exhaustive ASVS/BOLA remain open.

## Focused authorization follow-up — 28/10/2026

Thêm `TC-SEC-07` cho trường hợp Customer B gửi `holdId` thuộc Customer A vào `POST /api/orders`. Test xác nhận `404 HOLD_NOT_FOUND`, không trả dữ liệu order và không làm đổi hold, order, payment, claim hoặc audit. Ở snapshot ban đầu, focused authorization suite đạt 6/6 trên ba file; một lần chạy narrow suite sau đó đạt 8/8. Cả hai kết quả đều có trước ma trận mở rộng hiện tại và không phải exhaustive BOLA/IDOR review.

## Full rerun sau team follow-up — 28/10/2026

Sau khi bổ sung `TC-SEC-07`, mở rộng `TC-E2E-15` để sửa tên phòng và kiểm tra persistence, đồng thời thêm Enter/Tab/focus-outline assertions cho Admin disclosure trong `TC-E2E-18`, full `npm test` đạt **API 26/26 trên 7 files, worker-process 1/1, browser 40/40** trên Chromium desktop và Pixel 7 mobile, không fail/skip/flaky. Traceability tại snapshot đó là **58/25**; một focused authorization suite hẹp hơn đạt 8/8 trong lượt riêng, TC-E2E-15 2/2 và TC-E2E-18 2/2. PostgreSQL 17.11 chạy trong database cluster tạm biệt lập `127.0.0.1:55434`; không dùng Docker hay PostgreSQL service. Full test log và Playwright JSON được tạo lại trong `reports/generated/`. Kết quả authorization 8/8 là của suite trước ma trận role/object/cinema mở rộng hiện tại.

At this earlier snapshot, Docker Desktop could not start because Windows returned error 1920 for `%LOCALAPPDATA%\Docker\run\sailor-ingest.sock`; no volume was removed/reset. The runtime later recovered (see the next dated section) and remote Actions/DAST later passed on exact HEAD. See the historical [Docker Desktop blocker evidence](evidence/followup/2026-10-28-docker-desktop-blocker.json). Manual WCAG/screen-reader, staging/production, prolonged reliability beyond five minutes, PITR/RPO/RTO and exhaustive ASVS/BOLA remain unverified.

## Docker runtime recovery and browser run using Docker PostgreSQL — 28/10/2026

Docker Desktop 4.88.0 / Engine 29.7.2 đã lên lại sau khi thư mục socket lỗi được đổi tên và giữ nguyên dưới `%LOCALAPPDATA%\Docker\run.codex-preserved-20261028-01`. `dgkd_gk` demo và `cinema-qa` QA stack hiện chạy; PostgreSQL healthy ở `localhost:5434` và `localhost:5435`, web healthcheck pass ở cổng 8080/8081. Database demo query được (1 cinema, 3 movies, 3 users, 4 showtimes). VHDX, volumes và PostgreSQL service của máy không bị xóa/dừng.

Đã tạo database test riêng trong `cinema-qa-postgres-1`, chạy migrations và seed (cả hai exit 0), rồi chạy Playwright với API/frontend current working tree trên host và PostgreSQL trong Docker. Kết quả **40/40 pass**, không fail/skip/flaky, exit 0; database tạm được drop sau test. Report: `reports/generated/docker-db-local-app-playwright-results.json`; hashes và scope ở [Docker recovery evidence](evidence/followup/2026-10-28-docker-runtime-recovery-browser.json). Đây chưa kiểm tra image API/web hoặc Nginx mới.

At that local Docker snapshot, Compose DAST had not run because the pinned ZAP image was absent and C: had only about 0.15 GB free. The later GitHub Actions exact-head run passed all three Compose DAST scopes. Manual WCAG/screen-reader, named staging performance, production operations, backup/PITR/RPO/RTO, and exhaustive ASVS/BOLA remain open.

## Docker Compose DAST interruption and current runtime state — 28/10/2026

Sau khi giải phóng dung lượng và dùng ZAP image local theo digest, Compose DAST đã build image API/seed riêng, migrate/seed thành công, import 35 URL từ OpenAPI và bắt đầu active scan. Không có report pass: Docker Engine trả HTTP 500 ở API `/containers/json`; dừng scan tạm vì host còn 0.44 GB RAM khả dụng và hai web port bắt đầu timeout. Cleanup của project DAST cũng không hoàn tất; runner được đặt `DAST_KEEP_VOLUMES=1`, không gọi `down --volumes`. Trạng thái resource test tạm chưa thể kiểm kê khi Engine lỗi.

Thử `docker desktop restart` thất bại do các tiến trình còn chạy và `context deadline exceeded`. `docker desktop start --detach` được nhận, nhưng lần kiểm tra mới nhất cho thấy WSL distro `docker-desktop` và service `com.docker.service` vẫn `Stopped`; hai port 8080/8081 không kết nối được. Start-Service bị từ chối do phiên hiện tại không có quyền điều khiển service. Windows PostgreSQL `postgresql-x64-17` vẫn `Running`; không xóa/reset volume, factory reset hoặc sửa VHDX. Bằng chứng hiện trạng: [Docker Engine/DAST interruption](evidence/followup/2026-10-28-docker-engine-dast-interruption.json); log: `reports/generated/docker-compose-dast-20261028.log`.

Docker container/image gates tạm thời chưa xác minh được. Sau khi Docker Engine phản hồi lại, `npm run scan:secrets` chạy bằng image v8.30.1 đã pin, quét 7 commit (~830 KB), 0 finding, exit 0. Current working tree cũng pass standalone Gitleaks v8.30.1 đã xác minh checksum trên 25 target source/config/docs, 0 finding. Hai scan này có scope riêng; current-tree scan loại `.git` và `reports/generated`. Evidence: [Gitleaks current-tree/history scans](evidence/followup/2026-10-28-gitleaks-current-working-tree.json). Remote GitHub Actions, manual WCAG/screen-reader, staging/production, gateway/refund thật, prolonged soak, PITR/RPO/RTO và exhaustive ASVS/BOLA vẫn mở.

## Extended worker process soak gate — 28/10/2026

Đã thêm cổng local opt-in TC-WORKER-06: `npm run test:worker-soak` chạy hai worker process trong 300 giây, chèn event mỗi 10 giây, kiểm tra từng event được xử lý một lần, graceful shutdown và worker mới bắt kịp event pending sau restart. Local gate chưa chạy vì máy thiếu RAM và chưa có URL database soak riêng. Bài CI tương đương đã đạt trên PostgreSQL database cô lập ở run [`40674582910`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40674582910), trong 306.17 giây. Kết quả đó không phải bằng chứng cho staging/production.

## Expanded authorization matrix — historical focused run — 28/10/2026

Current working-tree tests expand the earlier narrow suite with Guest 401 checks for all 27 `requireAuth` routes; Customer and Staff denial across all 18 Admin routes using valid mutation payloads and fixture/audit snapshots; added foreign-order reads and fuller booking/payment side-effect snapshots; and Guest, Customer, wrong-cinema Staff, and unassigned Staff denial assertions for both ticket-ID and QR check-in. RTM/test-case links are recorded under TC-SEC-08 through TC-SEC-11.

The earlier expanded authorization suite passed **7/7 tests across three files** on a loopback-only PostgreSQL cluster at port 55436. That result is historical; the updated current result is recorded below. The temporary server is stopped and verified offline; cleanup of its task-created directory was blocked by environment policy, so `E:\DGKDPM\_codex-authz-20261028-01` remains. The installed Windows PostgreSQL service and Docker databases were not used by that run.

## Authorization route source review and token revocation fix — 28/10/2026

A source review enumerated all **35 Express routes** in `backend/src/app.ts`: 27 require authentication and 18 are Admin-only. It found no missing route-level auth/owner/cinema guard, but did find that OpenAPI promised role changes would invalidate the current token while `requireAuth` ignored the already-maintained `authVersion`. I updated JWT creation and validation to bind each token to the account's current version; role or Staff cinema-assignment changes now invalidate existing tokens. The review also found no positive functional tests for Admin user listing or role updates. Details: [authorization route source review](evidence/followup/2026-10-28-authorization-route-source-review.json).

The source review found a contract mismatch: OpenAPI states role changes invalidate the existing token, but the original middleware ignored `authVersion`. JWT creation and authentication now carry/compare this database version, so both role and Staff cinema-assignment changes invalidate stale tokens. The source review's runtime verification is recorded below. It does not close exhaustive ASVS/BOLA, manual accessibility, staging, or production gates.

## Trạng thái mới nhất sau authVersion hardening — 28/10/2026

- Focused authorization: **8/8** trên 3 files; bao gồm Admin user listing/role update, old-token rejection, refreshed role, và invalidation khi gán/bỏ gán cinema cho Staff. Log `reports/generated/authorization-matrix-20261028.log`; chi tiết tại [authorization evidence](evidence/followup/2026-10-28-local-postgres-authorization-matrix.json).
- API integration: **28/28** trên 7 files, log `reports/generated/authversion-api-suite-20261028.log`.
- Browser: **40/40**, không fail/skip/flaky, trên Chromium desktop và Pixel 7 mobile, log `reports/generated/authversion-playwright-20261028.log`; [browser evidence](evidence/followup/2026-10-28-local-postgres-authversion-browser.json).
- Build backend/frontend, Prisma generate, TypeScript, Vite production build và OpenAPI lint đều pass; traceability **65/25**. Các lượt mới nhất và SHA-256 nằm trong manifest regression.
- Đây chưa phải một lượt `npm test` tổng hợp sau authVersion: worker-process 1/1 là kết quả của full run trước hardening. Five-minute worker soak chưa chạy.
- Docker Engine hiện phản hồi v29.7.2; Compose `dgkd_gk` và `cinema-qa` đang chạy, PostgreSQL healthy ở cổng 5434/5435 và truy vấn read-only trên DB demo xác nhận 16 bảng. Một project DAST cũ đã được dọn container/network bằng đúng tên project; volume của nó được giữ nguyên. DAST chưa chạy lại vì host vẫn dưới ngưỡng khoảng 1.5 GiB RAM trống. Gitleaks pass trên history 7 commit và current tree 25 target, đều 0 finding. Full composite `npm test`, clean-clone verification trên frozen commit hiện tại, remote CI, manual WCAG/screen-reader, staging/production, gateway/refund thật, PITR/RPO/RTO và exhaustive ASVS/BOLA còn mở. Chi tiết: [Docker runtime resume evidence](evidence/followup/2026-10-28-docker-runtime-resume.json).

## Security configuration remediation — 28/10/2026

Static review identified public fixed Compose secrets and a missing trusted-proxy setting for login rate limiting. Compose now requires PostgreSQL/JWT/mock-payment secrets, binds web/PostgreSQL to loopback by default, and configures exactly one Nginx proxy hop. Production API startup rejects missing, short, and published development/CI JWT or mock-payment values.

`npm run env:compose` creates an ignored local `.env` once and refuses to overwrite it or generate a new database password when the current Compose project volume already exists.

TC-SEC-13 configuration tests passed **4/4**; backend TypeScript build passed. `docker compose config --quiet` passed with the local ignored environment; the blank `.env.example` was rejected for missing required secrets. Current-tree Gitleaks v8.30.1 scanned 36 explicit source/config/hand-authored-documentation targets with 0 findings. Evidence and raw logs: [production config security follow-up](evidence/followup/2026-10-28-production-config-security.json). Existing demo/QA containers have not yet been recreated with the new Compose configuration; their PostgreSQL volumes were preserved. Full composite `npm test`, current-image/Compose DAST, five-minute worker soak, remote CI, clean-clone-on-final-commit, manual accessibility review, and staging/production gates remain open.

## GitHub Actions follow-up on commit `5188ab7` — historical run

The first CI run on pushed commit `22e5fca` failed in two jobs. The quality job's API test observed confirmed revenue change while another Vitest file was running against the same test database; the logs also show concurrent unique-key conflicts. The backend test command now serializes files (`--maxWorkers=1 --no-file-parallelism`) so global summary assertions use a stable database state. Quality passed on runs `40667408633`, `40668176058` and `40668789437`, including API, five-minute live hold-expiry, build and browser. DAST first hit report-directory permission errors. Running ZAP under the host UID then stalled before its first report and timed out after 25 minutes because the image could not create/lock user preferences for that UID. The default-user attempts on runs `40672472695` and `40673655646` generated reports but the host runner got `EACCES`; in `40673655646`, host-side `existsSync()` skipped the root helper. Commit `5188ab7` now calls the helper unconditionally and atomically replaces the sanitized report. Run [`40674582910`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40674582910) passed all three Compose DAST scans; see the report artifact and Low finding triage below. Local memory was 461 MiB at the last check, so no heavy local DAST rerun was started.

CI run [`40671406190`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40671406190) passed the quality job but DAST timed out on the older ZAP custom-UID approach. Runs [`40672472695`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40672472695) and [`40673655646`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40673655646) passed quality but failed host-side report access. The full workflow on run [`40674582910`](https://github.com/mahTuqn/DGKD_GK/actions/runs/40674582910) passed both jobs from a clean checkout. Quality passed API **32/32** across 8 files, worker-process TC-WORKER-05 **1/1** in 62.15 seconds, live HTTP expiry TC-WORKER-03 **1/1** in 300.76 seconds, TC-WORKER-06 soak/restart **1/1** in 306.17 seconds, browser **40/40**, OpenAPI lint, traceability **65/25**, and production build. DAST passed unauthenticated API, authenticated API and production web preview, with [three sanitized reports](https://github.com/mahTuqn/DGKD_GK/actions/runs/40674582910/artifacts/12809594145). Unauthenticated API and preview showed only informational alerts. Authenticated API showed one Low (confidence 1) persistent-JSON markup observation on Admin cinema fields; ZAP notes the response is not HTML. E2E-11 confirms the Admin UI renders these values as text, while other JSON consumers still need context-appropriate output encoding. No Critical/High/Medium findings were present.

## Exact-head CI verification — commit `3ec10eb` — 28/10/2026

Run [40680542571](https://github.com/mahTuqn/DGKD_GK/actions/runs/40680542571) passed quality and DAST on the pushed commit. API **32/32**, worker TC-WORKER-05 **1/1** (62.19s), TC-WORKER-03 **1/1** (300.89s), TC-WORKER-06 **1/1** (306.42s), and build/OpenAPI/audit gates passed. Playwright passed **46/46** (no failures, skips or flaky tests); TC-E2E-20, TC-E2E-21 and TC-E2E-22 each passed on desktop and Pixel 7 mobile. Traceability is **68/25**. DAST passed all three scopes; no Critical/High/Medium findings, with one triaged Low-confidence JSON markup observation in the authenticated API report. See [CI evidence manifest](evidence/followup/2026-10-28-github-actions-3ec10eb.json), [browser artifact](https://github.com/mahTuqn/DGKD_GK/actions/runs/40680542571/artifacts/12813541109), and [DAST artifact](https://github.com/mahTuqn/DGKD_GK/actions/runs/40680542571/artifacts/12813440250).
