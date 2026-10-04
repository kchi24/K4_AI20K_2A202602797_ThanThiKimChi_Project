# PaceWise — Kế hoạch thiết kế lại tab Plan

Ngày: 04/10/2026 · Trạng thái: đề xuất triển khai, chưa phải chức năng đã hoàn thành.

## 1. Quyết định sản phẩm

Thiết kế lại tab **Kế hoạch** để sinh viên trả lời được: tuần này cần làm gì, có đủ thời gian trước từng deadline không, và nên thực hiện bước nào tiếp theo.

Chọn **Shovel làm tài liệu tham khảo chính về workload**, lấy cơ chế **xem trước/xác nhận của Reclaim** và nguyên tắc **xếp lịch theo ràng buộc của Motion**. Giao diện PaceWise được thiết kế riêng theo tác vụ sinh viên; không ghép toàn bộ chức năng của các sản phẩm.

Mục tiêu là một chức năng đủ tin cậy để dùng hằng ngày, có giao diện gọn và xử lý đầy đủ trạng thái lỗi. Đây là lựa chọn thiết kế cần kiểm chứng với người dùng, không phải kết luận đã tìm được phương án tối ưu nhất.

Tài liệu chỉ triển khai lại Plan và các điểm nối cần thiết với Do, Progress, Recover, Reflect. Không đổi toàn bộ navigation, xóa tab, mở rộng LMS Simulator hoặc xây lại dashboard giảng viên trong đợt này.

## 2. Pain point và kết quả cần đạt

Theo [Brief](01-brief.md), sinh viên có nhiều môn và deadline nhưng khó chuyển chúng thành kế hoạch phù hợp với thời gian thực tế. Khi việc kéo dài, các nhiệm vụ cạnh tranh cùng một khoảng rảnh và kế hoạch dễ bị vỡ.

Plan phải giúp sinh viên:

1. Thấy workload của tất cả môn trong cùng một kế hoạch.
2. Có study block cụ thể gắn với nhiệm vụ, thời điểm và thời lượng.
3. Biết nhiệm vụ nào chưa được bố trí đủ thời gian trước hạn.
4. Chỉnh giờ rảnh hoặc estimate mà không phải nhập lại từ đầu.
5. Xem thay đổi và xác nhận trước khi cập nhật lịch đã lưu.

Màn hình ít thành phần nhưng vẫn truy cập được toàn bộ nhiệm vụ, lịch LMS và chi tiết cảnh báo. Không đồng nhất việc thu gọn giao diện với bỏ thông tin cần ra quyết định.

## 3. Học chọn lọc từ sản phẩm tham khảo

| Sản phẩm | Cơ chế đáng học | Áp dụng vào Plan | Giới hạn phạm vi |
|---|---|---|---|
| Shovel | Chia task thành nhiều block; phân biệt đã xếp/chưa xếp; so workload với thời gian có thể học | Mỗi task có thời lượng còn lại, số phút đã xếp hợp lệ và số phút còn thiếu | Không bắt người dùng kéo từng task vào calendar hoặc dựng lịch cả học kỳ ngay từ đầu |
| Motion | Xếp lịch từ duration, deadline, priority, availability và chia phiên | Một scheduler backend chịu trách nhiệm phân bổ thời gian và kiểm tra xung đột | Không tự mở rộng giờ học để cứu deadline; báo thiếu thời gian nếu không có nghiệm |
| Reclaim | Preview thay đổi trước khi áp dụng; gợi ý việc cần chú ý | Bản nháp, danh sách thay đổi, xác nhận lưu; tối đa ba việc ưu tiên ở phần tóm tắt | Không xây trợ lý điều khiển toàn bộ calendar hay nền tảng agent mới |
| MyStudyLife | Quản lý lớp, bài tập, kỳ thi trong bối cảnh sinh viên | Dùng nhãn môn/bài/hạn nộp dễ hiểu, bố cục một cột trên mobile | Không lấy toàn bộ sản phẩm làm yêu cầu triển khai |
| Canvas Planner | Gom đối tượng học tập và ghi chú theo ngày | Dùng dữ liệu LMS và đường dẫn mở bài gốc; giữ sự kiện học vụ chỉ đọc | Không nhân bản quản lý course, bài tập, quiz vào PaceWise |
| Khanmigo | Trợ lý học tập và hỗ trợ giảng dạy | Tham khảo cho phần Học tập khi làm tiếp | Không phải mẫu thiết kế cho tab Plan |

