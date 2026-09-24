# X-Tutor

> Trợ lý học tập AI giúp sinh viên biến yêu cầu của nhiều môn thành kế hoạch
> tuần khả thi, nhận hỗ trợ có nguồn khi mắc kẹt và điều chỉnh cách học theo
> chu trình **Plan–Do–Reflect**.

**Mã đề:** EDU-01 | **Đội:** P-008 | **Trạng thái:** Gate 01 / MVP Design

## Bài toán

Sinh viên đại học phải theo dõi nhiều môn và deadline cùng lúc nhưng thường khó
biết nên bắt đầu từ đâu, chia bài tập lớn như thế nào và ưu tiên công việc nào
trong tuần. Canvas, lịch cá nhân, ghi chú và chatbot hiện tồn tại rời rạc, khiến
sinh viên dễ bắt đầu muộn, chạy theo deadline và lặp lại cách học chưa hiệu quả.

Giảng viên thường chỉ nhận ra vấn đề sau khi sinh viên đã nộp muộn hoặc kết quả
giảm, nên thiếu cơ hội hỗ trợ sớm.

## Giải pháp

X-Tutor tạo một vòng lặp học tập khép kín:

- **Plan:** Đọc assignment, rubric và deadline để đề xuất kế hoạch tuần gồm các
  nhiệm vụ nhỏ; sinh viên xem lại và xác nhận trước khi lưu.
- **Do:** Theo dõi tiến độ và hỏi đáp trên tài liệu môn học có trích nguồn.
  Guardrail chặn yêu cầu làm hộ và chuyển sang gợi ý kiểu Socratic.
- **Reflect:** So sánh kế hoạch với kết quả thực tế, xác định nguyên nhân chậm
  tiến độ và đề xuất điều chỉnh cho tuần sau.
- **Instructor view:** Hiển thị tiến độ và tín hiệu nguy cơ ở dạng tổng hợp/ẩn
  danh; giảng viên quyết định có can thiệp hay không.

## Người dùng mục tiêu

- **Sinh viên:** cần biết việc tiếp theo nên làm và được hỗ trợ đúng lúc; đo bằng
  tỷ lệ hoàn thành kế hoạch và nộp bài đúng hạn.
- **Giảng viên/Cố vấn:** cần tín hiệu sớm về tiến độ và khó khăn chung của lớp;
  đo bằng số trường hợp nguy cơ được phát hiện trước deadline.

## Phạm vi MVP

- Hai vai trò: sinh viên và giảng viên/cố vấn.
- Lập kế hoạch cho nhiều môn từ dữ liệu Canvas mô phỏng.
- Hỏi đáp có nguồn được pilot trên 1–2 môn đại diện.
- Guardrail chống làm hộ nằm trong luồng xử lý của code.
- Phiên Reflect cuối tuần và bản nháp re-plan cần sinh viên xác nhận.
- Dashboard giảng viên dùng dữ liệu tổng hợp/ẩn danh.

X-Tutor không làm hộ, nộp bài, chấm điểm hoặc thay đổi điểm trên Canvas. Canvas
LTI cấp trường và việc ghi dữ liệu ngược vào Canvas nằm ngoài MVP.

## Tech stack

| Lớp | Công nghệ hiện tại/dự kiến |
|---|---|
| Backend | Python 3.11, FastAPI, Pydantic |
| AI workflow | LangGraph, LangChain |
| LLM | OpenAI-compatible API qua OpenRouter; model cấu hình bằng `.env` |
| Database | SQLite cho development/MVP ban đầu |
| Vector store | Chưa chốt; xem Known Ambiguities trong PRD |
| Frontend | Next.js — chưa triển khai |
| Test | pytest, pytest-asyncio, Ruff |
| Deploy | Docker; hosting production chưa chốt |

## Quick start

### Windows PowerShell

Yêu cầu: Python 3.11 và Git.

