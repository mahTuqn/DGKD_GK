# Project charter và risk register — CinemaBooking

## 1. Charter

**Mục tiêu:** cung cấp một ứng dụng web responsive demo đặt vé cho một cụm rạp, cùng SRS, test tự động, RTM, báo cáo lỗi và evidence có thể tái lập. Ứng dụng hỗ trợ Guest, Customer, Staff và Admin. Bản demo không thu thập thông tin thẻ và không đại diện cho hệ thống thanh toán/rạp đang vận hành thật.

**Giả định kế hoạch gốc:** nhóm 2 người, khoảng 10 tuần, 12–15 giờ/người/tuần; tiền tệ VND; ngày nghiệp vụ `Asia/Ho_Chi_Minh`; môi trường mục tiêu trong kế hoạch là staging. Các thời lượng và ngưỡng ban đầu trong kế hoạch là mục tiêu cần đo/duyệt, không phải kết quả đã đạt.

## 2. Phạm vi

| Mức | Phạm vi | Trạng thái bản demo |
|---|---|---|
| P0 — bắt buộc | Đăng ký/đăng nhập, profile, Customer/Staff/Admin RBAC, ownership đơn/vé, cinema-scoped Staff check-in | Final API 17/17 gồm profile, assigned/unassigned/cross-cinema Staff và Admin global check-in |
| P0 — bắt buộc | Danh mục phim/rạp/phòng/ghế/suất; lọc lịch, xem seat map và buffer 20 phút giữa suất cùng phòng | Final API 17/17 kiểm tra buffer và Playwright 24/24 kiểm tra filter/axe trên phạm vi đã định |
| P0 — bắt buộc | Hold 1–8 ghế trong 5 phút; hết hạn và cạnh tranh cùng ghế | 100 request API: 1 thành công, 99 conflict; expiry/release và signed late callback được kiểm tra. Boundary trước/sát 5 phút chưa đo |
| P0 — bắt buộc | Order với giá server snapshot; mock payment, HMAC webhook, retry/idempotency | Happy/fail/retry/forged total/revenue và late callback có integration coverage; không phải cổng thật |
| P0 — bắt buộc | Vé QR/lịch sử/check-in một lần | Final Playwright 24/24 và API 17/17 đạt trong các luồng Customer/Staff/Admin đã nêu |
| P0 — bắt buộc | Admin CRUD, occupancy và revenue report | Final API 17/17; E2E dashboard occupancy và create/update cinema pass |
| P1 — chưa bật | Promotion/discount; workflow hủy/hoàn; mở rộng rule giá/suất | Không đưa vào bản nộp hiện tại. Seat type/surcharge cơ bản có trong demo, nhưng không đồng nghĩa P1 pricing/promotion đầy đủ |
| P2 — chưa bật | Gợi ý phim, điểm thưởng, email/SMS, đa đơn vị rạp, thanh toán thật | Ngoài bản nộp; không mô tả như chức năng hoàn thành |

**Ngoài phạm vi hiện tại:** production deployment, thanh toán thật, refund/cancellation, age-rating policy đã được phê duyệt pháp lý, worker/outbox/reconciliation production, performance/Security certification.

## 3. Definition of Done

P0 chỉ được coi là hoàn tất cho một commit/môi trường cụ thể khi:

1. SRS acceptance criteria và test cases ánh xạ qua RTM; thay đổi nghiệp vụ cập nhật cả ba.
2. Clean setup/migration/seed, build backend/frontend và test P0 chạy được với DB kiểm thử cô lập.
3. Không còn defect Critical/High mở; race ghế không tạo claim/vé trùng; late webhook không hồi sinh hold hết hạn.
4. Browser journey desktop/mobile và API/domain integration đạt; lỗi chưa xử lý/ngoài phạm vi ghi rõ.
5. Evidence có commit, lệnh, runtime/DB config, exit code và report/trace an toàn; không đưa token, QR token hay PII vào artifacts.
6. Security, accessibility, performance và recovery gate được đo theo ngưỡng đã duyệt trước khi tuyên bố production readiness.

