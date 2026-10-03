# Đánh giá workflow sinh viên cho pain point deadline

**Ngày chạy lại:** 03/10/2026
**Môi trường:** Docker local, PaceWise API + PostgreSQL + LMS Simulator
**Kịch bản tái lập:** `scripts/evaluate_student_deadline_workflow.py`

## Kịch bản

Sinh viên có ba deadline thuộc ba môn:

| Môn | Nhiệm vụ | Deadline | Thời lượng còn lại | Trọng số nhóm |
|---|---|---:|---:|---:|
| CS101 | Mini project: Quản lý thư viện | 03/10/2026 | 240 phút | 60% |
| DS201 | Phân tích xu hướng | 05/10/2026 | 240 phút | 60% |
| PM102 | Sprint retrospective | 06/10/2026 | 180 phút | 60% |

Đầu vào cá nhân:

- Rảnh `08:00–23:00`, ưu tiên chiều và tối.
- Hai khoảng bận cá nhân và chín khoảng bận từ LMS.
- Sau khi tạo kế hoạch, ghi nhận 30 phút học.
- Phát sinh việc đi bệnh viện `12:00–13:30`, trùng một study block 90 phút.

## Kết quả sau khi sửa

### Plan

- Tạo đủ `660/660` phút trong 9 study block.
- Không trùng lịch bận và không có block sau deadline.
- 72,7% thời lượng nằm trong buổi chiều/tối theo sở thích.
- Backend trả thứ tự ưu tiên chính thức `CS101 → DS201 → PM102`.
- UI hiển thị thứ tự ưu tiên riêng; calendar vẫn sắp theo thời gian để người dùng theo dõi trong ngày.
- Xác nhận kế hoạch trả `status=completed`; Quality Gate đạt.
- Safety cho phép yêu cầu Plan hợp lệ, không còn thay câu trả lời bằng cảnh báo làm hộ bài.

### Tracking

- Trước sự cố: kế hoạch đủ capacity, chưa cần Recover.
- Sau khi thêm lịch bệnh viện: block xung đột bị loại khỏi capacity.
- Tracking phát hiện CS101 thiếu đúng 60 phút và trả `recover_recommended=true`.
- Deadline trong LMS sync và Agent context cùng dùng deadline hiệu lực từ Planner/override.

### Recover

- Phương án A cân bằng lại ba môn, bảo vệ deadline và tránh toàn bộ lịch bận.
- Mọi study block trong phương án thực thi đều từ ngày hiện tại trở đi.
- Cửa sổ Recover chạy từ hôm nay đến hết Chủ Nhật tuần sau; không tạo block ngoài hai tuần đang hiển thị hoặc sau deadline của nhiệm vụ.
- Phương án B chỉ bổ sung thời gian trống và báo trung thực khi chưa bù đủ.
- Phương án C giữ nguyên lịch để sinh viên có quyền từ chối thay đổi.
- Phần giải thích và dữ liệu calendar sử dụng cùng một bộ phương án.
- Chỉ áp dụng sau khi sinh viên xác nhận; lượt xác nhận trả `completed`.

## Đối chiếu sáu lỗi P0/P1

| Lỗi | Trạng thái | Evidence |
|---|---|---|
| Recover sinh block trong quá khứ | Đã sửa | `futureOnly=true` cho phương án thực thi |
| Xác nhận Plan bị Quality Gate đánh `failed` | Đã sửa | `confirmationStatus=completed`, quality passed |
| Tracking vẫn tính block bị xung đột | Đã sửa | `invalidated_block_count=1`, thiếu 60 phút |
| Guardrail chặn nhầm Plan/Recover | Đã sửa | input/output safety đều `allow` |
| Deadline Agent lệch LMS | Đã sửa | Cùng dùng Planner deadline hiệu lực |
| Timeline không thể hiện ưu tiên deadline | Đã sửa | Có danh sách ưu tiên chính thức riêng trên Plan |

## Kết luận

Luồng cốt lõi hiện giải quyết được pain point chính ở mức MVP thuyết phục:

> Tổng hợp deadline đa môn → lập lịch theo quỹ thời gian thật → nhận ra kế hoạch bị vỡ → đề xuất lịch mới khả thi → chỉ thay đổi sau khi sinh viên xác nhận.

Calendar giữ thứ tự thời gian, còn danh sách **Nên làm trước** giữ thứ tự học vụ. Hai khái niệm này không còn bị trộn lẫn.

Các phần ngoài phạm vi evidence này vẫn cần pilot thực tế: tỷ lệ nộp đúng hạn qua nhiều tuần, hiệu quả notification trên thiết bị thật và mức chấp nhận phương án Recover của sinh viên.

## Chạy lại

```powershell
.\.venv\Scripts\python.exe scripts\evaluate_student_deadline_workflow.py
```

Script gọi API giống frontend và không ghi đè workspace đã lưu của sinh viên.
