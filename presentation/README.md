# PaceWise — Pitch Deck & Demo Materials

## Pitch deck

- [`pitch_deck.pptx`](pitch_deck.pptx) — bộ pitch deck Demo Day 10 trang, tiếng Việt, khổ widescreen 16:9.
- [`build_deck.py`](build_deck.py) — mã nguồn dựng slide; các thành phần trong deck có thể chỉnh sửa trong PowerPoint.

Thứ tự nội dung: giới thiệu → vấn đề → giải pháp → walkthrough → kiến trúc → công nghệ → bằng chứng & giới hạn → beachhead → đội ngũ → lời mời pilot.

Walkthrough giao diện trên slide 4 là hình minh họa luồng demo, không phải ảnh chụp màn hình sản phẩm. Số liệu test được ghi kèm phạm vi/ngày chạy; mục tiêu pilot được ghi rõ là mục tiêu, chưa phải kết quả. Thị trường chưa có số TAM/SAM được xác minh nên slide 8 mô tả beachhead và các bước kiểm chứng thay vì đưa ước tính.

### Dựng lại deck

Yêu cầu Python 3.11+ và `python-pptx`:

```powershell
python -m pip install python-pptx
python presentation\build_deck.py
```

## Video demo

Video demo chưa được tạo. Khi ghi hình (tối đa 5 phút), nên:

- [ ] Giới thiệu problem (< 30 giây)
- [ ] Demo luồng Plan và một feature chính (2–3 phút)
- [ ] Hiển thị kết quả AI có citation hoặc phương án Recover (1 phút)
- [ ] Tóm tắt impact và nhắc pilot metrics là mục tiêu (< 30 giây)
