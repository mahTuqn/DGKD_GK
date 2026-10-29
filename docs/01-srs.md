# Đặc tả yêu cầu CinemaBooking

## 1. Mục tiêu và phạm vi

CinemaBooking là ứng dụng web responsive đặt vé cho một cụm rạp, dùng trong demo học phần và kiểm định chất lượng phần mềm. Khách tra cứu phim/lịch chiếu; Customer giữ ghế, tạo đơn và thanh toán mô phỏng; Staff soát vé; Admin quản lý dữ liệu. Không xử lý thẻ thật.

## 2. Actor

| Actor | Quyền chính |
|---|---|
| Guest | Xem phim, rạp, suất và sơ đồ ghế; đăng ký/đăng nhập |
| Customer | Tất cả quyền Guest; giữ ghế, thanh toán demo, xem vé/đơn của mình |
| Staff | Quét/soát vé tại quầy trong demo, chỉ tại rạp được phân công; không dùng API booking/payment của Customer |
| Admin | Quản lý danh mục, suất chiếu, giá, người dùng và báo cáo; có thể check-in vé tại mọi rạp; booking/payment dùng tài khoản Customer riêng |

## 3. Quy tắc nghiệp vụ

- Múi giờ hiển thị/ngày nghiệp vụ: `Asia/Ho_Chi_Minh`; lưu timestamp UTC.
- Hold giữ tối đa 8 ghế của cùng suất trong 5 phút. Hạn do backend quyết định.
- Chỉ một hold còn hiệu lực hoặc một vé bán được cho cùng ghế/suất. Tranh chấp trả `409`.
- Giá tính ở backend, lưu nguyên VND và snapshot theo đơn; không tin tổng giá gửi từ browser.
- Demo payment không nhận thông tin thẻ. Lặp request cùng đơn không phát nhiều vé.
- Chỉ role Customer được tạo hold, tạo order và gọi endpoint tự hoàn tất mock payment; Guest bị yêu cầu đăng nhập, Staff/Admin nhận `403 ROLE_FORBIDDEN` trước khi đọc hoặc thay đổi booking/payment state.
- Customer chỉ xem đơn/vé của mình. Staff chỉ được soát vé tại rạp được phân công; Staff chưa có rạp và Staff khác rạp bị từ chối. Admin được soát vé toàn cục. Vé đã soát một lần không thể soát lại.
- Hai suất cùng phòng chiếu phải cách nhau ít nhất 20 phút sau thời lượng suất trước để dành thời gian vệ sinh/chuyển ca. Tạo hoặc cập nhật lịch chồng lấn bị từ chối.
- Hủy/hoàn, phân loại độ tuổi và cổng thanh toán thật chưa hỗ trợ trong bản demo; không được ngụ ý đã kiểm định.

## 4. Yêu cầu chức năng và acceptance