Nguồn: [Shovel planning](https://help.shovelapp.io/en/tasks/plan-tasks), [Cushion](https://help.shovelapp.io/en/analytics/the-cushion), [Motion scheduling](https://www.usemotion.com/help/time-management/auto-scheduling), [Reclaim Preview](https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview), [MyStudyLife](https://mystudylife.com/), [Canvas Planner API](https://developerdocs.instructure.com/services/canvas/resources/planner), [Khanmigo](https://khanmigo.ai/).

Lưu ý phiên bản: [Reclaim 2.0 Tasks](https://help.reclaim.ai/en/articles/16558552-reclaim-2-0-tasks-overview) mô tả gợi ý task trong giờ tập trung, thay vì tự tạo calendar event cho từng task như luồng 1.0. PaceWise chỉ học Preview và cách làm nổi bật việc cần chú ý. Không coi bảng này là bằng chứng rằng đối thủ hoàn toàn thiếu một tính năng, hoặc PaceWise hiện đã vượt họ.

## 4. Điểm xuất phát trong repo

Đối chiếu source local ngày 04/10/2026; đây là đọc code, chưa phải kiểm thử UI/runtime trong đợt lập tài liệu này.

| File hiện có | Nhận xét từ source | Hướng sửa |
|---|---|---|
| [PlanPage.tsx](../frontend/pacewise/src/pages/student/PlanPage.tsx) | Render lịch tuần hợp nhất, lịch dự kiến tuần sau, tóm tắt, danh sách ưu tiên và cảnh báo cùng trang | Tách mức hiển thị mặc định/chi tiết; thu gọn tuần sau; chỉ hiện ba việc ưu tiên và nút xem tất cả |
| [PlanWizardPage.tsx](../frontend/pacewise/src/pages/student/PlanWizardPage.tsx) | Đã có chọn tuần, task, availability, unavailable và nhiều buổi yêu thích | Tái sử dụng dữ liệu đã lưu; mở chỉnh sửa từng nhóm thông tin thay vì yêu cầu nhập lại |
| [PlanPreviewPage.tsx](../frontend/pacewise/src/pages/student/PlanPreviewPage.tsx) | Đã có bản nháp, số liệu khả thi, chỉnh block và xác nhận | Làm rõ diff, phần chưa xếp được và trạng thái lưu; rà điều kiện xác nhận |
| [api.ts](../frontend/pacewise/src/services/api.ts) | Có generatePlan và confirmPlan | Giữ contract có thể tái sử dụng; bổ sung version/validation nếu hiện chưa đủ |
| [planning.py](../src/services/planning.py) | Có scheduler backend, feasibility và priority order | Dùng làm nguồn tính toán duy nhất; kiểm tra chính xác deadline theo giờ và thời điểm hiện tại |

Frontend hiện tự sort lại task trong PlanPage. Khi triển khai, chuyển sang dùng thứ tự/lý do chuẩn từ backend để tránh UI giải thích khác lịch thực tế.

## 5. Bố cục mới

Mặc định dùng agenda theo ngày. Calendar dạng lưới là chế độ xem tùy chọn ngay trong Plan, không mở thêm tab lịch riêng.

```text
KẾ HOẠCH                     [Tuần này / Tuần sau]
05–11/10 · Tất cả môn          [Điều chỉnh kế hoạch]

Còn cần học: 8 giờ · Có thể học: 10 giờ
Đã xếp: 7 giờ · Chưa xếp: 1 giờ

! DS201 thiếu 1 giờ trước hạn Thứ Tư
  [Xem chi tiết / Điều chỉnh]

NÊN LÀM TIẾP
CS101 · Viết phần nhập dữ liệu · 19:00–20:00
Hạn Thứ Ba · [Bắt đầu] [Vì sao?]
... tối đa 3 nhiệm vụ ...                 [Xem tất cả]

LỊCH TUẦN                     [Danh sách | Lưới lịch]
Thứ Hai — mở mặc định nếu đang là hôm nay
  14:00–15:30  Ca học DS201      [LMS · chỉ đọc]
  19:00–20:00  CS101 — phần 1    [Tự học]
Thứ Ba — thu gọn, hiện tổng thời lượng và mốc quan trọng
...
Tuần sau dự kiến — chỉ mở khi người dùng yêu cầu
```

Các con số trên là dữ liệu minh họa bố cục, không phải output đã chạy. Phần tóm tắt dùng cùng phạm vi thời gian với lịch đang xem.

Quy tắc giao diện:

- Một CTA chính theo trạng thái: Tạo kế hoạch / Tiếp tục bản nháp / Điều chỉnh kế hoạch.
- Đưa cảnh báo ảnh hưởng deadline lên trước danh sách; gộp cảnh báo trùng, có nút mở toàn bộ.
- Chỉ hiển thị ba việc ở mục ưu tiên; danh sách đầy đủ luôn truy cập được, bao gồm task chưa có block.
- "Nên làm tiếp" không khuyến khích học trong ca học hay khoảng bận hiện tại; khi không rảnh, hiện phiên khả dụng kế tiếp.
- Hôm nay mở sẵn; các ngày còn lại thu gọn. Deadline được thể hiện bằng mốc, không chiếm thời lượng như một ca học.
- Bộ lọc môn chỉ đổi dữ liệu đang xem, không tạo capacity riêng cho từng môn. Nhãn tổng hợp luôn ghi Tất cả môn.
- Chi tiết lý do, giả định estimate, lịch sử phiên bản và tuần sau chỉ xuất hiện khi mở thêm.
- Giờ 24 giờ, có múi giờ rõ ràng. Trên mobile dùng agenda một cột; thao tác được bằng bàn phím, không phụ thuộc kéo-thả hay màu sắc.
- Chưa đưa KPI pilot, chat dài, ba lựa chọn Recover hoặc biểu mẫu Reflect vào nội dung mặc định của Plan.

## 6. Luồng người dùng

### 6.1 Lần đầu

1. Hiển thị dữ liệu LMS đã đồng bộ và thời điểm đồng bộ thực tế.
2. Sinh viên chọn tuần, xác nhận các nhiệm vụ gợi ý; deadline chưa chọn vẫn xuất hiện trong cảnh báo.
3. Khai báo giờ có thể học, ngoại lệ bận, giới hạn mỗi ngày và một hoặc nhiều buổi yêu thích.
4. Kiểm tra estimate còn thiếu. Gợi ý của hệ thống phải có nhãn Ước lượng; không coi dữ liệu thiếu là 0 phút.
5. Bấm Tạo bản nháp, xem lịch và những phần chưa đủ thời gian.
6. Bấm Xác nhận và lưu. Chỉ báo thành công sau khi backend lưu được.

### 6.2 Khi đã có kế hoạch

Mở Plan → xem việc tiếp theo → Bắt đầu học hoặc Điều chỉnh kế hoạch. Màn hình chỉnh sửa nạp dữ liệu cũ; sinh viên chỉ sửa ngoại lệ, nhiệm vụ hoặc estimate cần đổi. Mỗi chỉnh sửa tạo bản nháp mới; lịch đang áp dụng còn nguyên cho đến xác nhận.

Nếu người dùng rời trang, lưu được input/bản nháp theo tài khoản; quay lại tiếp tục mà không tạo study block trùng. Nếu lưu thất bại, nói rõ input chỉ đang được giữ cục bộ, không hứa đã đồng bộ sang thiết bị khác.

### 6.3 Preview và xác nhận

Preview gồm lịch đề xuất, số block thêm/dời/gỡ, nhiệm vụ còn thiếu và lý do ngắn. Nhãn là Đề xuất dời trước xác nhận. Không cần chấm điểm lịch 88/100 hoặc bắt chọn ba phương án khi tạo Plan thông thường.

- Bản nháp đủ thời lượng: cho xác nhận.
- Bản nháp chỉ xếp được một phần: ghi Kế hoạch chưa đủ thời gian; cho chỉnh giờ/estimate hoặc chủ động Lưu phần đã xếp với cảnh báo rõ ràng. Không tuyên bố đã bảo vệ tất cả deadline.
- Không có block hợp lệ: cho lưu input, không thay kế hoạch hiện tại bằng lịch rỗng.
- Input thay đổi: bản nháp cũ hết hiệu lực, cần tính lại.
- LMS/kế hoạch đã đổi sau khi tạo bản nháp: backend kiểm tra version và dữ liệu mới, yêu cầu cập nhật preview trước khi lưu.

### 6.4 Nối với vòng học tập

Bắt đầu học chuyển tới timer gắn đúng task và block. Ghi thời gian/cập nhật workload làm mới Plan và Progress. Học đủ số phút không đồng nghĩa đã hoàn thành hoặc đã nộp bài; submission do LMS xác nhận.

Lịch bận/deadline thay đổi làm kế hoạch mất hiệu lực thì hiện cảnh báo có lối mở Recover. Reflect cung cấp đề xuất đã được sinh viên xác nhận cho bản nháp tuần sau; không bắt người dùng phản tư mới được tạo Plan.

## 7. Định nghĩa thời gian và số liệu

### 7.1 Phạm vi thống nhất

- Tuần kế hoạch: Thứ Hai 00:00 tới Thứ Hai kế tiếp 00:00 (mốc cuối loại trừ), mặc định Asia/Ho_Chi_Minh.
- Tuần hiện tại chỉ xếp từ thời điểm hiện tại; tuần sau chỉ xếp trong tuần đã chọn. Lưu timestamp có timezone và so với deadline đầy đủ giờ/phút.
- Look-ahead: từ hiện tại tới 14 ngày sau để phát hiện deadline liên quan; không ép hoàn thành toàn bộ workload xa hạn trong tuần đang chọn.
- Recover theo hai tuần lịch hiện tại/kế tiếp: từ hiện tại đến hết Chủ Nhật tuần sau, không phải lúc nào cũng đủ 14 ngày. Block dự kiến tuần sau chưa là cam kết tuần này.
- Xem tuần cũ là xem lịch sử; không dùng để tạo block mới.

### 7.2 Cách tính

| Nhãn UI | Ý nghĩa |
|---|---|
| Còn cần học | Tổng workload còn lại được phân bổ làm trong phần tương lai của tuần đang xem |
| Có thể học | Hợp các khoảng được phép học, trừ lịch LMS/lịch bận đã gộp chồng lấn, nghỉ và giới hạn ngày; không đếm cùng slot cho nhiều môn |
| Đã xếp | Thời lượng tương lai hợp lệ thực sự được phân bổ cho workload đó; loại block quá khứ/xung đột; không đếm thừa nếu task được xếp vượt nhu cầu |
| Chưa xếp | Tổng thiếu hụt của từng nhiệm vụ, không lấy thời gian xếp thừa bài A bù cho bài B |
| Chênh lệch thời gian | Có thể học − Còn cần học trong cùng phạm vi; chỉ là tổng quan, không chứng minh mọi deadline đều khả thi |

Phân biệt "thời gian chưa dùng" = capacity − thời gian đã xếp với "chênh lệch thời gian" = capacity − workload cần làm. Không gọi cả hai là buffer.

Với từng nhiệm vụ, cần đối chiếu workload còn lại với các block hợp lệ được cấp trước deadline. Cùng một slot không được bảo vệ hai assignment; kiểm tra tất cả môn cùng nhau, bao gồm nhiệm vụ chưa được chọn vào bản nháp.

Ví dụ: bài cần 2 giờ, hạn Thứ Tư 12:00; toàn bộ 10 giờ rảnh nằm từ Thứ Năm. Tổng tuần dư giờ nhưng bài vẫn thiếu 2 giờ trước hạn. UI phải cảnh báo, không tô xanh vì tổng capacity lớn.

Workload còn lại lấy từ estimate/progress đã lưu, cho sinh viên hiệu chỉnh. Sau một phiên học mà bài vẫn chưa xong, không tự đưa workload về 0 chỉ vì timer đã đạt estimate. Thiếu dữ liệu thì hiện Chưa đủ dữ liệu, không hiện 0 giờ hay 100%.

## 8. Quy tắc lập lịch và vai trò AI

Giữ một scheduler backend; không thêm agent, dịch vụ hay thư viện calendar nặng chỉ để đổi tab Plan.

Ràng buộc bắt buộc: block ở tương lai, nằm trong tuần đã chọn, không trùng block khác/lịch bận, không kết thúc sau deadline, tôn trọng giờ có thể học, giới hạn ngày và phụ thuộc đã biết. Exam/ca học có giờ cố định không bị dời bởi Plan. Thiếu giờ thì trả shortfall thay vì tự mở rộng giờ học hoặc bỏ nhiệm vụ.

Mặc định đề xuất phiên 30–120 phút và nghỉ 10 phút, nhưng không làm tròn workload 15 phút lên 30 phút hoặc bỏ luôn phần việc ngắn. Cho phép phiên cuối ngắn hơn nếu hợp lệ. Buổi yêu thích là ưu tiên mềm trong giờ đã cho phép học.

Thứ tự khởi đầu để triển khai: deadline đầy đủ timestamp → mức ưu tiên đã lưu → tín hiệu học vụ có thể so sánh → task ID để kết quả ổn định. Giờ rảnh là ràng buộc xuyên suốt, không phải tiêu chí đứng cuối.

Trọng số nhóm bài do giảng viên cấu hình. 30% là trọng số của cả nhóm, không phải mọi bài trong nhóm đều chiếm 30% điểm môn. Không so điểm thô 100 của môn A với 10 của môn B như giá trị học vụ tuyệt đối. Khi chưa chuẩn hóa được quy tắc tính điểm, trọng số chỉ là tín hiệu phụ trong cùng môn; giữa các môn ưu tiên deadline, workload và lựa chọn rõ ràng của sinh viên. Thiếu trọng số hiện Không có dữ liệu trọng số.

LLM có thể đề xuất milestone từ yêu cầu môn học và giải thích lịch. Backend kiểm tra tổng thời lượng, thời điểm, quyền và nguồn dữ liệu. Không để LLM tự tính feasibility hay đưa lời giải thích trái với scheduler. Khi LLM lỗi, nếu đủ task/duration thì dùng lịch deterministic kèm thông báo phù hợp; không tạo output giả.

## 9. Yêu cầu dùng thật, giữ phạm vi gọn

- Backend xác định user/course được phép từ session, không tin danh tính hoặc deadline/trọng số client gửi.
- Kế hoạch, input, bản nháp cần lưu bền vững; giữ tách biệt draft và applied.
- Dùng version cho cập nhật; xác nhận lặp do double-click/retry không tạo lịch trùng.
- Khi xác nhận, kiểm tra lại với LMS snapshot mới nhất khả dụng. Nếu đồng bộ lỗi, hiển thị lastSync thật và không khẳng định dữ liệu hiện thời.
- Lưu audit tối thiểu: ai xác nhận, phiên bản nào, thời điểm, thay đổi nào; giữ được phiên bản trước để truy vết.
- Gọi lại API lỗi phải giữ input; hiển thị request ID, hành động thử lại và trạng thái lưu trung thực.
- Chặn request cũ về muộn ghi đè bản nháp mới khi đổi tuần hoặc chỉnh input liên tiếp.

Không mở thêm Scenario Lab, semester heatmap, energy model, optimizer nhiều thuật toán, tab Question Bank, ứng dụng mobile native hoặc chat điều khiển calendar trong đợt này. Những phần này không cần thiết để giải quyết vấn đề UI Plan hiện tại.

## 10. Trình tự triển khai

| Bước | Công việc | Điều kiện hoàn tất |
|---|---|---|
| 1. Chốt dữ liệu | Rà contract hiện có; thống nhất weekStart, timestamp, remaining workload, capacity, shortfall, priority và version | UI/Preview/Progress có cùng định nghĩa, không tự tính lịch riêng |
| 2. Sửa Plan chính | Tóm tắt ngắn; cảnh báo; ba việc ưu tiên; agenda thu gọn; chuyển đổi lịch tùy chọn | Thấy việc tiếp theo và task thiếu giờ mà không phải đọc lịch cả hai tuần |
| 3. Gọn luồng chỉnh sửa | Giữ dữ liệu tuần trước; chỉnh ngoại lệ; estimate thiếu có nhãn; giữ input khi lỗi | Sinh viên đang dùng không phải cấu hình lại từ đầu |
| 4. Preview và lưu | Diff, thiếu capacity, version, xác nhận bền vững và chống lặp | Chỉ thay đổi lịch khi backend xác nhận lưu thành công |
| 5. Nối vòng học tập | Timer/progress làm mới Plan; mở Recover đúng task/course; nhận đề xuất Reflect | Một thay đổi actual time thể hiện nhất quán ở các màn hình |
| 6. Kiểm chứng | Test ràng buộc/dữ liệu, UI hành trình, build và thử với sinh viên | Đạt tiêu chí bên dưới; cập nhật Brief/wireframe sau khi thống nhất và triển khai |

Tái sử dụng PlanPage, PlanWizardPage, PlanPreviewPage, CombinedSchedule, AppStore và planning.py. Chỉ tách component/hàm tính có trách nhiệm rõ; không viết lại toàn stack để đạt bố cục mới.

## 11. Acceptance criteria

| ID | Tình huống | Kết quả bắt buộc |
|---|---|---|
| AC01 | Ba môn cùng cần khung 19:00–20:00 | Mỗi phút được phân bổ một lần; không có block chồng nhau |
| AC02 | Tổng tuần dư giờ nhưng chỉ rảnh sau deadline | Task vẫn báo thiếu thời gian trước hạn |
| AC03 | Tạo plan lúc 15:30, bài hạn 17:00 | Không xếp trước 15:30 hoặc kết thúc sau 17:00 |
| AC04 | Không có estimate hoặc chưa nhận được LMS data | Hiện chưa đủ dữ liệu, không báo đã bảo vệ deadline |
| AC05 | Chọn chiều và tối, thêm ngoại lệ bận | Giữ cả hai lựa chọn; scheduler trừ đúng phần bận, không tính trùng |
| AC06 | Có nhiều assignment ngoài tuần/14 ngày | Mặc định ưu tiên đúng phạm vi; nhiệm vụ xa vẫn truy cập được, không nhồi cả năm vào tuần |
| AC07 | Tạo draft rồi hủy hoặc API lưu lỗi | Kế hoạch đang áp dụng không đổi, input/draft còn để thử lại |
| AC08 | Click xác nhận hai lần hoặc retry sau timeout | Một phiên bản kế hoạch được áp dụng; refresh thấy đúng bản backend |
| AC09 | Deadline/lịch bận đổi khi đang xem draft | Kiểm tra lại trước xác nhận; preview cũ không ghi đè dữ liệu mới |
| AC10 | Chỉ xếp được một phần workload | Ghi rõ task/phút thiếu; lưu một phần có xác nhận rõ, không giả báo đủ |
| AC11 | Task học đủ estimate nhưng chưa xong/chưa nộp | Không tự đánh dấu hoàn thành/submitted; có cách cập nhật phần còn lại |
| AC12 | Chuyển môn/tuần, request trả về ngược thứ tự | Không giữ nhầm dữ liệu tuần/môn; planning vẫn dùng capacity đa môn |
| AC13 | Có block dự kiến tuần sau từ Recover | Không cộng vào cam kết hoặc số phút tuần hiện tại |
| AC14 | Trọng số/điểm khác thang giữa các môn | Không giải thích priority bằng cách so điểm thô hoặc coi weight nhóm là weight mỗi bài |
| AC15 | Dùng điện thoại hoặc bàn phím | Xem/cập nhật/xác nhận được; không bắt kéo-thả hoặc dựa riêng màu |

Khi triển khai: dùng Pytest cho scheduler/confirm/version, Vitest và Testing Library cho trạng thái tương tác, typecheck/build frontend. Kiểm tra thủ công hành trình Plan → Do → Progress → Recover → quay lại Plan. Không cần benchmark 1.000 người dùng để nghiệm thu riêng thay đổi UI này.

## 12. Kịch bản demo để xác nhận thiết kế

Dùng fixture test, không sửa deadline thật để ép demo:

1. Chọn tuần 05–11/10/2026, thời điểm mô phỏng 05/10 lúc 09:00 GMT+7.
2. CS101 cần 120 phút, hạn 06/10 23:59; DS201 cần 90 phút, hạn 07/10 12:00; PM102 cần 60 phút, hạn 09/10 23:59.
3. Cho phép học Thứ Hai/Thứ Ba/Thứ Năm 19:00–21:00, tối đa 120 phút học/ngày; bận Thứ Ba 19:00–20:00.
4. Tạo draft: phải bố trí CS101 và DS201 trước hạn trong thời gian được phép, chia phiên nếu cần; PM102 có thể học Thứ Năm. Khoảng nghỉ được tính theo policy thực tế, không lấy 5 giờ danh nghĩa làm capacity khả dụng mặc định.
5. Xác nhận rồi refresh: phiên bản và block được giữ nguyên.
6. Thêm bận Thứ Hai 19:00–21:00: hệ thống phát hiện không còn đủ thời gian trước các hạn gần; kế hoạch không âm thầm tự đổi.
7. Mở Recover từ cảnh báo, xem diff, xác nhận; quay lại Plan thấy phiên bản mới và phần thiếu vẫn được nêu nếu chưa đủ.
8. Ghi thời gian học và còn việc chưa xong: Plan/Progress cập nhật; cuối tuần Reflect đề xuất điều chỉnh estimate cho tuần sau.

Đây là input và expected behavior để test sau triển khai, không phải evidence đã chạy.

## 13. Đánh giá độ đơn giản và hiệu quả

Thử với 5–8 sinh viên là vòng kiểm tra usability ban đầu, không đủ để kết luận hiệu quả học tập dài hạn. Mục tiêu đề xuất:

- Ít nhất 80% người thử nhận ra task tiếp theo và một deadline có nguy cơ trong 15 giây.
- Người đã lưu lịch rảnh tạo/xác nhận tuần mới trong 2 phút nếu dữ liệu LMS đủ.
- Mọi người thử hiểu preview chưa đổi lịch và phân biệt đã lên lịch với đã hoàn thành/nộp bài.
- Ghi thời gian hoàn thành tác vụ, số lần phải mở trợ giúp, số lỗi hiểu scope và lý do chỉnh bản nháp.
- Mọi test ràng buộc cứng nêu trên phải pass trước phát hành; không dùng tổng buffer hay điểm UI để che lịch sai.

Tỷ lệ nộp đúng hạn và sai số estimate cần đo qua nhiều tuần, kèm số mẫu và baseline cùng phạm vi. Chưa tuyên bố tăng KPI chỉ từ demo. Lợi ích cần chứng minh ở đợt này: sinh viên hiểu lịch nhanh hơn, sửa được phần thiếu thời gian và tin được bản kế hoạch đã xác nhận.
