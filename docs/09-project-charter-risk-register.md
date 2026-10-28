# Project charter và risk register — CinemaBooking

## 1. Charter

**Mục tiêu:** cung cấp một ứng dụng web responsive demo đặt vé cho một cụm rạp, cùng SRS, test tự động, RTM, báo cáo lỗi và evidence có thể tái lập. Ứng dụng hỗ trợ Guest, Customer, Staff và Admin. Bản demo không thu thập thông tin thẻ và không đại diện cho hệ thống thanh toán/rạp đang vận hành thật.

**Giả định kế hoạch gốc:** nhóm 2 người, khoảng 10 tuần, 12–15 giờ/người/tuần; tiền tệ VND; ngày nghiệp vụ `Asia/Ho_Chi_Minh`; môi trường mục tiêu trong kế hoạch là staging. Các thời lượng và ngưỡng ban đầu trong kế hoạch là mục tiêu cần đo/duyệt, không phải kết quả đã đạt.

## 2. Phạm vi

| Mức | Phạm vi | Trạng thái bản demo |
|---|---|---|
| P0 — bắt buộc | Đăng ký/đăng nhập, profile, Customer/Staff/Admin RBAC, ownership đơn/vé, cinema-scoped Staff check-in | After authVersion hardening: API suite 28/28, focused authorization 8/8, browser 40/40. TC-SEC-08..12 include Guest/object/role/cinema/token-revocation cases |
| P0 — bắt buộc | Danh mục phim/rạp/phòng/ghế/suất; lọc lịch, xem seat map và buffer 20 phút giữa suất cùng phòng | Earlier Docker/browser results are historical; latest local browser suite 40/40 and API suite 28/28 |
| P0 — bắt buộc | Hold 1–8 ghế trong 5 phút; hết hạn và cạnh tranh cùng ghế | 100-request race: 1 thành công/99 conflict; live HTTP expiry passed at 300 seconds. Five-minute worker process soak remains unrun |
| P0 — bắt buộc | Order với giá server snapshot; mock payment, HMAC webhook, retry/idempotency | Success/failure/retry/forged total/revenue, late callback và manual reconciliation outbox có integration coverage; không phải cổng thật |
| P0 — bắt buộc | Worker hết hạn hold/đơn đang chờ và ghi nhận late-payment reconciliation | Latest API suite 28/28; worker-process restart case 1/1 is from the pre-authVersion combined run; no automatic refund is implemented |
| P0 — bắt buộc | Vé QR/lịch sử/check-in một lần | Latest browser 40/40, API 28/28 and focused check-in authorization assertions passed |
| P0 — bắt buộc | Admin CRUD, occupancy và revenue report | Latest API suite 28/28 and browser suite 40/40; Admin role-change behavior is covered by focused authorization 8/8 |
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

**Evidence local mới nhất:** sau authVersion hardening, API suite đạt 28/28 trên 7 files, focused authorization đạt 8/8, browser đạt 40/40, build backend/frontend và OpenAPI lint pass; `npm run qa:trace` đạt 65/25. Các lượt này chạy riêng; full `npm test` trước hardening đạt API 26/26, worker-process 1/1 và browser 40/40, chưa rerun tổng hợp trên code mới. Current working tree pass standalone Gitleaks v8.30.1 trên 25 target với 0 finding; `npm audit --audit-level=high` hiện có 0 vulnerabilities. Live hold TTL, mutation và dependency audit còn lại là evidence của các lượt trước. Docker Compose DAST/current API-web image preview chưa xác minh. Remote GitHub Actions, manual accessibility, staging/production, backup schedule/PITR/RPO/RTO, prolonged soak, gateway thật, full ASVS/BOLA review vẫn còn mở; đây chưa phải production readiness.

### Trạng thái theo các giai đoạn trong kế hoạch

| Giai đoạn | Trạng thái hiện tại | Còn lại |
|---|---|---|
| 0. Khởi động | Hoàn tất charter, backlog P0/P1/P2 và risk register | Owner cần ký các chính sách còn mở trước production |
| 1. Đặc tả | Hoàn tất SRS, RTM, test catalog, ERD và OpenAPI lint | Chốt cutoff hủy/hoàn, age-rating và staging target |
| 2. Nền tảng | Historical clean clone commit `5ae4c2b` đã build/migrate/seed thành công; Docker Engine hiện phản hồi v29.7.2, demo/QA Compose stacks running và PostgreSQL healthy; CI có quality/DAST jobs | Cần giữ Engine ổn định và chạy current-image preview/Compose DAST khi đủ RAM; GitHub Actions remote chưa chạy |
| 3. Danh mục và lịch | Hoàn tất phim/rạp/phòng/ghế/suất, lọc, Admin CRUD và buffer suất cùng phòng | Chưa đánh giá Firefox/WebKit hoặc staging |
| 4. Giữ ghế và đơn | Hoàn tất API/UI, 100-request race, exact expiry boundary, price snapshot; TC-WORKER-03 live HTTP TTL 300 giây đạt 1/1 và ghế được giữ lại sau worker sweep | Chưa chạy prolonged soak trên staging hoặc môi trường production |
| 5. Thanh toán và vé | Hoàn tất mock payment, webhook, idempotency, QR/check-in và late-success reconciliation thủ công | Chưa kết nối gateway thật hoặc refund tự động |
| 6. Báo cáo và UX | Hoàn tất report API/UI, browser desktop/mobile, axe trên discovery/login/seat map/checkout/ticket/Admin, keyboard journey và auth/Admin error-state accessibility; browser 40/40 | Chờ manual WCAG review và screen reader |
| 7. Kiểm định và sửa lỗi | Sau authVersion: API 28/28, focused authorization 8/8, browser 40/40, build/OpenAPI pass; traceability 65/25. Full composite run trước thay đổi đạt worker-process 1/1 và live TTL 300 giây 1/1. | Full composite rerun, Compose/remote DAST, five-minute reliability soak, staging/production và kiểm định accessibility/security thủ công còn mở |
| 8. Đóng gói | Local regression/accessibility evidence manifests ngày 28/10; browser 40/40 với PostgreSQL trong Docker; standalone Gitleaks current-tree 0/25; demo/QA PostgreSQL trong Docker healthy; CI quality/DAST jobs đã cấu hình | Cần clean-clone verification trên frozen commit hiện tại và manifest gắn commit; Compose DAST/current production image và GitHub Actions remote chưa xác minh; full composite rerun và các giới hạn giai đoạn 7 còn mở trước staging/production |

