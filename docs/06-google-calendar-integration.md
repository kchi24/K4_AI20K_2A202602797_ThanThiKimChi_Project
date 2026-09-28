# Google Calendar integration

## Phạm vi MVP

Tích hợp này phục vụ trực tiếp luồng lập và phục hồi kế hoạch của PaceWise:

- đọc **busy/free** trong một khoảng tối đa 31 ngày, không đọc tiêu đề hay nội dung sự kiện;
- chuyển khoảng bận thành `UnavailableSlot` để agent tránh xếp study block trùng lịch;
- tạo study block trên lịch chính chỉ sau màn hình xác nhận của sinh viên;
- đồng bộ một chiều từ PaceWise sang Google Calendar;
- cho phép ngắt kết nối và thu hồi refresh token.

Hai OAuth scope được dùng:

```text
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.events.owned
```

## Cấu hình Google Cloud

1. Tạo hoặc chọn Google Cloud project.
2. Bật Google Calendar API.
3. Cấu hình OAuth consent screen.
4. Tạo OAuth Client loại **Web application**.
5. Thêm redirect URI chính xác:

```text
http://localhost:8000/api/v1/integrations/google-calendar/callback
```

6. Tạo khóa Fernet một lần:

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

7. Điền vào `.env` và không commit file này:

```dotenv
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_TOKEN_ENCRYPTION_KEY=<fernet-key>
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/integrations/google-calendar/callback
GOOGLE_OAUTH_SUCCESS_URL=http://localhost:5173/#/settings
```

Khi deploy, đổi cả hai URL sang HTTPS public URL và lưu client secret/khóa mã hóa trong secret manager.

## Bảo mật và HITL

- OAuth dùng `state` một lần, hết hạn sau 10 phút, gắn với user và PaceWise session.
- Authorization Code dùng PKCE S256.
- Refresh token được mã hóa bằng Fernet trước khi lưu PostgreSQL.
- Access token chỉ tồn tại trong backend trong thời gian request.
- Endpoint ghi sự kiện cần PaceWise session, CSRF token và `confirmed=true`.
- `(user_id, block_id)` là duy nhất nên gửi lại cùng một kế hoạch không tạo trùng.
- Audit log chỉ lưu loại hành động và số lượng; không lưu OAuth code hoặc token.
- Disconnect gọi Google revoke trước rồi mới xóa kết nối cục bộ.

## API

| Method | Endpoint | Mục đích |
|---|---|---|
| `GET` | `/api/v1/integrations/google-calendar/status` | Trạng thái cấu hình/kết nối |
| `POST` | `/api/v1/integrations/google-calendar/connect` | Tạo OAuth authorization URL |
| `GET` | `/api/v1/integrations/google-calendar/callback` | Nhận OAuth code và lưu refresh token mã hóa |
| `POST` | `/api/v1/integrations/google-calendar/freebusy` | Đọc khoảng bận và trả `UnavailableSlot` |
| `POST` | `/api/v1/integrations/google-calendar/events` | Tạo study block đã xác nhận |
| `DELETE` | `/api/v1/integrations/google-calendar` | Thu hồi token và ngắt kết nối |

Test tự động mock Google REST API; test không dùng tài khoản hoặc token thật.
