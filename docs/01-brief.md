# PaceWise — Brief

**Mã đề:** EDU-01 · **Đội:** P-008 · **Cập nhật:** 24/09/2026

## Bài toán

Canvas cho sinh viên biết **có việc gì và hạn khi nào**, nhưng chưa biến deadline thành kế hoạch tuần phù hợp với quỹ thời gian và mức độ hiểu bài. Khi một nhiệm vụ kéo dài hoặc kiến thức nền chưa vững, sinh viên thường phát hiện quá muộn, không biết dời việc nào và có thể làm vỡ cả kế hoạch tuần.

Khảo sát thăm dò 17 sinh viên ghi nhận nhu cầu về lịch, nhắc deadline, cảnh báo nguy cơ và gợi ý phần chưa nắm chắc; mẫu chỉ dùng để định hướng MVP.

## Người dùng mục tiêu

- **Sinh viên:** cần biết việc tiếp theo, kế hoạch còn khả thi không và phần vừa học đã hiểu tới đâu.
- **Giảng viên/cố vấn:** cần thấy sớm điểm nghẽn tiến độ và đơn vị kiến thức cần hỗ trợ qua dữ liệu tổng hợp.

## Giải pháp

PaceWise là trợ lý học tập theo chu trình **Plan–Do–Reflect**, giúp sinh viên tự điều chỉnh thay vì chỉ nhắc việc.

- **Plan:** đọc dữ liệu Canvas, chia assignment thành milestone và kiểm tra quỹ thời gian, phụ thuộc, deadline.
- **Do:** ghi nhận thời gian thực tế và trả lời từ tài liệu môn học có trích dẫn.
- **Check trong Do:** dùng 1–3 câu đã duyệt để thu bằng chứng theo một đơn vị kiến thức.
- **Recover trong Do:** tạo 2–3 phương án khi tiến độ lệch; sinh viên xác nhận trước khi đổi lịch.
- **Reflect:** so sánh dự kiến–thực tế, tìm nguyên nhân và chọn một điều chỉnh cho tuần sau.
- **Giảng viên:** duyệt rubric, xem xu hướng tổng hợp và xử lý ca cần người xem.

MVP luôn chạy bằng dữ liệu Canvas mô phỏng. Canvas REST chỉ đọc chỉ bật khi có sandbox/token; LTI 1.3 là P1 khi trường cấp developer key.

## Vì sao cần AI và điểm mới

Điểm khác biệt là vòng kín **tiến độ → bằng chứng hiểu bài → hành động tiếp theo**. LLM chia nhỏ nhiệm vụ, xử lý câu trả lời mở và hỗ trợ phản tư; code kiểm tra quyền, deadline, xung đột, trích dẫn và audit.

PaceWise tham khảo “check for understanding” nhưng chỉ pilot một môn và 3–5 đơn vị kiến thức; mục tiêu và rubric do giảng viên/SME duyệt. Kết quả là bằng chứng kèm độ tin cậy, không phải điểm; ca không chắc chắn được chuyển cho giảng viên.

## Không làm trong MVP

- Không làm hộ, nộp bài, chấm điểm chính thức hoặc ghi điểm lên Canvas.
- Không đánh giá toàn bộ môn/ngành hay triển khai cấp trường.
- Không xếp hạng, kỷ luật hoặc tự động gắn nhãn “yếu/kém”.
- Không tự đổi lịch, gửi hỗ trợ cá nhân hoặc chia sẻ dữ liệu khi chưa có xác nhận.

## Đo thành công

Đây là **mục tiêu pilot, chưa phải kết quả đã đạt**. Ba bộ đánh giá độc lập đều có ít nhất 120 mẫu.

- **Sản phẩm:** nộp đúng hạn tăng ≥10 điểm phần trăm; ≥70% ca nguy cơ còn khả thi được phục hồi trước deadline; sai số dự kiến–thực tế giảm ≥20%; ≥60% bằng chứng dẫn tới hành động tiếp theo.
- **Plan/Recover:** ≥95% kế hoạch đúng ràng buộc; ≥90% ca có nghiệm bảo vệ deadline quan trọng.
- **Hiểu bài:** câu hỏi/đáp án hợp lệ ≥95%; bám mục tiêu ≥90%; chẩn đoán macro-F1 ≥0,80 so với nhãn chuyên gia.
- **Nguồn và liêm chính:** trích dẫn hợp lệ ≥95%; từ chối đúng khi thiếu nguồn ≥90%; đáp án làm hộ ≤5%; chặn nhầm ≤10%.