```powershell
# 1. Clone và chuyển sang nhánh phát triển
git clone https://github.com/AI20K-Build-Phase-Cohort-4/P-008.git
cd P-008
git switch develop

# 2. Tạo và kích hoạt môi trường Python
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1

# Nếu PowerShell chặn activate, chỉ mở quyền cho terminal hiện tại:
# Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# 3. Cài dependency
python -m pip install --upgrade pip
pip install -r requirements.txt

# 4. Tạo cấu hình local
Copy-Item .env.example .env
# Mở .env và điền OPENAI_API_KEY, OPENAI_BASE_URL, MODEL_NAME

# 5. Chạy backend
uvicorn src.main:app --reload --port 8000
```

Mở:

- Swagger API: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/health>
- Agent status: <http://127.0.0.1:8000/api/v1/status>

### Linux / macOS

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn src.main:app --reload --port 8000
```

Không commit `.env`, API key hoặc token Canvas lên GitHub.

## Kiểm thử

```powershell
pytest
ruff check .
```

## API hiện có

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/health` | Kiểm tra backend |
| `GET` | `/api/v1/status` | Kiểm tra trạng thái agent |
| `POST` | `/api/v1/chat` | Gửi tin nhắn tới LangGraph agent mẫu |

Các API nghiệp vụ Plan–Do–Reflect chưa được triển khai. Phạm vi dự kiến được
quản lý trong PRD, không được xem là tính năng đã hoàn thành.

## Tài liệu Gate 01

- [Project Brief](docs/01-brief.md)
- [Product Requirements Document](docs/02-prd.md)
- [Wireframe & UI Flow](docs/03-wireframe-uiflow.md)
- [Architecture Diagram](docs/architecture_diagram.md)

## Cấu trúc repository

```text
src/
├── agents/       # LangGraph state, nodes, graph và tools
├── api/          # FastAPI routes
├── models/       # Pydantic request/response schemas
├── services/     # LLM và business services
├── config.py     # Settings từ .env
└── main.py       # FastAPI entry point
tests/            # Unit/integration tests
docs/             # Brief, PRD, wireframe và tài liệu kỹ thuật
eval/             # Evaluation evidence
presentation/     # Pitch deck và video demo
```

## Thành viên và vai trò

| Thành viên | Vai trò | Trách nhiệm chính |
|---|---|---|
| Phạm Khắc Tú | **Tech Lead** | Kiến trúc, backend, code review, tích hợp các module và hoàn thiện hệ thống |
| Nguyễn Gia Khánh | **AI Engineer** | LangGraph, RAG, prompt/guardrail và evaluation |
| Trần Thế Anh | **Product Owner (PO)** | Tầm nhìn sản phẩm, ưu tiên backlog, phạm vi MVP và nghiệm thu |
| Thân Thị Kim Chi | **Business Analyst (BA)** | Nghiên cứu pain point, user stories, PRD, UI flow và tiêu chí chấp nhận |

## Quy trình nhánh

| Loại nhánh | Dùng cho | Ví dụ |
|---|---|---|
| `main` | Bản ổn định/deploy | Không code trực tiếp |
| `develop` | Tích hợp các thay đổi đã review | Nhận PR từ các nhánh ngắn hạn |
| `feat/*` | Tính năng sản phẩm | `feat/planner-agent` |
| `docs/*` | Brief, PRD, wireframe, kiến trúc | `docs/architecture-diagram` |
| `fix/*` | Sửa lỗi | `fix/guardrail-false-positive` |
| `test/*` | Test hoặc evaluation riêng | `test/rag-evaluation` |
| `chore/*` | Config, Git, CI hoặc dependency | `chore/ignore-local-pitch-deck` |

Mỗi thay đổi được thực hiện trên một nhánh ngắn hạn tạo từ `develop`, mở pull
request trở lại `develop` và xóa branch sau khi merge. Khi một phiên bản đã ổn
định, đội mở pull request từ `develop` vào `main`.

## License

[MIT](LICENSE)