| ID | Yêu cầu | Tiêu chí chấp nhận |
|---|---|---|
| REQ-AUTH-01 | Đăng ký/đăng nhập | Dữ liệu sai bị từ chối; mật khẩu không trả về API; phiên cần xác thực cho thao tác đặt vé |
| REQ-AUTH-02 | Phân quyền | Guest bị từ chối thao tác cần đăng nhập; Customer bị từ chối admin/soát vé; Staff/Admin bị từ chối hold/order/user-initiated mock payment và đọc order/ticket; mỗi role chỉ dùng đúng chức năng |
| REQ-AUTH-03 | Đọc và cập nhật hồ sơ | `GET /api/auth/me` trả thông tin tài khoản đã xác thực nhưng không lộ mật khẩu; `PATCH /api/auth/me` chỉ cập nhật name/email, cần ít nhất một trường, không cho tự sửa role hoặc rạp được phân công |
| REQ-CAT-01 | Xem phim | Danh sách phim có tiêu đề, thông tin và CTA đến suất chiếu |
| REQ-CAT-02 | Tìm suất chiếu | Lọc theo phim, ngày và rạp; chỉ hiển thị suất còn hiệu lực |
| REQ-CAT-03 | Xem sơ đồ ghế | Ghế khả dụng/đang giữ/đã bán có nhãn truy cập được; không chỉ phân biệt bằng màu |
| REQ-CAT-04 | Ngăn lịch suất chiếu chồng lấn | Admin không thể tạo hoặc cập nhật suất chiếu để hai lịch trong cùng auditorium giao nhau hoặc cách nhau dưới 20 phút; lịch cách nhau đủ buffer được chấp nhận |
| REQ-BOOK-01 | Tạo hold | Chỉ Customer tạo được hold; hold thành công trả thời hạn, ghế và tổng giá; quá 8 ghế hoặc ghế không khả dụng bị từ chối |
| REQ-BOOK-02 | Chống bán trùng | Nhiều yêu cầu đồng thời cùng ghế cho tối đa một hold/sale; phần còn lại `409` |
| REQ-BOOK-03 | Hết hạn hold | Sau 5 phút ghế giải phóng theo đồng hồ backend; hold hết hạn không thể checkout |
| REQ-OPS-01 | Thu hồi hold và đối soát callback muộn | Worker định kỳ hết hạn hold/đơn đang chờ và giải phóng claim an toàn, có thể chạy lặp; callback thanh toán thành công hợp lệ đến sau hạn tạo outbox idempotent và hồ sơ đối soát thủ công, không tự xác nhận đơn hoặc hoàn tiền |
| REQ-BOOK-04 | Tạo đơn | Chỉ Customer tạo order từ hold còn hiệu lực; tổng tiền khớp giá server; thao tác idempotent |
| REQ-PAY-01 | Thanh toán demo | Chỉ Customer gọi endpoint tự hoàn tất cho đơn của mình; thành công xác nhận đơn và phát vé; thất bại không phát vé; không có dữ liệu thẻ |
| REQ-PAY-02 | Xử lý lặp | Retry thanh toán cùng đơn không tạo vé/giao dịch logic trùng |
| REQ-TICKET-01 | Xem vé | Customer chỉ xem vé thuộc đơn mình; vé chứa mã QR demo và thông tin suất/ghế |
| REQ-TICKET-02 | Soát vé | Staff/Admin soát một lần; lần tiếp theo trả trạng thái đã dùng; Customer không được soát |
| REQ-TICKET-03 | Giới hạn Staff theo rạp | Cả check-in bằng ticket ID và QR đều chỉ cho Staff đã được phân công đúng rạp; Staff chưa phân công hoặc khác rạp nhận `403`; Admin được check-in ở mọi rạp |
| REQ-ADMIN-01 | Quản lý dữ liệu | Chỉ Admin được tạo/sửa phim và suất; dữ liệu sai trả lỗi có cấu trúc |
| REQ-REPORT-01 | Báo cáo doanh thu | Doanh thu chỉ tính theo đơn xác nhận; không tính đơn chưa thanh toán |
| REQ-REPORT-02 | Báo cáo lấp đầy | Admin xem số ghế bán / tổng sức chứa, số suất đang mở và phần trăm lấp đầy |
| REQ-API-01 | Health readiness API | `GET /api/health` trả `200` và trạng thái `ok` khi dịch vụ sẵn sàng |
| REQ-CONTRACT-01 | OpenAPI contract được kiểm tra tự động | `docs/openapi.yaml` phải lint hợp lệ bằng Redocly không có warning; CI chạy cùng quality workflow và fail khi contract/schema có lỗi |
| REQ-SEC-01 | Bảo vệ dữ liệu | Không lộ password/token; lỗi API không trả stack; log không chứa secret; nội dung quản trị có markup phải hiển thị an toàn như text trong UI |
| REQ-SEC-02 | Quét secret trong repository | `npm run scan:secrets` dùng Gitleaks v8.30.1 đã pin để quét Git history; command pass khi không phát hiện leak, findings làm gate thất bại; CI cấu hình cùng phiên bản và report không được lộ secret |
| REQ-A11Y-01 | Truy cập | Hành trình cốt lõi dùng được với bàn phím, nhãn rõ và focus dễ nhận biết; axe không có lỗi serious/critical trong scope |

## 5. Trạng thái đặt vé

`HELD → PAYMENT_PENDING → CONFIRMED`; hold/đơn có thể chuyển `EXPIRED`, payment có thể `PAYMENT_FAILED` hoặc `RECONCILIATION_REQUIRED`. Callback thành công hợp lệ đến sau khi đơn hết hạn không phát vé hay chiếm ghế; sự kiện được ghi vào outbox và tạo hồ sơ đối soát thủ công. Vé thuộc đơn xác nhận chuyển trạng thái `CHECKED_IN` sau lần soát đầu. Không cho phép trạng thái cuối quay lại `HELD`.

## 6. API bản demo

Backend prefix `/api`: auth gồm `POST /auth/register`, `POST /auth/login`, `GET/PATCH /auth/me`; catalog gồm `GET /movies`, `GET /cinemas`, `GET /showtimes`, `GET /showtimes/:id/seats`; booking/payment gồm `POST /holds`, `POST /orders`, `GET /orders/me`, `GET /orders/:id`, `POST /payments/mock/complete`, `POST /payments/mock/webhook`; ticket gồm `POST /tickets/:ticketId/check-in`, `POST /tickets/scan`; admin routes gồm CRUD phim/rạp/phòng/suất, sửa ghế, quản lý role và phân công rạp cho Staff, summary và occupancy report. Seat response có trạng thái `AVAILABLE/HELD/SOLD`; thời gian hold do server tạo. Mock payment nhận order ID, không nhận thẻ. Staff check-in bị giới hạn theo `assignedCinemaId`; Admin check-in toàn cục. Thành công, validation, unauthenticated, forbidden, not found, conflict và server error phải giữ contract JSON ổn định.

Tài khoản seed: `customer@cinema.local` / `CinemaCustomer123!`, `staff@cinema.local` / `CinemaStaff123!`, `admin@cinema.local` / `CinemaAdmin123!`. Chỉ dùng trong môi trường demo cục bộ; không dùng tài khoản thật.
