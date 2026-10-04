# Thiết kế lại tab Plan: gọn, rõ, dễ thao tác

Ngày: 04/10/2026 · Trạng thái: đã triển khai workspace lịch kéo-thả và Plan Agent; đang chờ kiểm chứng usability với sinh viên.

## 1. Vấn đề cần giải quyết

Mentor nhận xét tab Plan có giao diện nặng, nhiều chức năng xuất hiện cùng lúc và khó xác định việc cần làm. Mục tiêu của đợt redesign là giảm lượng thông tin phải đọc, giảm thao tác lặp và giúp sinh viên sử dụng kế hoạch hằng ngày.

Pain point sản phẩm vẫn là: biến deadline nhiều môn thành kế hoạch phù hợp với thời gian của sinh viên. Tab Plan cần trình bày kết quả đó bằng ba câu hỏi dễ hiểu:

1. Tôi sẽ học việc gì, vào lúc nào?
2. Có bài nào chưa được xếp đủ thời gian trước hạn?
3. Tôi cần bấm đâu để tạo hoặc điều chỉnh kế hoạch?

Phạm vi được gom vào một workspace Plan duy nhất. Lịch kéo-thả là đầu vào của Agent; scheduler giữ các block sinh viên đã ghim, xếp phần còn lại và chỉ áp dụng sau khi sinh viên xác nhận.

## 2. Vướng mắc ở giao diện hiện tại

Nhận xét dưới đây dựa trên source local; chưa phải kết quả quan sát người dùng hoặc đo hiệu năng runtime.

| Vị trí | Điều đang làm giao diện nặng | Quyết định redesign |
|---|---|---|
| Plan chính | Lịch tuần và lịch dự kiến tuần sau cùng được render khi có dữ liệu | Mỗi lần xem một tuần; tuần sau chỉ mở khi chọn và ghi rõ “Dự kiến” |
| Cột phụ Plan | Tóm tắt, lịch sử phiên bản, danh sách “Nên làm trước” và cảnh báo cạnh tranh sự chú ý | Bỏ cột phụ; chuyển thành một dòng trạng thái và các chi tiết mở theo nhu cầu |
| Danh sách ưu tiên | Hiển thị toàn bộ task đã có block, trùng với lịch và có thể rất dài | Gộp việc tiếp theo vào agenda, đánh dấu một phiên sắp tới; không tạo thêm danh sách lặp |
| Header và banner | “Tạo kế hoạch mới”, “Mở bản xem trước”, “Phục hồi” cùng xuất hiện | Chọn một nút chính theo trạng thái; hành động phụ dùng liên kết hoặc menu có nhãn |
| Form tạo kế hoạch | Ba bước nhập/xác nhận rồi thêm một trang preview | Bỏ wizard khỏi luồng chính; kéo task/lịch bận trực tiếp vào lịch tuần |
| Preview | Lịch, quỹ thời gian, thứ tự ưu tiên, lý do và giả định đều có khối riêng | Preview nằm ngay trên workspace; “Xác nhận” chỉ bật sau khi Agent kiểm tra |

Source tham chiếu: [PlanPage](../frontend/pacewise/src/pages/student/PlanPage.tsx), [PlanCalendarBoard](../frontend/pacewise/src/components/domain/PlanCalendarBoard.tsx), [planning.py](../src/services/planning.py).

“Nặng UI” ở đây chủ yếu là mật độ thông tin và gánh nặng thao tác. Chưa có bằng chứng để kết luận RAM, bundle hay API chậm; các vấn đề hiệu năng cần đo riêng.

## 3. Tham khảo ứng dụng nào, lấy phần gì?

Chọn Shovel làm nguồn tham khảo về bài toán học tập. Với mục tiêu làm UI nhẹ hơn, kết hợp cách tổ chức theo ngày và thao tác xem trước; bố cục cuối cùng của PaceWise phải được kiểm chứng bằng thử nghiệm sử dụng.