## 4. Risk register

| ID | Rủi ro | Khả năng / tác động | Giảm thiểu hiện có | Trạng thái còn lại |
|---|---|---|---|---|
| R-01 | Hai Customer giữ cùng ghế hoặc sinh vé trùng | Trung bình / Cao | PostgreSQL transaction/unique claim; test 100 request cho 1 thành công/99 conflict; payment callback idempotency | Chưa có benchmark multi-process/soak; 100 request test không thay k6 |
| R-02 | Hold hết hạn nhưng callback thanh toán đến muộn | Trung bình / Cao | Test checkout expiry/release; live TTL 300 giây qua HTTP chứng minh worker giải phóng claim và Customer khác giữ ghế sau hạn; late success hợp lệ trả `409 PAYMENT_TOO_LATE`, không phát vé, và tạo outbox idempotent/case `OPEN` thủ công | Chưa kiểm tra callback ở mọi thời điểm biên; người vận hành phải xử lý reconciliation, không có refund tự động |
| R-03 | Tổng tiền sai hoặc client sửa giá | Trung bình / Cao | Giá tính ở server, snapshot trên claim/order; forged total bị từ chối; retry order trả cùng order ID | Chưa kiểm thử mọi seat/promotion/tax combination; promotion chưa bật |
| R-04 | Customer xem đơn người khác hoặc role vượt quyền/cinema scope | Trung bình / Cao | Focused authorization 8/8 after authVersion enforcement; source inventory of all 35 Express routes found no missing owner/role/cinema guard. Stale-token, Admin user-route, ownership and cinema-scope assertions pass in the recorded local scope. | Staff/Admin cross-role ownership cases are not separate. Exhaustive ASVS/BOLA review remains open. |
| R-05 | Callback giả, replay hoặc đổi payload cùng event ID | Trung bình / Cao | HMAC-SHA256, amount/currency check, unique event ID/payload hash/idempotency; native unauthenticated/authenticated ZAP checks xác nhận 401/200 và không có High/Medium | Native auth scan ghi một Low-confidence XSS observation trên JSON; TC-E2E-11 xác nhận text encoding ở UI cho ba trường rạp. Compose DAST đã bắt đầu nhưng bị gián đoạn khi Engine trả HTTP 500; không có report pass và cleanup chưa xác minh. Remote DAST chưa chạy; cần tiếp tục ASVS/API Top 10, BOLA, logging/rate-limit và production secret rotation |
| R-06 | Lỗi accessibility ngoài trang khám phá | Trung bình / Trung bình | Playwright axe pass ở discovery, login dialog, seat map, checkout, ticket và Admin; browser tests xác nhận live alert auth, accessible labels/validation và tên Admin details; keyboard/focus E2E đến checkout pass | Manual WCAG 2.2 AA, screen reader và keyboard/focus review đầy đủ chưa chạy |
| R-07 | Chậm/lỗi khi nhiều người truy cập | Trung bình / Cao | k6 local 50 VU/5 phút: showtime p95 9.85ms, hold p95 265.35ms, unexpected errors 0%; API race một ghế đạt 1/99; TC-WORKER-05 60-second two-process soak passed; separate TC-WORKER-06 five-minute local gate is implemented with 30 periodic injections, graceful stop and restart catch-up assertions | TC-WORKER-06 remains unrun: host memory is below the 1.5 GiB headroom target and no dedicated soak DB URL is configured; staging and production reliability remain unverified |
| R-08 | Báo cáo bị hiểu sai khi có pending/failed/refund | Thấp / Trung bình | Test xác nhận revenue chỉ tăng khi CONFIRMED; occupancy có định nghĩa tử/mẫu và fixture assertions | Refund chưa triển khai; chưa có đối soát nghiệp vụ sau refund |
| R-09 | Scope vượt khả năng nhóm | Cao / Cao | Khóa bản nộp ở P0, dùng mock adapter; P1/P2 giữ off | Giữ P1/P2 ngoài release cho tới khi có yêu cầu, decision table, test và review riêng |
| R-10 | Seed/default secret bị dùng ngoài demo | Trung bình / Cao | Compose không còn secret production mặc định; DB/JWT/mock secret bắt buộc và production từ chối JWT/mock giá trị demo/CI; web/PostgreSQL loopback mặc định; TC-SEC-13 4/4; Gitleaks 25 target + history 7 commit đều 0 finding | Existing demo/QA containers chưa recreate với config mới; tài khoản seed công khai chỉ dùng local; remote CI/staging/production và secret rotation vẫn chưa xác minh |
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
