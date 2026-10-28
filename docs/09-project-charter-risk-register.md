# Project charter và risk register — CinemaBooking

## 1. Charter

**Mục tiêu:** cung cấp một ứng dụng web responsive demo đặt vé cho một cụm rạp, cùng SRS, test tự động, RTM, báo cáo lỗi và evidence có thể tái lập. Ứng dụng hỗ trợ Guest, Customer, Staff và Admin. Bản demo không thu thập thông tin thẻ và không đại diện cho hệ thống thanh toán/rạp đang vận hành thật.

**Giả định kế hoạch gốc:** nhóm 2 người, khoảng 10 tuần, 12–15 giờ/người/tuần; tiền tệ VND; ngày nghiệp vụ `Asia/Ho_Chi_Minh`; môi trường mục tiêu trong kế hoạch là staging. Các thời lượng và ngưỡng ban đầu trong kế hoạch là mục tiêu cần đo/duyệt, không phải kết quả đã đạt.

## 2. Phạm vi

| Mức | Phạm vi | Trạng thái bản demo |
|---|---|---|
| P0 — bắt buộc | Đăng ký/đăng nhập, profile, Customer/Staff/Admin RBAC, ownership đơn/vé, cinema-scoped Staff check-in | Current source `b84ba704398a91d12cdca9abfd0657d40cadefc0`: quality/API and browser suites pass in CI run [40784545588](https://github.com/mahTuqn/DGKD_GK/actions/runs/40784545588); Firefox/WebKit desktop smoke passes in [40784545596](https://github.com/mahTuqn/DGKD_GK/actions/runs/40784545596) |
| P0 — bắt buộc | Danh mục phim/rạp/phòng/ghế/suất; lọc lịch, xem seat map và buffer 20 phút giữa suất cùng phòng | Current-source API/browser CI passes; TC-CAT-06 verifies inactive-cinema auditorium creation is denied without side effects; E2E-22 covers schedule conflict and exact buffer |
| P0 — bắt buộc | Hold 1–8 ghế trong 5 phút; hết hạn và cạnh tranh cùng ghế | Current CI includes API integration, live HTTP expiry, five-minute worker soak/restart, and browser suite; 100-request race evidence is retained in earlier run 40690352889 |
| P0 — bắt buộc | Order với giá server snapshot; mock payment, HMAC webhook, retry/idempotency | Current-source API/browser CI passes; TC-SEC-22 exercises parallel signed webhook idempotency. Real payment gateway/refund is out of scope |
| P0 — bắt buộc | Worker hết hạn hold/đơn đang chờ và ghi nhận late-payment reconciliation | Current CI passes live hold expiry and five-minute worker soak/restart; 15-minute soak/restart/catch-up passed on historical source `8b1fc83`; no automatic refund is implemented |
| P0 — bắt buộc | Vé QR/lịch sử/check-in một lần | Current-source API/browser CI passes; TC-SEC-26 rejects malformed/unknown QR without side effects; current full-stack browser journey verifies registration through ticket |
| P0 — bắt buộc | Admin CRUD, occupancy và revenue report | Current-source API/browser CI passes; focused regressions cover Admin transitions, exact safe response fields, schedule validation, and report-to-API binding |
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

**Evidence automated mới nhất:** Source `b84ba704398a91d12cdca9abfd0657d40cadefc0` passed quality/API, configured DAST High-alert gate, domain coverage/mutation gate, full Compose/browser smoke, and Firefox/WebKit smoke. See [current evidence manifest](evidence/followup/2026-10-29-github-actions-b84ba70.json) and runs [40784545588](https://github.com/mahTuqn/DGKD_GK/actions/runs/40784545588) / [40784545596](https://github.com/mahTuqn/DGKD_GK/actions/runs/40784545596). The DAST artifact details and severity counts were not independently reviewed; no zero-finding claim is made. Requester will complete the manual WCAG checklist. No staging is available; named-staging performance, production backup/PITR/RPO/RTO/restore and exhaustive ASVS/BOLA remain open. These results do not establish production readiness.

### Trạng thái theo các giai đoạn trong kế hoạch

| Giai đoạn | Trạng thái hiện tại | Còn lại |
|---|---|---|
| 0. Khởi động | Hoàn tất charter, backlog P0/P1/P2 và risk register | Owner cần ký các chính sách còn mở trước production |
| 1. Đặc tả | Hoàn tất SRS, RTM, test catalog, ERD và OpenAPI lint | Chốt cutoff hủy/hoàn, age-rating và staging target |
| 2. Nền tảng | Exact-source GitHub Actions trên `b84ba70` hoàn tất install, migration/seed, build, API/browser, DAST gate, domain-quality và full Compose/browser smoke. Read-only local check hiện thấy hai stack demo/QA đang chạy, nhưng local image/source parity chưa được xác minh | Không có staging/prod deployment; không rebuild local stacks khi host chỉ còn khoảng 0.46 GiB RAM |
| 3. Danh mục và lịch | Hoàn tất phim/rạp/phòng/ghế/suất, lọc, Admin CRUD và buffer suất cùng phòng; Firefox/WebKit desktop smoke pass trên current-source CI | Thiết bị thật/mobile engines ngoài Chromium Pixel 7 và staging chưa kiểm tra |
| 4. Giữ ghế và đơn | Hoàn tất API/UI, 100-request race (bằng chứng historical), exact expiry boundary, price snapshot; current-source CI live TTL và five-minute worker soak/restart pass; 15-minute soak/restart/catch-up là bằng chứng historical trên `8b1fc83` | Không có staging; performance trên staging và reliability beyond 15 minutes trên current source chưa đo |
| 5. Thanh toán và vé | Hoàn tất mock payment, webhook, idempotency, QR/check-in và late-success reconciliation thủ công | Chưa kết nối gateway thật hoặc refund tự động |
| 6. Báo cáo và UX | Report API/UI; automated axe/keyboard scopes pass in current-source CI, including TC-E2E-24–26 | Requester will complete manual WCAG 2.2 AA, screen-reader, contrast, zoom/reflow and orientation review |
| 7. Kiểm định và sửa lỗi | Current-source runs `40784545588` and `40784545596`: API, live expiry, five-minute soak, build, Chromium, Firefox/WebKit, domain-quality gate, DAST configured gate and Compose/browser smoke pass | No staging; current DAST finding details, manual accessibility, production operations and exhaustive ASVS/BOLA remain open |
| 8. Đóng gói | CI clean checkout + install/migration/seed/build and functional/browser tests pass; [current evidence manifest](evidence/followup/2026-10-29-github-actions-b84ba70.json) records exact SHA and run links | Manual accessibility and production evidence remain; real payment/refund is excluded by the SRS |

## 4. Risk register

| ID | Rủi ro | Khả năng / tác động | Giảm thiểu hiện có | Trạng thái còn lại |
|---|---|---|---|---|
| R-01 | Hai Customer giữ cùng ghế hoặc sinh vé trùng | Trung bình / Cao | PostgreSQL transaction/unique claim; test 100 request cho 1 thành công/99 conflict (evidence historical); current CI tests webhook idempotency and five-minute two-worker soak/restart. Fifteen-minute soak/catch-up is historical on `8b1fc83` | Chưa có k6 performance run trên staging; worker soak không thay thế tải browser/API |
| R-02 | Hold hết hạn nhưng callback thanh toán đến muộn | Trung bình / Cao | Test checkout expiry/release; live TTL 300 giây qua HTTP chứng minh worker giải phóng claim và Customer khác giữ ghế sau hạn; late success hợp lệ trả `409 PAYMENT_TOO_LATE`, không phát vé, và tạo outbox idempotent/case `OPEN` thủ công | Chưa kiểm tra callback ở mọi thời điểm biên; người vận hành phải xử lý reconciliation, không có refund tự động |
| R-03 | Tổng tiền sai hoặc client sửa giá | Trung bình / Cao | Giá tính ở server, snapshot trên claim/order; forged total bị từ chối; retry order trả cùng order ID | Chưa kiểm thử mọi seat/promotion/tax combination; promotion chưa bật |
| R-04 | Customer xem đơn người khác hoặc role vượt quyền/cinema scope | Trung bình / Cao | Source audit checked all 35 Express routes. Current-source CI passes TC-CAT-06 and TC-SEC-22–26 in addition to existing object/role guards. | Full adversarial ASVS/API Top 10 and broader cross-role runtime matrix remain open. |
| R-05 | Callback giả, replay hoặc đổi payload cùng event ID | Trung bình / Cao | HMAC-SHA256, amount/currency check, unique event ID/payload hash/idempotency; current-source CI passes parallel signed webhook idempotency TC-SEC-22; earlier tests cover changed-payload and cross-order replay. | DAST High-alert gate passed in run 40784545588, but current finding details/counts were not independently reviewed. Manual consumer-context review and exhaustive ASVS/API Top 10 remain open. |
| R-06 | Lỗi accessibility ngoài trang khám phá | Trung bình / Trung bình | Current-source Playwright axe checks cover stacked login modal, scan success/error and payment-success dialog (TC-E2E-24–26), plus existing browser scopes. | Requester will complete manual WCAG 2.2 AA, screen-reader, contrast, zoom/reflow, orientation and full keyboard review |
| R-07 | Chậm/lỗi khi nhiều người truy cập | Trung bình / Cao | Historical k6 local Docker baseline 50 VU/5 phút: showtime p95 9.85ms, hold p95 265.35ms, unexpected errors 0%; API race evidence is historical; current-source CI passed live hold expiry and five-minute soak/restart | No staging environment is available; named-staging performance and production reliability remain unmeasured; worker soak is not a load test |
| R-08 | Báo cáo bị hiểu sai khi có pending/failed/refund | Thấp / Trung bình | Test xác nhận revenue chỉ tăng khi CONFIRMED; occupancy có định nghĩa tử/mẫu và fixture assertions | Refund chưa triển khai; chưa có đối soát nghiệp vụ sau refund |
| R-09 | Scope vượt khả năng nhóm | Cao / Cao | Khóa bản nộp ở P0, dùng mock adapter; P1/P2 giữ off | Giữ P1/P2 ngoài release cho tới khi có yêu cầu, decision table, test và review riêng |
| R-10 | Seed/default secret bị dùng ngoài demo | Trung bình / Cao | Compose requires generated DB/JWT/mock secrets; current-source Gitleaks and TC-SEC-13 configuration regressions pass; TC-OPS-01 built the current isolated Compose stack | Existing local Docker images/source parity and deployed staging/production secret rotation remain unverified. |
| R-11 | Quality report bị hiểu là chứng nhận/chứng minh toàn diện | Trung bình / Trung bình | Ghi commit/environment/scope; nêu test gaps và evidence rõ | Không gọi kết quả là chứng nhận ISO, PCI, WCAG hay security clearance |
| R-12 | Hai suất cùng phòng chồng giờ hoặc thiếu thời gian vệ sinh/chuyển ca | Thấp / Cao | Final API test tạo gap đúng 20 phút thành công và chặn conflict qua create/patch | Không bao phủ mọi hướng cập nhật/lịch phức hợp |
| R-13 | Backup không restore đúng encoding hoặc dữ liệu không đầy đủ | Thấp / Cao | PostgreSQL 17 custom dump restore vào UTF8 từ template0; counts được đối chiếu và exit code đều 0 | Chưa đánh giá lịch backup, PITR, RPO/RTO hoặc production restore; default target encoding WIN1258 đã fail ở lần thử đầu |
| R-14 | Rate limit mất hiệu lực khi restart hoặc chạy nhiều API replica | Trung bình / Cao | API hiện dùng express-rate-limit in-memory store; current local Compose chạy một API process. TC-SEC-27 bổ sung kiểm tra không thể né login limiter bằng X-Forwarded-For giả khi gọi trực tiếp | Chưa dùng shared rate-limit store; trước khi scale cần Redis/store dùng chung và request-level test qua Nginx trusted hop |

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

Trạng thái mới hơn: read-only local check ngày 29/10 thấy hai stack `dgkd_gk` và `cinema-qa` đang chạy; source/image parity chưa xác minh. Host chỉ còn khoảng 0.46 GiB RAM trống, nên không rebuild hoặc prune Docker. Thay vào đó, current-source GitHub Actions run 40784545588 đã pass full disposable Compose/browser smoke mà không thay đổi local projects/volumes. DAST đã pass configured High-alert gate trên CI; finding details/counts chưa được review độc lập. Local health không thay thế staging/production readiness.
