# PaceWise

> Trợ lý học tập AI giúp sinh viên biến yêu cầu của nhiều môn thành kế hoạch
> tuần khả thi, nhận hỗ trợ có nguồn, theo dõi sai lệch và tự nhìn lại việc học
> theo chu trình **Plan–Do–Reflect**.

**Mã đề:** EDU-01 | **Đội:** P-008 | **Trạng thái:** Gate 01 / MVP Design

## Bài toán

Sinh viên đại học phải theo dõi nhiều môn và deadline cùng lúc nhưng thường khó
biết nên bắt đầu từ đâu, chia bài tập lớn như thế nào và ưu tiên công việc nào
trong tuần. Canvas, lịch cá nhân, ghi chú và chatbot hiện tồn tại rời rạc, khiến
sinh viên dễ bắt đầu muộn, chạy theo deadline và lặp lại cách học chưa hiệu quả.

Giảng viên thường chỉ nhận ra vấn đề sau khi sinh viên đã nộp muộn hoặc kết quả
giảm, nên thiếu cơ hội hỗ trợ sớm.

## Giải pháp

PaceWise đồng hành theo chu trình **Plan–Do–Reflect**. Trong bước **Do**, hệ
thống có thêm hai cơ chế hỗ trợ là kiểm tra mức độ hiểu bài (`Check`) và phục
hồi kế hoạch khi tiến độ bị lệch (`Recover`):

- **Plan:** Đọc assignment, rubric và deadline để đề xuất kế hoạch tuần gồm các
  nhiệm vụ nhỏ; sinh viên xem lại và xác nhận trước khi lưu.
- **Do:** Theo dõi tiến độ và hỏi đáp trên tài liệu môn học có trích nguồn.
  Guardrail chặn yêu cầu làm hộ và chuyển sang gợi ý kiểu Socratic.
- **Check trong Do:** Dùng 1–3 câu kiểm tra nhanh đã được giảng viên duyệt để thu bằng
  chứng theo một đơn vị kiến thức; kết quả không phải điểm chính thức.
- **Recover trong Do:** Kết hợp sai lệch thời gian và bằng chứng học tập để đề xuất phương án phân
  bổ lại; sinh viên xác nhận trước khi thay đổi kế hoạch.
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
- Lập kế hoạch tuần cho một môn pilot từ dữ liệu Canvas mô phỏng.
- MVP luôn chạy bằng fixture; Canvas REST chỉ đọc chỉ bật khi có sandbox/token; LTI 1.3 là P1 khi có developer key.
- Pilot kiểm tra nhanh trên 1 môn với 3–5 đơn vị kiến thức.
- Hỏi đáp có nguồn được pilot trên 1 môn đại diện.
- Guardrail chống làm hộ nằm trong luồng xử lý của code.
- Phiên Reflect cuối tuần và bản nháp re-plan cần sinh viên xác nhận.
- Dashboard giảng viên dùng dữ liệu tổng hợp khi nhóm có ít nhất 5 sinh viên.
- Production pilot có structured logs, OpenTelemetry, metrics, health check,
  backup/restore và rollback.

PaceWise không làm hộ, nộp bài, chấm điểm hoặc thay đổi điểm trên Canvas. Canvas
LTI cấp trường và việc ghi dữ liệu ngược vào Canvas nằm ngoài MVP.

## Tech stack

| Lớp | Công nghệ hiện tại/dự kiến |
|---|---|
| Backend | Python 3.11, FastAPI, Pydantic |
| AI workflow | LangGraph, LangChain |
| LLM | OpenAI-compatible API qua OpenRouter; model cấu hình bằng `.env` |
| Database/vector | SQLite hiện tại; mục tiêu PostgreSQL + Qdrant |
| Cache/job | Redis + RQ worker — chưa triển khai |
| Frontend | Next.js + TypeScript — chưa triển khai |
| Guardrail | Quy tắc xác định trước + Llama Guard |
| Test/eval | pytest/Ruff; mục tiêu Vitest, Playwright, Locust/k6, RAGAS và metric xác định trước |
| Observability | Mục tiêu OpenTelemetry, structured logs, Prometheus/Grafana và LLM tracing |
| Deploy | Docker; Render hoặc GCP Cloud Run sau khi chốt ngân sách |

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

Các API nghiệp vụ Plan–Do–Reflect, bao gồm Check/Recover trong bước Do, chưa
được triển khai. Phạm vi dự kiến được quản lý trong PRD, không được xem là tính
năng đã hoàn thành.

## Tài liệu Gate 01

- [Topic Requirements & Traceability](docs/00-topic-requirements.md)
- [Project Brief](docs/01-brief.md)
- [Product Requirements Document](docs/02-prd.md)
- [Wireframe & UI Flow](docs/03-wireframe-uiflow.md)
- [Architecture Diagram](docs/architecture_diagram.md)
- [Project Charter & 5-week Delivery Plan](docs/04-project-charter.md)

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
| Phạm Khắc Tú | **Tech Lead** | Backend, Canvas REST/LTI, CI/CD, security, observability và release |
| Nguyễn Gia Khánh | **AI Engineer** | LangGraph, Plan/Recover, RAG, assessment/diagnosis, guardrail và eval |
| Trần Thế Anh | **Product Owner (PO)** | Backlog, Student Experience, analytics, UAT và demo/release acceptance |
| Thân Thị Kim Chi | **Business Analyst (BA)** | Objective/rubric, Management Console, Canvas fixtures, data/content QA |

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
