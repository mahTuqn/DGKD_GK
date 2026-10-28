# Project charter và risk register — CinemaBooking

## 1. Charter

**Mục tiêu:** cung cấp một ứng dụng web responsive demo đặt vé cho một cụm rạp, cùng SRS, test tự động, RTM, báo cáo lỗi và evidence có thể tái lập. Ứng dụng hỗ trợ Guest, Customer, Staff và Admin. Bản demo không thu thập thông tin thẻ và không đại diện cho hệ thống thanh toán/rạp đang vận hành thật.

**Giả định kế hoạch gốc:** nhóm 2 người, khoảng 10 tuần, 12–15 giờ/người/tuần; tiền tệ VND; ngày nghiệp vụ `Asia/Ho_Chi_Minh`; môi trường mục tiêu trong kế hoạch là staging. Các thời lượng và ngưỡng ban đầu trong kế hoạch là mục tiêu cần đo/duyệt, không phải kết quả đã đạt.

## 2. Phạm vi

| Mức | Phạm vi | Trạng thái bản demo |
|---|---|---|
| P0 — bắt buộc | Đăng ký/đăng nhập, profile, Customer/Staff/Admin RBAC, ownership đơn/vé, cinema-scoped Staff check-in | Exact-head CI 40749428850 on app-source commit `2683e35`: API and browser gates pass; TC-STAFF-01 verifies Staff A→B reassignment, stale-token rejection and scope change |
| P0 — bắt buộc | Danh mục phim/rạp/phòng/ghế/suất; lọc lịch, xem seat map và buffer 20 phút giữa suất cùng phòng | Exact-head CI 40749428850 on app-source commit `2683e35`: API and browser gates pass; E2E-22 verifies conflict/no-save and exact buffer on desktop/mobile |
| P0 — bắt buộc | Hold 1–8 ghế trong 5 phút; hết hạn và cạnh tranh cùng ghế | 100-request race: 1 success/99 conflicts; CI live HTTP expiry 1/1 in 300.52s and worker soak/restart 1/1 in 304.94s |
| P0 — bắt buộc | Order với giá server snapshot; mock payment, HMAC webhook, retry/idempotency | Success/failure/retry/forged total/revenue, late callback and manual reconciliation outbox have integration coverage; real payment gateway is out of scope |
| P0 — bắt buộc | Worker hết hạn hold/đơn đang chờ và ghi nhận late-payment reconciliation | Exact-head CI passed API 33/33, TC-WORKER-05 1/1, TC-WORKER-03 1/1 and TC-WORKER-06 1/1; no automatic refund is implemented |
| P0 — bắt buộc | Vé QR/lịch sử/check-in một lần | Exact-head CI 40749428850 on app-source commit `2683e35`: browser/API gates pass; Staff ID, QR and concurrent one-use checks pass |
| P0 — bắt buộc | Admin CRUD, occupancy và revenue report | Exact-head CI 40749428850 on app-source commit `2683e35`: API/browser gates pass; Admin role-change behavior is covered by focused authorization tests |
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