| Nguồn | Cơ chế tham khảo | Áp dụng chọn lọc vào PaceWise |
|---|---|---|
| [Shovel](https://shovelapp.io/) | Chuyển hạn nộp thành thời điểm làm, ước lượng việc và phát hiện thiếu thời gian | Hiện bài + giờ học; cảnh báo cụ thể “DS201 thiếu 60 phút trước hạn” |
| [Canvas Planner](https://developerdocs.instructure.com/services/canvas/resources/planner) | Tập hợp planner item và ghi chú theo ngày | Dùng danh sách theo ngày làm bố cục mặc định, có môn học và liên kết bài gốc |
| [MyStudyLife](https://mystudylife.com/) | Tổ chức lịch học, bài tập và kỳ thi | Dùng nhãn quen thuộc với sinh viên; phân biệt buổi học, buổi tự học, hạn nộp |
| [Reclaim Preview](https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview) | Xem thay đổi trước khi áp dụng | Một màn hình preview, nhãn “Chưa lưu”, một lần xác nhận cuối |
| [Motion](https://www.usemotion.com/help/time-management/auto-scheduling) | Xếp task theo thời lượng, deadline, ưu tiên và lịch rảnh | Để hệ thống tính lịch; chỉ hỏi sinh viên dữ liệu cần thiết và phần còn thiếu |
| [Khanmigo](https://www.khanmigo.ai/) | Trợ lý học tập và giảng dạy | Tham khảo cho tab Học tập; không đưa thêm tutor/chat vào màn hình Plan |

Đây là các nguyên tắc được chọn từ tài liệu sản phẩm công khai, không phải kết quả đánh giá trực tiếp toàn bộ UI của sáu ứng dụng. Không dùng bảng để khẳng định đối thủ thiếu tính năng hoặc PaceWise tốt hơn.

Lưu ý khi vận dụng: Preview nói trên thuộc Reclaim 2.0. Motion mô tả trường hợp hard deadline có thể xếp ngoài giờ thông thường; PaceWise phải giữ giới hạn giờ học do sinh viên cho phép. Không sao chép toàn bộ hành vi hoặc bộ tính năng của sản phẩm tham khảo.

## 4. Bố cục đích: một workspace lịch tuần, thao tác trực tiếp

### Màn hình Plan

```text
[icon Plan] [icon Do] [icon Cài đặt] [icon LMS] [icon Đăng xuất]

PLAN                    [‹] [Hôm nay] [›] [+ Study block] [AI lập kế hoạch]
Trạng thái bản nháp · số block · tổng thời lượng · phần thiếu capacity

MÔN HỌC / NHIỆM VỤ      T2       T3       T4       T5       T6       T7       CN
CS101                    ┌──────────────── lịch giờ 07:00–23:00 ───────────────┐
  Mini project  ↔        │ LMS: chỉ đọc                                         │
DS201                    │ Study block: kéo để dời, xóa trong bản nháp          │
  Quiz tuần 4   ↔        │ Lịch cá nhân: kéo từ thanh trái                      │
Lịch cá nhân   ↔        └──────────────────────────────────────────────────────┘

                         [AI phân tích lại] [Xác nhận]
```

Số liệu trong wireframe chỉ minh họa, không phải output thực tế.

Quy tắc trình bày:

- Desktop dùng thanh input hẹp bên trái và lịch tuần là phần chiếm diện tích chính; mobile cho cuộn ngang lịch nhưng mọi thao tác vẫn có nút thay thế.
- Không đặt thêm card “Ba việc tiếp theo” hoặc dashboard KPI cạnh lịch.
- Kéo task vào lịch tạo block ghim; kéo block đổi giờ. Click task hoặc nút “Study block” là phương án thay thế không phụ thuộc drag-and-drop.
- Sau mọi thay đổi thủ công, nút xác nhận bị khóa cho tới khi Agent phân tích lại.
- Tên bài, môn và giờ bắt đầu–kết thúc là thông tin chính. Hạn nộp xuất hiện như một mốc, không giả thành buổi học.
- Mở một buổi để xem chi tiết và thao tác “Bắt đầu học” hoặc “Mở bài trên LMS”. Timer sử dụng luồng Do hiện có.
- Giữ nhãn chữ “Lịch môn học”, “Tự học”, “Hạn nộp”; màu chỉ hỗ trợ phân biệt.
- Tối đa một banner cảnh báo tổng hợp. Nếu nhiều bài bị ảnh hưởng, ghi số lượng và liên kết mở danh sách đầy đủ; không che mất các bài chưa có block.
- Dạng lưới là lựa chọn xem trong Plan; không thêm tab Calendar. Cả hai chế độ dùng cùng dữ liệu và cùng tuần.
- Dùng giờ 24 giờ, tên nút tiếng Việt cụ thể, hạn chế thuật ngữ như capacity, drift, canonical, version trên màn hình chính.

### Giữ, thu gọn, chuyển và bỏ khỏi màn hình chính

| Thành phần | Cách xử lý | Nơi truy cập |
|---|---|---|
| Lịch LMS và buổi tự học | Giữ, gộp theo ngày | Agenda chính |
| Tuần đang xem | Giữ, ghi khoảng ngày rõ ràng | Header |
| Trạng thái khả thi | Giữ một dòng, cảnh báo khi cần | Trên agenda |
| Cần học / Có thể học / Đã xếp / Chưa xếp | Thu gọn, cùng một phạm vi tuần | “Chi tiết” và preview |
| Toàn bộ nhiệm vụ, kể cả chưa được xếp | Thu gọn, tìm kiếm/lọc khi mở | “Chi tiết” → “Nhiệm vụ trong kế hoạch” |
| Lý do ưu tiên, estimate, hạn nộp đầy đủ | Hiện theo task | Chi tiết nhiệm vụ |
| Giờ rảnh, lịch bận và sở thích học | Chuyển vào form chỉnh sửa | “Điều chỉnh kế hoạch” |
| Tuần sau từ Recover | Xem riêng, nhãn “Dự kiến — chưa cam kết” | Chọn tuần sau |
| Lịch sử phiên bản | Bỏ card riêng | Menu “Tùy chọn” → “Lịch sử” |
| Ba phương án Recover | Giữ tại Phục hồi | Liên kết từ cảnh báo Plan |
| KPI pilot, baseline, biểu đồ tiến độ | Đặt tại nơi đánh giá/tiến độ phù hợp | Không thêm vào Plan |
| Chat dài, Reflect, ngân hàng câu hỏi | Giữ ở chức năng tương ứng | Không nhúng vào Plan |

## 5. Hành động theo trạng thái

“Nút chính” là nút có độ nổi bật cao nhất. Các liên kết xem, sửa và quay lại vẫn truy cập được.

| Trạng thái | Nội dung ưu tiên | Nút chính |
|---|---|---|
| Chưa có plan, chưa có draft | Lịch LMS và task từ thanh trái | Kéo task hoặc AI lập kế hoạch |
| Có thay đổi thủ công chưa kiểm tra | Lịch chứa các block đã ghim | AI phân tích lại |
| Có draft Agent đã kiểm tra | Lịch preview và phần thiếu capacity | Xác nhận |
| Có plan đang áp dụng | Lịch tuần hiện tại | Kéo để điều chỉnh hoặc AI lập lại |
| Có plan bị xung đột/thiếu giờ, không có draft | Tóm tắt ảnh hưởng, liên kết xem task | Xem cách điều chỉnh → Recover |
| Tuần sau chỉ có block dự kiến | Nhãn dự kiến và phần cần kiểm tra | Chuẩn bị kế hoạch tuần này |
| Đang xem lịch sử | Lịch đã lưu, trạng thái chỉ đọc | Về tuần hiện tại |

Mọi thao tác kéo, thêm hoặc xóa làm draft trở lại trạng thái “cần AI kiểm tra”; nút Xác nhận bị khóa cho tới khi phân tích hoàn tất.

## 6. Rút gọn luồng tạo và chỉnh sửa

### Một workspace thay cho wizard

1. LMS nạp môn, task, deadline và sự kiện cố định vào workspace.
2. Sinh viên kéo task hoặc lịch cá nhân vào tuần; block này được đánh dấu là lựa chọn cần giữ.
3. Plan Agent chia milestone; deterministic scheduler giữ block đã ghim và xếp workload còn lại.
4. Workspace chuyển thành preview, hiện phần thiếu capacity và mở nút Xác nhận.

### Những lần sau

Nạp lại kế hoạch và dữ liệu đã lưu ngay trên lịch. Sinh viên kéo block để đổi giờ, xóa block hoặc thêm lịch bận; không phải nhập lại lịch LMS.

Thêm khoảng bận chỉ cần thời gian; ghi chú là tùy chọn. Sửa dữ liệu giữ nguyên input khi chuyển bước hoặc gặp lỗi. Khi dữ liệu mới chưa được lưu đồng bộ, thông báo đúng trạng thái lưu thực tế.

### Preview đủ để quyết định

Preview dùng chính lịch đang mở, một dòng trạng thái và một nút xác nhận; không điều hướng sang trang riêng.

- Khi sửa plan: ghi “Dự kiến dời 2 buổi, thêm 1 buổi”; mở để xem trước/sau. Chỉ dùng “Đã dời” sau khi lưu thành công.
- Nếu thiếu thời gian: hiện task, số phút thiếu, deadline và đường dẫn sửa giờ học/thời lượng. Cho phép “Lưu phần đã xếp” với cảnh báo rõ; không báo kế hoạch khả thi toàn bộ.
- Nếu không có buổi hợp lệ: hiển thị cách bổ sung dữ liệu, không ghi đè plan bằng lịch rỗng.
- Đang lưu: nút có trạng thái chờ và ngăn bấm lặp. Lưu lỗi: giữ draft, hiện “Thử lại”. Hủy: trở về plan đang áp dụng.
- Lưu thành công: trở về đúng tuần vừa lưu và hiển thị cập nhật; không bắt người dùng tự tìm lịch mới.

## 7. Ranh giới chức năng để Plan giữ gọn

Plan sở hữu việc tạo, xem và chỉnh kế hoạch. Do sở hữu timer, hỗ trợ học có nguồn và actual time. Recover và Reflect vẫn là workflow nền được kích hoạt theo trạng thái; không cần chiếm tab chính.

Những điều phải giữ đúng khi giản lược UI:

- Tổng hợp đa môn; lọc môn chỉ đổi phần đang xem, không tách quỹ thời gian chung.
- Plan theo tuần Thứ Hai–Chủ Nhật. Nhìn trước 14 ngày để nhận biết deadline; tuần sau dự kiến không cộng vào cam kết tuần hiện tại.
- Kiểm tra thiếu giờ trước từng deadline; tổng tuần dư giờ không đồng nghĩa đủ giờ cho mọi bài.
- Lịch môn học chỉ đọc; buổi tự học không được trùng lịch bận, nằm trong quá khứ hoặc sau deadline.
- Backend vẫn là nguồn lịch chuẩn. Thiếu dữ liệu hiển thị “Chưa đủ dữ liệu”; không thay bằng số 0 giả.
- Thay đổi lịch cần preview và xác nhận. Thu gọn phần giải thích không đồng nghĩa bỏ bước xác nhận.

Đợt redesign không biến LLM thành bộ xếp giờ. Agent phân rã và giải thích; scheduler là nguồn chuẩn cho vị trí block và feasibility.

## 8. Kế hoạch triển khai

| Thứ tự | Công việc | Kết quả review được |
|---|---|---|
| 1 | Chụp/ghi lại các trạng thái Plan hiện tại và số thao tác với cùng dữ liệu | Mốc so sánh trước–sau; biết rõ phần nào đang gây rối |
| 2 | Áp dụng workspace lịch tuần, thanh task gọn và navigation icon-only | Lịch là trọng tâm; chức năng không liên quan không cạnh tranh chú ý |
| 3 | Gộp danh sách trùng, chuyển chi tiết vào đúng điểm mở | Vẫn tìm được task chưa xếp, lý do và lịch sử khi cần |
| 4 | Thay wizard bằng kéo/thả và modal thay thế | Chỉnh task/lịch bận ngay tại nơi nhìn thấy kết quả |
| 5 | Preview tại chỗ, khóa xác nhận trước khi Agent kiểm tra | Người dùng biết lịch nào đang áp dụng và thay đổi nào chưa lưu |
| 6 | Kiểm tra desktop/mobile/bàn phím, luồng dữ liệu và thử với sinh viên | Có bằng chứng UI dễ dùng hơn trước khi chốt |

Không thêm thư viện calendar nặng; grid tuần và drag-and-drop dùng API trình duyệt, modal vẫn bảo đảm thao tác bằng bàn phím/cảm ứng.

## 9. Cách nghiệm thu đúng vấn đề mentor góp ý

Dùng cùng tài khoản, dữ liệu ba môn và nhiệm vụ cho bản cũ/bản mới. Thử ban đầu với 5–8 sinh viên, đổi thứ tự trải nghiệm giữa các người thử để giảm ảnh hưởng do đã quen bài. Ghi thời gian, số lần bấm, lỗi và chỗ phải hỏi trợ giúp; các mốc dưới đây là mục tiêu đề xuất, chưa phải kết quả.

| Bài thử | Mục tiêu |
|---|---|
| Mở Plan, tìm buổi tự học tiếp theo và thời gian | Ít nhất 80% người thử tìm được trong 10 giây, không cần hướng dẫn |
| Tìm bài chưa được xếp đủ giờ | Trong 15 giây; mở được cả nhiệm vụ chưa có block |
| Sửa một tối bận với lịch rảnh đã lưu | Không nhập lại dữ liệu; tối đa ba lần chuyển màn hình từ Plan tới preview |
| Đọc preview và chỉ ra lịch đã lưu hay chưa | Mọi người thử phân biệt đúng; hủy không làm đổi lịch |
| Xem lịch sau khi xác nhận | Trở về đúng tuần, nhận ra thay đổi mà không phải đi tìm tab khác |
| So sánh khối lượng thao tác | Trung vị số lần bấm giảm ít nhất 30% cho tác vụ chỉnh một ngoại lệ; đo mốc cũ trước |
| Dùng màn hình 390 px và bàn phím | Lịch cuộn ngang có chủ đích; thêm block, phân tích và lưu được mà không phụ thuộc kéo-thả |
| Thử thiếu dữ liệu, API lỗi, xung đột và bản nháp cũ | Có cách xử lý rõ, giữ input, không báo lưu thành công sai |

Các tiêu chí giao diện kiểm tra trực tiếp: một nút chính mỗi màn hình; một tuần đang xem; tối đa một banner tổng hợp; không có danh sách task lặp bên cạnh agenda; chi tiết kỹ thuật không chiếm chỗ mặc định. Panel/dialog phải có nhãn, quản lý focus và trả focus về nút mở.

Khi triển khai chạy typecheck/build và test tương tác cho chọn tuần, tiếp tục draft, chỉnh giờ, hủy/lưu/lỗi. Giữ các test lịch và deadline hiện có; chỉ bổ sung backend test nếu có thay đổi logic. Không dùng coverage hay test pass thay cho việc quan sát người dùng.

Câu trình bày với mentor: “Nhóm thu gọn Plan về một lịch tuần dễ đọc, cho biết việc tiếp theo và bài thiếu thời gian. Cấu hình và giải thích mở theo nhu cầu; chỉnh sửa được xem trước và xác nhận một lần. Nhóm đo thời gian thao tác và mức hiểu đúng trước–sau để kiểm chứng.”