**Evidence local đến 27/10/2026:** API suite 17/17 (4 files) và browser run 24/24 (12 case × Chromium desktop/Pixel 7), gồm regression `TC-E2E-11`. `npm run qa:trace` PASS với 40 test cases/24 requirements; validator kiểm tra test ID markers ở source `.ts/.js/.mjs/.yaml/.yml` và hỗ trợ prefix `Automated`, gồm markers trong hai ZAP config. Build và backend start smoke pass; Redocly OpenAPI lint không warning, quality workflow có gate; dependency audit 0 vulnerabilities. Gitleaks v8.30.1 pass trên commit mã nguồn đóng băng, không có leak; Gitleaks Action v3 cùng phiên bản đã cấu hình trong `ci.yml`, nhưng remote GitHub Actions chưa chạy. Coverage domain 100% lines/branches/functions; mutation 81.82%; k6 local 50 VU/5 phút đạt p95/error thresholds. ZAP không báo High/Critical; authenticated scan có alert Low-confidence trong JSON, còn được ghi nhận ngoài UI đã kiểm tra. Axe discovery/seat map/checkout không có serious/critical; keyboard/focus E2E đến checkout pass. PostgreSQL 17 custom-format backup/restore rehearsal pass, source/target UTF8. Commit `2be2d911c635cbdbe810bd4f77eca71b73928d1f` đã qua clean-clone run; manual accessibility, staging/soak, production backup schedule/PITR/RPO/RTO, live expiry boundary, worker/gateway operations và full ASVS/BOLA review chưa được đánh giá. Đây là local P0 demo có evidence, chưa phải production readiness.

## 4. Risk register

| ID | Rủi ro | Khả năng / tác động | Giảm thiểu hiện có | Trạng thái còn lại |
|---|---|---|---|---|
| R-01 | Hai Customer giữ cùng ghế hoặc sinh vé trùng | Trung bình / Cao | PostgreSQL transaction/unique claim; test 100 request cho 1 thành công/99 conflict; payment callback idempotency | Chưa có benchmark multi-process/soak; 100 request test không thay k6 |
| R-02 | Hold hết hạn nhưng callback thanh toán đến muộn | Trung bình / Cao | Test checkout expiry/release và HMAC callback sau expiry: `409 PAYMENT_TOO_LATE`, order expired, không vé, ghế được giải phóng | Chưa kiểm tra thời điểm ngay trước/sát mốc 5 phút hoặc cơ chế reconciliation/refund production |
| R-03 | Tổng tiền sai hoặc client sửa giá | Trung bình / Cao | Giá tính ở server, snapshot trên claim/order; forged total bị từ chối; retry order trả cùng order ID | Chưa kiểm thử mọi seat/promotion/tax combination; promotion chưa bật |
| R-04 | Customer xem đơn người khác hoặc role vượt quyền/cinema scope | Trung bình / Cao | Final API suite pass ownership/RBAC, profile và Staff đúng/sai cinema trên check-in ID/QR | Chưa phải kiểm thử exhaustive BOLA/IDOR trên mọi object/route/cinema |
| R-05 | Callback giả, replay hoặc đổi payload cùng event ID | Trung bình / Cao | HMAC-SHA256, amount/currency check, unique event ID/payload hash/idempotency; ZAP authenticated/unauthenticated API scans không có High/Critical trong scope | Còn alert Low-confidence XSS trong JSON chưa được xác minh; scan không thay thế full OWASP/API Top 10, review BOLA, logging/rate-limit và production secret rotation |
| R-06 | Lỗi accessibility ngoài trang khám phá | Trung bình / Trung bình | Final Playwright axe 0 serious/critical ở discovery, seat map và checkout; keyboard/focus E2E đến checkout pass | Login, ticket/admin chưa axe; keyboard/focus review thủ công đầy đủ chưa chạy |
| R-07 | Chậm/lỗi khi nhiều người truy cập | Trung bình / Cao | k6 local 50 VU/5 phút: showtime p95 27.57ms, hold p95 349.70ms, unexpected errors 0%; API race một ghế đạt 1/99 | Chưa chạy staging, soak hoặc reliability test đa instance/worker; không suy rộng local baseline thành production capacity |
| R-08 | Báo cáo bị hiểu sai khi có pending/failed/refund | Thấp / Trung bình | Test xác nhận revenue chỉ tăng khi CONFIRMED; occupancy có định nghĩa tử/mẫu và fixture assertions | Refund chưa triển khai; chưa có đối soát nghiệp vụ sau refund |
| R-09 | Scope vượt khả năng nhóm | Cao / Cao | Khóa bản nộp ở P0, dùng mock adapter; P1/P2 giữ off | Giữ P1/P2 ngoài release cho tới khi có yêu cầu, decision table, test và review riêng |
| R-10 | Seed/default secret bị dùng ngoài demo | Thấp / Cao | Tài khoản giả, `.env.example`, secret cấu hình riêng; Gitleaks v8.30.1 quét commit mã nguồn đóng băng và clean clone đạt; cùng phiên bản được cấu hình trong CI | Remote CI chưa chạy; cấm dùng credential/default mock secret cho production; production secret/config chưa đánh giá |
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