**Evidence automated hoàn tất gần nhất:** GitHub Actions run [40752756771](https://github.com/mahTuqn/DGKD_GK/actions/runs/40752756771) pass quality và DAST trên exact commit `d105057`; đây là commit tài liệu sau khi app source tại `2683e35` đã được kiểm tra. Traceability 74/25, browser 46/46 và ba scope Compose DAST đạt. Chi tiết ở [evidence manifest](evidence/followup/2026-10-29-github-actions-d105057.json). Firefox/WebKit smoke đã được lên lịch nhưng chưa có kết quả; requester sẽ rà checklist accessibility thủ công; không có staging nên performance staging chưa đo. Production behavior/backup/PITR/RPO/RTO/restore, exhaustive ASVS/BOLA và reliability lâu hơn năm phút cũng còn mở; đây chưa phải production readiness.

### Trạng thái theo các giai đoạn trong kế hoạch

| Giai đoạn | Trạng thái hiện tại | Còn lại |
|---|---|---|
| 0. Khởi động | Hoàn tất charter, backlog P0/P1/P2 và risk register | Owner cần ký các chính sách còn mở trước production |
| 1. Đặc tả | Hoàn tất SRS, RTM, test catalog, ERD và OpenAPI lint | Chốt cutoff hủy/hoàn, age-rating và staging target |
| 2. Nền tảng | Exact-head clean GitHub runner trên `d105057` hoàn tất checkout, npm install, migration/seed, build và automated tests; CI quality/DAST đều pass | Local demo/QA Compose vẫn cần xác minh sau khi áp dụng cấu hình mới; không coi CI thay thế staging/prod deployment |
| 3. Danh mục và lịch | Hoàn tất phim/rạp/phòng/ghế/suất, lọc, Admin CRUD và buffer suất cùng phòng | Chưa có kết quả Firefox/WebKit; smoke workflow hàng tuần đã được thêm. Không có staging |
| 4. Giữ ghế và đơn | Hoàn tất API/UI, 100-request race, exact expiry boundary, price snapshot; CI live HTTP TTL 300 giây và TC-WORKER-06 five-minute worker soak/restart pass trên `d105057` (app source `2683e35`) | Không có staging; performance trên staging và reliability ngoài 5 phút chưa đo |
| 5. Thanh toán và vé | Hoàn tất mock payment, webhook, idempotency, QR/check-in và late-success reconciliation thủ công | Chưa kết nối gateway thật hoặc refund tự động |
| 6. Báo cáo và UX | Report API/UI, browser desktop/mobile 46/46, axe on discovery/login/seat map/checkout/ticket/Admin, keyboard journey and auth/Admin error-state checks pass | Requester will complete manual WCAG 2.2 AA, screen-reader, contrast, zoom/reflow and orientation review |
| 7. Kiểm định và sửa lỗi | Exact-head run `40752756771` on `d105057` passes API, worker tests, build, Playwright 46/46, OpenAPI, traceability 74/25, dependency/secret checks and Compose DAST | No staging environment; manual accessibility, production operations, exhaustive ASVS/BOLA and reliability beyond five minutes remain open; Firefox/WebKit smoke is pending its first run |
| 8. Đóng gói | CI clean checkout + npm install/migration/seed/build/tests pass; [evidence manifest](evidence/followup/2026-10-29-github-actions-d105057.json) and browser/DAST artifacts are tied to exact SHA | Need manual accessibility/production evidence and final owner sign-off; real payment/refund is excluded by the SRS |

## 4. Risk register

| ID | Rủi ro | Khả năng / tác động | Giảm thiểu hiện có | Trạng thái còn lại |
|---|---|---|---|---|
| R-01 | Hai Customer giữ cùng ghế hoặc sinh vé trùng | Trung bình / Cao | PostgreSQL transaction/unique claim; test 100 request cho 1 thành công/99 conflict; payment callback idempotency; CI two-worker soak/restart 5 phút pass | Chưa có k6 performance run trên staging; worker soak không thay thế tải browser/API |
| R-02 | Hold hết hạn nhưng callback thanh toán đến muộn | Trung bình / Cao | Test checkout expiry/release; live TTL 300 giây qua HTTP chứng minh worker giải phóng claim và Customer khác giữ ghế sau hạn; late success hợp lệ trả `409 PAYMENT_TOO_LATE`, không phát vé, và tạo outbox idempotent/case `OPEN` thủ công | Chưa kiểm tra callback ở mọi thời điểm biên; người vận hành phải xử lý reconciliation, không có refund tự động |
| R-03 | Tổng tiền sai hoặc client sửa giá | Trung bình / Cao | Giá tính ở server, snapshot trên claim/order; forged total bị từ chối; retry order trả cùng order ID | Chưa kiểm thử mọi seat/promotion/tax combination; promotion chưa bật |
| R-04 | Customer xem đơn người khác hoặc role vượt quyền/cinema scope | Trung bình / Cao | Focused authorization 8/8 after authVersion enforcement; source inventory of all 35 Express routes found no missing owner/role/cinema guard. Exact-head CI 40752756771 passed the quality job. | Exhaustive ASVS/BOLA review and broader cross-role ownership matrix remain open. |
| R-05 | Callback giả, replay hoặc đổi payload cùng event ID | Trung bình / Cao | HMAC-SHA256, amount/currency check, unique event ID/payload hash/idempotency; exact-head CI 40752756771 passed all three Compose DAST scopes and TC-SEC-19 signed success/idempotent retry/changed-payload replay assertions. | Authenticated API has one triaged Low-confidence markup observation in JSON. Manual consumer-context review and exhaustive ASVS/API Top 10 remain open. |
| R-06 | Lỗi accessibility ngoài trang khám phá | Trung bình / Trung bình | Playwright axe pass ở discovery, login dialog, seat map, checkout, ticket và Admin; TC-E2E-09 two-way focus wrapping and Escape/focus-return checks for seat and checkout dialogs passed on desktop/mobile in run 40752756771. | Requester will complete manual WCAG 2.2 AA, screen-reader, contrast, zoom/reflow, orientation and full keyboard review |
| R-07 | Chậm/lỗi khi nhiều người truy cập | Trung bình / Cao | k6 local Docker baseline 50 VU/5 phút: showtime p95 9.85ms, hold p95 265.35ms, unexpected errors 0%; API race 1/99; exact-head CI 40752756771 passed live hold expiry and five-minute two-worker restart soak | No staging environment is available; named-staging performance and production reliability remain unmeasured; worker soak is not a load test |
| R-08 | Báo cáo bị hiểu sai khi có pending/failed/refund | Thấp / Trung bình | Test xác nhận revenue chỉ tăng khi CONFIRMED; occupancy có định nghĩa tử/mẫu và fixture assertions | Refund chưa triển khai; chưa có đối soát nghiệp vụ sau refund |
| R-09 | Scope vượt khả năng nhóm | Cao / Cao | Khóa bản nộp ở P0, dùng mock adapter; P1/P2 giữ off | Giữ P1/P2 ngoài release cho tới khi có yêu cầu, decision table, test và review riêng |
| R-10 | Seed/default secret bị dùng ngoài demo | Trung bình / Cao | Compose không còn secret production mặc định; DB/JWT/mock secret bắt buộc và production từ chối JWT/mock giá trị demo/CI; web/PostgreSQL loopback mặc định; TC-SEC-13 4/4; exact-head CI Gitleaks passes | Existing demo/QA containers chưa recreate với config mới; tài khoản seed công khai chỉ dùng local; deployed staging/production secret rotation chưa xác minh |
| R-11 | Quality report bị hiểu là chứng nhận/chứng minh toàn diện | Trung bình / Trung bình | Ghi commit/environment/scope; nêu test gaps và evidence rõ | Không gọi kết quả là chứng nhận ISO, PCI, WCAG hay security clearance |
| R-12 | Hai suất cùng phòng chồng giờ hoặc thiếu thời gian vệ sinh/chuyển ca | Thấp / Cao | Final API test tạo gap đúng 20 phút thành công và chặn conflict qua create/patch | Không bao phủ mọi hướng cập nhật/lịch phức hợp |
| R-13 | Backup không restore đúng encoding hoặc dữ liệu không đầy đủ | Thấp / Cao | PostgreSQL 17 custom dump restore vào UTF8 từ template0; counts được đối chiếu và exit code đều 0 | Chưa đánh giá lịch backup, PITR, RPO/RTO hoặc production restore; default target encoding WIN1258 đã fail ở lần thử đầu |

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
| DEC-10 | Chưa duyệt cutoff hủy/hoàn, age policy, coupon, production staging/budget | Không tự suy diễn rule; cấu hình và ADR cần được chốt trước khi mở rộng |
| DEC-11 | Lịch trong cùng auditorium cần cách nhau ít nhất 20 phút sau endAt của suất trước | Dành buffer vệ sinh/chuyển ca; final API test pass gap 20 phút và từ chối conflict dưới ngưỡng |

## Trạng thái rủi ro môi trường kiểm thử — 28/10/2026

Rủi ro vận hành Docker được tái mở sau khi Compose DAST bắt đầu active scan: Engine API trả HTTP 500, Docker Desktop restart không hoàn tất, WSL distro `docker-desktop` và `com.docker.service` đang stopped; hai web port không phản hồi. Đây là quan sát tương quan trong lúc host chỉ còn 0.44 GB RAM khả dụng, chưa xác định nguyên nhân gốc. Không xóa/reset volume hoặc sửa VHDX; service PostgreSQL Windows vẫn chạy. DAST chưa có report pass. Khôi phục Engine và xác minh các Compose project/volume là điều kiện trước khi tiếp tục DAST/image preview. Chi tiết: [Docker Engine/DAST interruption evidence](evidence/followup/2026-10-28-docker-engine-dast-interruption.json).
