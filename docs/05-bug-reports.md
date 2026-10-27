# Bug reports và kết quả retest

| ID | Mức độ | Cách tái hiện | Kỳ vọng | Thực tế / xử lý / retest |
|---|---|---|---|---|
| BUG-001 | P1 | Đăng ký customer → chọn suất và ghế còn trống → giữ ghế → checkout → hoàn tất demo payment thành công. | Trạng thái thành công/vé tiếp tục hiển thị để khách mở vé. | `hold=null` sau payment làm modal success bị unmount. Đã tách trạng thái xác nhận khỏi hold; retest journey Playwright đạt trên Chromium desktop và Pixel 7. |
| BUG-002 | P2 | Mở trang khám phá; chạy axe và kiểm tra accessible name của logo/áp phích phim. | Tên accessible phải khớp nội dung/nhãn người dùng thấy. | Axe báo `label-content-name-mismatch`. Đã sửa accessible name; retest axe ở discovery, seat map và checkout không có serious/critical trên hai project. |
| BUG-003 | P2, cấu hình test | Chạy Playwright qua Vite dev server trong khi bật CSP `script-src 'self'`; React plugin chèn preamble inline. | React app phải render và các E2E tiếp tục chạy khi kiểm tra security headers. | CSP chặn preamble React Refresh và ứng dụng không render. Đã giới hạn security headers vào built preview; E2E header test kiểm tra build tại port 5174, còn dev server phục vụ browser E2E. Retest toàn suite đạt 24/24. |
| SEC-OBS-01 | Low-confidence scanner observation, đã triage cho UI đã test | ZAP authenticated scan trên database DAST dùng tài khoản Admin; scanner ghi `<script>alert(1);</script>` vào trường cinema rồi đọc `/api/admin/cinemas` và `/api/cinemas`. | API trả JSON; UI phải render nội dung quản trị như text, không parse markup. | ZAP báo `Cross Site Scripting Weakness (Persistent in JSON Response)` ở 3 trường, Low/Low confidence vì response không phải HTML. Payload xuất hiện lại trong JSON. `TC-E2E-11` đạt trên desktop/mobile: `<img onerror>` payload hiển thị như text và không tạo node `img`/`script` trong hàng cinema. Không xác nhận script thực thi ở UI này; API consumers khác vẫn phải escape JSON data. Không có Critical/High trong scan. |

## Kết quả scan bảo mật

- ZAP API unauthenticated: High 0, Medium 0, Low 0, Informational 1 (`User Agent Fuzzer`).
- ZAP API authenticated: High 0, Medium 0, Low 1 (`SEC-OBS-01`), Informational 1 (`User Agent Fuzzer`).
- ZAP built frontend preview: High 0, Medium 0, Low 0, Informational 1 (`Modern Web Application`).
- `npm run scan:secrets` dùng Gitleaks v8.30.1 đã pin: exit 0, quét 1 commit/~706 KB, không phát hiện leak. Log và report redacted: `reports/generated/final-gitleaks-results.log`, `reports/generated/final-gitleaks.json`.
- CI đã cấu hình Gitleaks Action v3 cùng phiên bản v8.30.1; chưa có GitHub Actions remote run.
- Các scan là active scan cục bộ trên fixture dùng một lần; không phải đánh giá OWASP toàn diện hoặc kết quả staging/production. Report JSON/HTML nằm trong `reports/generated/dast/`.

Không có token, mật khẩu, QR token hay dữ liệu người dùng thật trong tài liệu này. Artifact cuối và giới hạn được liệt kê tại `docs/evidence/final/manifest.json`.
