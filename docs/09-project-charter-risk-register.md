# Project charter và risk register — CinemaBooking

## 1. Charter

**Mục tiêu:** cung cấp một ứng dụng web responsive demo đặt vé cho một cụm rạp, cùng SRS, test tự động, RTM, báo cáo lỗi và evidence có thể tái lập. Ứng dụng hỗ trợ Guest, Customer, Staff và Admin. Bản demo không thu thập thông tin thẻ và không đại diện cho hệ thống thanh toán/rạp đang vận hành thật.

**Giả định kế hoạch gốc:** nhóm 2 người, khoảng 10 tuần, 12–15 giờ/người/tuần; tiền tệ VND; ngày nghiệp vụ `Asia/Ho_Chi_Minh`; môi trường mục tiêu trong kế hoạch là staging. Các thời lượng và ngưỡng ban đầu trong kế hoạch là mục tiêu cần đo/duyệt, không phải kết quả đã đạt.

## 2. Phạm vi

| Mức | Phạm vi | Trạng thái bản demo |
|---|---|---|
| P0 — bắt buộc | Đăng ký/đăng nhập, profile, Customer/Staff/Admin RBAC, ownership đơn/vé, cinema-scoped Staff check-in | Exact application/test source `9001ed7e74203fd61bbf5f790207339622cb2a84`: quality/API and Chromium pass in [40870861147](https://github.com/mahTuqn/DGKD_GK/actions/runs/40870861147); Firefox/WebKit desktop smoke passes in [40870861454](https://github.com/mahTuqn/DGKD_GK/actions/runs/40870861454) |
| P0 — bắt buộc | Danh mục phim/rạp/phòng/ghế/suất; lọc lịch, xem seat map và buffer 20 phút giữa suất cùng phòng | Current-source API/browser CI passes; TC-CAT-06 verifies inactive-cinema auditorium creation is denied without side effects; E2E-22 covers schedule conflict and exact buffer |
| P0 — bắt buộc | Hold 1–8 ghế trong 5 phút; hết hạn và cạnh tranh cùng ghế | Exact-source CI passes API integration, TC-PLAN-01 same-process race, TC-PLAN-08 two-process race (100 requests: 1 success/99 conflicts; one HELD claim/hold), live HTTP expiry, five-minute worker soak/restart and browser suite. |
| P0 — bắt buộc | Order với giá server snapshot; mock payment, HMAC webhook, retry/idempotency | Latest API/browser CI passes; TC-SEC-22 exercises parallel signed webhook idempotency. Real payment gateway/refund is out of scope |
| P0 — bắt buộc | Worker hết hạn hold/đơn đang chờ và ghi nhận late-payment reconciliation | Current-source CI on `9001ed7` passes live hold expiry, five-minute soak/restart, 15-minute soak/restart/catch-up and TC-SEC-47 sticky reconciliation; TC-WORKER-01 checks worker-cycle correlation IDs; no automatic refund is implemented |
| P0 — bắt buộc | Vé QR/lịch sử/check-in một lần | Latest API/browser CI passes; TC-SEC-26 rejects malformed/unknown QR without side effects; current full-stack browser journey verifies registration through ticket |
| P0 — bắt buộc | Admin CRUD, occupancy và revenue report | Latest API/browser CI passes; focused regressions cover Admin transitions, exact safe response fields, schedule validation, and report-to-API binding |
| P1 — chưa bật | Promotion/discount; workflow hủy/hoàn; mở rộng rule giá/suất | Không đưa vào bản nộp hiện tại. Seat type/surcharge cơ bản có trong demo, nhưng không đồng nghĩa P1 pricing/promotion đầy đủ |
| P2 — chưa bật | Gợi ý phim, điểm thưởng, email/SMS, đa đơn vị rạp, thanh toán thật | Ngoài bản nộp; không mô tả như chức năng hoàn thành |

**Ngoài phạm vi hiện tại:** production deployment, thanh toán thật, refund/cancellation, age-rating policy đã được phê duyệt pháp lý, worker/outbox vận hành đa instance và đối soát production, performance/security certification.

## 3. Definition of Done

P0 chỉ được coi là hoàn tất cho một commit/môi trường cụ thể khi:

1. SRS acceptance criteria và test cases ánh xạ qua RTM; thay đổi nghiệp vụ cập nhật cả ba.
2. Clean setup/migration/seed, build backend/frontend và test P0 chạy được với DB kiểm thử cô lập.
3. Không còn defect Critical/High mở; race ghế không tạo claim/vé trùng; late webhook không hồi sinh hold hết hạn.
4. Browser journey desktop/mobile và API/domain integration đạt; lỗi chưa xử lý/ngoài phạm vi ghi rõ.
5. Evidence có commit, lệnh, runtime/DB config, exit code và report/trace an toàn; không đưa token, QR token hay PII vào artifacts.
6. Security, accessibility, performance và recovery gate được đo theo ngưỡng đã duyệt trước khi tuyên bố production readiness.

**Evidence automated mới nhất:** Cả ba workflow trên application/test source `9001ed7e74203fd61bbf5f790207339622cb2a84` đều pass: [quality/API/DAST/Compose 40870861147](https://github.com/mahTuqn/DGKD_GK/actions/runs/40870861147), [Firefox/WebKit 40870861454](https://github.com/mahTuqn/DGKD_GK/actions/runs/40870861454) và [15-minute soak 40870861369](https://github.com/mahTuqn/DGKD_GK/actions/runs/40870861369). Traceability đạt 119 test cases / 28 requirements; full API, type-check, build, secret/dependency, domain, Compose/browser and configured DAST jobs pass. TC-SEC-47 covers contradictory/concurrent late callbacks; BUG-026 is retested. The current DAST artifact metadata is in the [9001ed7 evidence manifest](evidence/followup/2026-10-29-github-actions-9001ed7.json), but the artifact returned HTTP 401 to anonymous download. Its contents, totals, alert identities, URLs and payloads remain unreviewed; no finding count is claimed. The later docs-only commit `523343e` also passed all three CI workflows. Requester will complete the manual WCAG checklist. No staging exists; staging performance, production backup/PITR/RPO/RTO/restore and exhaustive ASVS/BOLA remain open. Results do not establish production readiness.

### Trạng thái theo các giai đoạn trong kế hoạch

| Giai đoạn | Trạng thái hiện tại | Còn lại |
|---|---|---|
| 0. Khởi động | Hoàn tất charter, backlog P0/P1/P2 và risk register | Owner cần ký các chính sách còn mở trước production |
| 1. Đặc tả | Hoàn tất SRS, RTM, test catalog, ERD và OpenAPI lint | Chốt cutoff hủy/hoàn, age-rating và staging target |
| 2. Nền tảng | Exact-source GitHub Actions trên `9001ed7` hoàn tất install, migration/seed, strict backend test typecheck, build, API/browser, DAST threshold, domain-quality, full Compose/browser smoke, cross-browser Firefox/WebKit và 15-minute worker soak. Local runtime recheck mới nhất bên dưới xác nhận hai local stacks đang chạy; CI dùng database cô lập | Không có staging/prod deployment; local demo DB không dùng làm CI database |
| 3. Danh mục và lịch | Hoàn tất phim/rạp/phòng/ghế/suất, lọc, Admin CRUD và buffer suất cùng phòng; Firefox/WebKit desktop smoke pass trên current-source CI | Thiết bị thật/mobile engines ngoài Chromium Pixel 7 và staging chưa kiểm tra |
| 4. Giữ ghế và đơn | Hoàn tất API/UI, exact expiry boundary, price snapshot; TC-PLAN-01 same-process race and TC-PLAN-08 two-process race pass in exact-source API run `40870861147`; CI live TTL, five-minute soak/restart and 15-minute soak/restart/catch-up pass | Staging performance remains unmeasured; worker soak does not replace load testing |
| 5. Thanh toán và vé | Hoàn tất mock payment, webhook, idempotency, QR/check-in và late-success reconciliation thủ công | Chưa kết nối gateway thật hoặc refund tự động |
| 6. Báo cáo và UX | Report API/UI; automated WCAG-tagged axe and keyboard scopes pass, including timer/seat names and TC-E2E-24–27 | Requester will complete manual WCAG 2.2 AA, screen-reader, contrast, zoom/reflow and orientation review |
| 7. Kiểm định và sửa lỗi | Current-source runs `40870861147`, `40870861454` and `40870861369` pass API (including two-process race), live expiry, five- and fifteen-minute worker soak, build, Chromium, Firefox/WebKit, domain-quality, DAST threshold and Compose/browser smoke | Manual accessibility, DAST detail review, staging/production operations and exhaustive ASVS/BOLA remain open |
| 8. Đóng gói | CI clean checkout + install/migration/seed/typecheck/build and functional/browser tests pass; [current application-source evidence manifest](evidence/followup/2026-10-29-github-actions-9001ed7.json) records exact SHA and run links | Manual accessibility and production evidence remain; real payment/refund is excluded by the SRS |

## 4. Risk register

| ID | Rủi ro | Khả năng / tác động | Giảm thiểu hiện có | Trạng thái còn lại |
|---|---|---|---|---|
| R-01 | Hai Customer giữ cùng ghế hoặc sinh vé trùng | Trung bình / Cao | PostgreSQL transaction/unique claim; TC-PLAN-01 and TC-PLAN-08 pass 100-request same-seat race through one and two API processes respectively (one success/99 conflict); current CI on `9001ed7` also passed webhook idempotency and worker soak/restart/catch-up | Staging performance remains unmeasured; worker soak is not a load test |
| R-02 | Hold hết hạn nhưng callback thanh toán đến muộn | Trung bình / Cao | Test checkout expiry/release; live TTL 300 giây qua HTTP chứng minh worker giải phóng claim và Customer khác giữ ghế sau hạn; TC-SEC-47 xác nhận late success giữ trạng thái reconciliation qua callback trái chiều/đồng thời, không phát vé hay hồi sinh order | Chưa kiểm tra callback ở mọi thời điểm biên; người vận hành phải xử lý reconciliation, không có refund tự động |
| R-03 | Tổng tiền sai hoặc client sửa giá | Trung bình / Cao | Giá tính ở server, snapshot trên claim/order; forged total bị từ chối; retry order trả cùng order ID | Chưa kiểm thử mọi seat/promotion/tax combination; promotion chưa bật |
| R-04 | Customer xem đơn người khác hoặc role vượt quyền/cinema scope | Trung bình / Cao | Current source-line consistency check matched all 35 route references in the authorization matrix. The focused no-P0/P1 source review is historical at `bf39b2a` ([manifest](evidence/followup/2026-10-29-read-only-bola-review.json)); exact-source API CI on `9001ed7` passed current authorization regressions. | The source-line check is not a security review. Exhaustive ASVS/API Top 10 and adversarial BOLA/IDOR testing remain open. |
| R-05 | Callback giả, replay hoặc đổi payload cùng event ID | Trung bình / Cao | HMAC-SHA256, amount/currency check, unique event ID/payload hash/idempotency; current-source CI passes webhook idempotency and TC-SEC-47 callback-state regressions in run 40870861147. | Configured DAST threshold passed, but the current artifact is unreviewed; alert counts/identity/URLs/payloads, consumer-context review and exhaustive ASVS/API Top 10 remain open. |
| R-06 | Lỗi accessibility ngoài trang khám phá | Trung bình / Trung bình | Current-source Playwright axe checks cover hold timer/seat labels, stacked login modal, scan success/error and payment-success dialog (TC-E2E-14, 24–27), plus existing browser scopes. | Requester will complete manual WCAG 2.2 AA, screen-reader, contrast, zoom/reflow, orientation and full keyboard review |
| R-07 | Chậm/lỗi khi nhiều người truy cập | Trung bình / Cao | Historical k6 local Docker baseline 50 VU/5 phút: showtime p95 9.85ms, hold p95 265.35ms, unexpected errors 0%; current-source CI passes a 100-request two-process seat race plus live expiry and 5-/15-minute worker soak/restart/catch-up | No staging environment is available; named-staging performance and production reliability remain unmeasured; worker soak is not a load test |
| R-08 | Báo cáo bị hiểu sai khi có pending/failed/refund | Thấp / Trung bình | Test xác nhận revenue chỉ tăng khi CONFIRMED; occupancy có định nghĩa tử/mẫu và fixture assertions | Refund chưa triển khai; chưa có đối soát nghiệp vụ sau refund |
| R-09 | Scope vượt khả năng nhóm | Cao / Cao | Khóa bản nộp ở P0, dùng mock adapter; P1/P2 giữ off | Giữ P1/P2 ngoài release cho tới khi có yêu cầu, decision table, test và review riêng |
| R-10 | Seed/default secret bị dùng ngoài demo | Trung bình / Cao | Compose requires generated DB/JWT/mock secrets; current-source Gitleaks and TC-SEC-13 configuration regressions pass; TC-OPS-01 built the current isolated Compose stack | Existing local Docker images/source parity and deployed staging/production secret rotation remain unverified. |
| R-11 | Quality report bị hiểu là chứng nhận/chứng minh toàn diện | Trung bình / Trung bình | Ghi commit/environment/scope; nêu test gaps và evidence rõ | Không gọi kết quả là chứng nhận ISO, PCI, WCAG hay security clearance |
| R-12 | Hai suất cùng phòng chồng giờ hoặc thiếu thời gian vệ sinh/chuyển ca | Thấp / Cao | Final API test tạo gap đúng 20 phút thành công và chặn conflict qua create/patch | Không bao phủ mọi hướng cập nhật/lịch phức hợp |
| R-13 | Backup không restore đúng encoding hoặc dữ liệu không đầy đủ | Thấp / Cao | PostgreSQL 17 custom dump restore vào UTF8 từ template0; counts được đối chiếu và exit code đều 0 | Chưa đánh giá lịch backup, PITR, RPO/RTO hoặc production restore; default target encoding WIN1258 đã fail ở lần thử đầu |
| R-14 | Rate limit mất hiệu lực khi restart hoặc chạy nhiều API replica | Trung bình / Cao | Login/register and sensitive hold/order/payment/webhook/check-in routes use express-rate-limit in-memory stores; current local Compose runs one API process. TC-SEC-27/28 validate proxy spoofing; TC-SEC-37 checks six sensitive routes and passed exact-source CI run `40870861147` on commit `9001ed7`. | Counters reset on restart and are not shared across replicas; use Redis/shared store before horizontal scaling |

## 5. Quyết định chính

| ID | Quyết định | Lý do và ranh giới |
|---|---|---|
| DEC-01 | Ngày nghiệp vụ dùng `Asia/Ho_Chi_Minh`; lưu timestamps UTC | Tính lịch theo ngày địa phương, tránh lệch múi giờ |
| DEC-02 | Hold tối đa 8 ghế cùng suất trong 5 phút | Server/DB clock là chuẩn; UI countdown chỉ hiển thị |
| DEC-03 | PostgreSQL là nguồn sự thật; transaction/lock/unique key bảo vệ ghế | Không dùng client state hoặc in-process queue làm đảm bảo bán vé |
| DEC-04 | Tiền là VND integer; tính từ seat claim ở server và snapshot vào order | Không nhận total tin cậy từ browser; retry không thay đổi order đã tạo |
| DEC-05 | Payment chỉ mock; webhook mock có HMAC, event ID idempotent | Không nhận/lưu dữ liệu thẻ; không tuyên bố đã tích hợp gateway thật |
| DEC-06 | Payment success chỉ phát một ticket/claim; failure giải phóng; late success sau expiry không phát vé | Đã có kiểm thử integration; xử lý refund/reconciliation production chưa có |
| DEC-07 | Customer chỉ xem đơn mình; Staff chỉ soát tại cinema được gán; Admin check-in toàn cục và quản lý dữ liệu | Final API suite pass scope cho hai endpoint check-in trong fixture hai cinema |
| DEC-08 | Revenue chỉ cộng Payment `SUCCEEDED`; occupancy là `SeatClaim.SOLD` trên capacity của suất `ACTIVE` trong kỳ | Công thức công khai trong API; test xử lý success/pending/failed và occupancy |
| DEC-09 | P1/P2 không bật trong bản nộp | Ưu tiên hoàn tất P0 và evidence; mở lại chỉ qua backlog/decision review riêng |
| DEC-10 | Chưa duyệt cutoff hủy/hoàn, age policy, coupon; hiện chỉ có Docker local, chưa có staging/prod budget | Không tự suy diễn rule; policy cần ADR trước khi bật P1; staging/prod gates chưa được đo |
| DEC-11 | Lịch trong cùng auditorium cần cách nhau ít nhất 20 phút sau endAt của suất trước | Dành buffer vệ sinh/chuyển ca; final API test pass gap 20 phút và từ chối conflict dưới ngưỡng |

## Lịch sử sự cố và trạng thái môi trường — 28–29/10/2026

Ngày 28/10, Compose DAST bị gián đoạn khi Engine API trả HTTP 500, Docker Desktop restart không hoàn tất, WSL distro `docker-desktop` và `com.docker.service` dừng; lúc đó host còn khoảng 0.44 GiB RAM. Đây là tương quan quan sát được, chưa xác định nguyên nhân gốc; không xóa/reset volume hoặc sửa VHDX. Chi tiết: [Docker Engine/DAST interruption evidence](evidence/followup/2026-10-28-docker-engine-dast-interruption.json).

Read-only local Docker check at 19:54 +07 on 29/10: both `dgkd_gk` and `cinema-qa` stacks have PostgreSQL/API/web healthy; the databases are exposed only on loopback ports 5434 and 5435; both workers are running, and each migration container exited 0. The containers had been up for about 19 hours. No destructive Docker operation or test was run; current image/source parity and staging/production behavior remain unverified. The latest app-source CI is `9001ed7` (runs linked above); the later docs-only `523343e` workflows also passed. Local health does not replace staging/production readiness.
