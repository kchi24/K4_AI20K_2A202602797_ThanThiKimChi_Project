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
| Database/vector | PostgreSQL + Qdrant service; SQLite chỉ cho test/local tối giản |
| Cache/job | PostgreSQL durable ingestion queue + worker riêng |
| Frontend | React 19 + TypeScript + Vite, HashRouter |
| Guardrail | Quy tắc nhanh + semantic classifier hiệu chuẩn + output policy |
| Test/eval | pytest/Ruff, Vitest/Testing Library, axe-core, deterministic eval; Locust/k6 và RAGAS cho pilot |
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

### Biến môi trường

Tạo `.env` từ `.env.example`. Các biến quan trọng nhất:

| Biến | Bắt buộc | Mục đích |
|---|---|---|
| `OPENAI_API_KEY` | Khi dùng AI thật | Khóa của OpenAI-compatible provider; không commit |
| `OPENAI_BASE_URL` | Khi dùng AI thật | Endpoint provider, ví dụ OpenRouter hoặc proxy nội bộ |
| `MODEL_NAME` | Khi dùng AI thật | Model dùng cho coordinator/specialist |
| `DATABASE_URL` | Có | PostgreSQL cho session, workspace, projection, queue và memory |
| `PACEWISE_DB_PASSWORD` | Docker | Mật khẩu PostgreSQL local; phải đổi khi deploy |
| `QDRANT_URL` | Docker/pilot | Qdrant service; để trống mới dùng embedded fallback local |
| `PACEWISE_API_KEY` | Có khi tích hợp LMS | Service key giữa PaceWise backend và LMS; không gửi xuống browser |
| `PACEWISE_SESSION_SECRET` | Có | Ký session; giá trị riêng tối thiểu 32 ký tự |
| `LMS_BASE_URL` | Có | URL LMS Simulator hoặc adapter Canvas |
| `GOOGLE_CLIENT_ID` | Tùy chọn | OAuth client để kết nối Google Calendar |
| `GOOGLE_CLIENT_SECRET` | Tùy chọn | OAuth secret, chỉ lưu phía server |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Tùy chọn | Fernet key mã hóa refresh token |
| `LANGCHAIN_API_KEY` | Tùy chọn | LangSmith tracing; không ảnh hưởng chức năng cốt lõi |
| `SEMANTIC_SAFETY_MODE` | Không | `signals` hoặc `all` cho semantic safety classifier |
| `RAG_SCORE_THRESHOLD` | Không | Ngưỡng từ chối câu trả lời thiếu nguồn |

Xem đầy đủ giá trị, chú thích và cấu hình secret-file trong [`.env.example`](.env.example).

### Chạy toàn bộ hệ thống bằng Docker

Compose ở thư mục gốc chạy PaceWise frontend, backend, worker, Qdrant, LMS Simulator và hai PostgreSQL bằng một lệnh:

```powershell
Copy-Item .env.example .env
# Điền OPENAI_API_KEY và thay các secret mẫu trong .env.
docker compose up -d --build
docker compose ps
```

Mở các địa chỉ sau:

- PaceWise frontend: <http://localhost:5173>
- PaceWise API/Swagger: <http://localhost:8000/docs>
- LMS Simulator: <http://localhost:8010>
- PaceWise PostgreSQL: `localhost:5433`
- LMS PostgreSQL: `localhost:5434`
- Qdrant API/dashboard: <http://localhost:6333/dashboard>

Trong PaceWise, nút **Quay lại LMS** giữ nguyên phiên LMS và trở về URL cấu hình
bởi `VITE_LMS_URL`; **Đăng xuất PaceWise** chỉ thu hồi session PaceWise hiện tại.

Frontend production build được phục vụ bởi Nginx. Request `/api/*` được reverse proxy nội bộ tới
FastAPI; FastAPI gọi LMS qua `http://lms-simulator:8010`. Vì vậy service key LMS không xuất hiện
trong JavaScript hoặc trình duyệt.

```powershell
# Xem log
docker compose logs -f backend worker frontend lms-simulator qdrant

# Dừng nhưng giữ dữ liệu database
docker compose down
```

Tài khoản simulator dùng mật khẩu `demo123`: `student@canvas.local` và
`teacher@canvas.local`. Đăng nhập thủ công chỉ phục vụ local; luồng tích hợp chuẩn là
Canvas tạo one-time launch URL tới `/#/launch?token=...`. Nút **PaceWise** ở Global
Navigation mở dashboard tổng hợp mọi môn; tab **PaceWise** trong Course Navigation
mở cùng ứng dụng với môn hiện tại được chọn làm ngữ cảnh ban đầu.

Mô hình bảo mật:

- Trình duyệt không nhận `PACEWISE_API_KEY`; chỉ PaceWise backend gọi service API của LMS.
- Launch token chỉ dùng một lần. Sau xác thực, backend cấp cookie session `HttpOnly` và
  cookie CSRF tách biệt.
- Session được lưu và có thể thu hồi trong PostgreSQL, nên logout có hiệu lực với mọi
  backend instance; đăng nhập bị rate-limit dùng chung qua database.
- `user_id`, `course_id` và role lấy từ session đã ký; client không được tự chọn người dùng.
- Sinh viên chỉ đọc dữ liệu của mình. Endpoint tổng quan lớp yêu cầu role giảng viên và
  chỉ trả dữ liệu tổng hợp, không trả tên/email sinh viên.
- Production hỗ trợ bắt buộc HTTPS, HSTS/security headers và đọc secret từ file mount qua
  `PACEWISE_API_KEY_FILE`/`PACEWISE_SESSION_SECRET_FILE`.

Dữ liệu kế hoạch, phiên học và reflection được lưu trong PostgreSQL thay vì chỉ nằm ở
`localStorage`. Sau đăng nhập, frontend tự đồng bộ LMS mỗi 30 giây, tổng hợp deadline của
tất cả môn đã đăng ký và cho phép đổi môn đang xem. Worker riêng đọc event feed của LMS, lưu
cursor, cập nhật projection/risk và xếp job ingest RAG bền vững để tiếp tục đúng vị trí sau khi
restart. Chat request không tải hoặc embedding học liệu.

## Kiểm thử

```powershell
python -m ruff check src/ evals/ tests/
python -m pytest tests/ -q
python -m evals.run_agent_eval
python -m evals.run_manual_evidence
# Cần Docker + model trong .env; tạo 20 output live và cập nhật evidence
python -m evals.run_live_manual_evidence
```

### Sample queries

Sau khi đăng nhập bằng tài khoản sinh viên local, thử các câu sau trong PaceWise:

| Luồng | Câu hỏi mẫu | Kết quả mong đợi |
|---|---|---|
| Plan | `Lập kế hoạch tuần từ các assignment hiện tại, mỗi ngày tối đa 2 giờ.` | Bản nháp milestone và màn hình xác nhận; chưa tự lưu |
| Tracking | `Kiểm tra tiến độ hiện tại và cho tôi biết deadline nào đang có nguy cơ.` | Slack, mức rủi ro và lý do dựa trên dữ liệu LMS |
| QA/RAG | `Theo tài liệu môn học, overfitting là gì? Trích nguồn giúp tôi.` | Trả lời có citation hoặc từ chối nếu chưa đủ nguồn |
| Guardrail | `Làm hoàn chỉnh bài tập tính điểm này để tôi nộp.` | Không làm hộ; chuyển sang gợi ý từng bước |
| Understanding | `Kiểm tra mức hiểu bài của tôi theo assessment đang chọn.` | Dùng rubric server-side; trả bằng chứng, confidence hoặc chuyển review |
| Recover | `Bài này kéo dài thêm 3 giờ, hãy đưa ra phương án cứu lịch.` | 2–3 phương án và diff; chỉ áp dụng sau xác nhận |
| Reflect | `Tổng kết tuần này và đề xuất một thay đổi cho tuần sau.` | Bản reflection dựa trên kế hoạch/thực tế, chờ người dùng xác nhận |

Health check không cần đăng nhập:

```powershell
curl.exe http://localhost:8000/health
```

Bằng chứng manual mới nhất: [Live Manual Evaluation Evidence](docs/evaluation-evidence.md).

## API hiện có

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/health` | Kiểm tra backend |
| `GET` | `/api/v1/status` | Kiểm tra trạng thái agent |
| `POST` | `/api/v1/chat` | Chạy LangGraph agent bằng PaceWise session và dữ liệu LMS đã phân quyền |
| `POST` | `/api/v1/auth/lms-launch` | Đổi one-time LMS launch token lấy PaceWise session |
| `POST` | `/api/v1/auth/lms-login` | Đăng nhập LMS dành cho môi trường local |
| `GET` | `/api/v1/auth/me` | Khôi phục session hiện tại |
| `POST` | `/api/v1/auth/course` | Đổi môn đang xem trong phạm vi enrollment |
| `POST` | `/api/v1/auth/logout` | Đăng xuất có kiểm tra CSRF |
| `GET` | `/api/v1/lms/sync` | Đồng bộ course, assignment và trạng thái nộp bài theo session |
| `GET/PUT` | `/api/v1/workspace` | Đọc/lưu kế hoạch và dữ liệu học tập cá nhân trong PostgreSQL |
| `GET` | `/api/v1/instructor/overview` | Dashboard tổng hợp, chỉ dành cho giảng viên |
| `POST` | `/api/v1/instructor/actions` | Lưu duyệt assessment/review/hướng dẫn và audit log |
| `GET/POST/DELETE` | `/api/v1/integrations/google-calendar/*` | OAuth, đọc busy/free, xuất study block đã xác nhận và thu hồi quyền |
| `POST` | `/api/v1/calendar/pacewise-study-plan.ics` | Tải kế hoạch dạng `.ics` không cần Google OAuth |

API chat hiện điều phối sáu workflow Plan, Tracking, QA, Understanding, Recover
và Reflect. Plan/Recover/Reflect có bước xác nhận; QA có guardrail và kiểm tra
trích dẫn; Understanding chuyển ca thiếu bằng chứng/rubric cho giảng viên. Đây là
AI harness đã qua kiểm thử xác định, chưa thay thế kiểm thử pilot với model và dữ
liệu thật.

Frontend gọi API AI bằng PaceWise session `HttpOnly`; backend tự lấy user, role,
course và assignment từ LMS simulator. Học liệu do worker ingest trước vào Qdrant; request chat chỉ retrieval. Client không được tự truyền
`user_id`, `role`, `course_id` hoặc `thread_id` cho agent.

## Tài liệu Gate 01

- [Topic Requirements & Traceability](docs/00-topic-requirements.md)
- [Project Brief](docs/01-brief.md)
- [Product Requirements Document](docs/02-prd.md)
- [Wireframe & UI Flow](docs/03-wireframe-uiflow.md)
- [Architecture Diagram](docs/architecture_diagram.md)
- [Project Charter & 5-week Delivery Plan](docs/04-project-charter.md)
- [AI Workflows & Evaluation](docs/05-ai-workflows-and-evaluation.md)
- [User Stories & Acceptance Criteria](docs/06-user-stories.md)
- [Live Manual Evaluation Evidence](docs/evaluation-evidence.md)

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
evals/            # Dataset, runner và evaluation evidence
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

## AI runtime, observability và evaluation

- LangGraph dùng PostgreSQL checkpointer khi `DATABASE_URL` là PostgreSQL; state của cùng một
  hành trình học được khôi phục qua khóa `institution:user:course:learning-cycle`. `MemorySaver` chỉ còn là fallback
  cho test/local SQLite.
- Worker RAG ingest bất đồng bộ học liệu đã được LMS phân quyền và version hóa, tạo embedding đa ngôn ngữ bằng FastEmbed, truy xuất
  từ Qdrant, rerank bằng FlashRank ONNX đa ngôn ngữ và trả citation theo tài liệu/trang/đoạn.
  FastEmbed và reranker đều lazy-load, nên các workflow không dùng RAG không tốn RAM cho model.
- Backend xuất structured request logs, `X-Request-ID` và Prometheus metrics tại `/metrics`.

Chạy thêm Prometheus + Grafana (dashboard `PaceWise Overview`):

```powershell
docker compose --profile observability up -d --build
```

- Prometheus: <http://localhost:9090>
- Grafana: <http://localhost:3001> (mặc định local: `admin` / `pacewise-local-only`)

Chạy RAGAS với bộ JSONL đã gán nhãn tối thiểu 100 mẫu. Mỗi dòng cần `user_input`, `response`,
`retrieved_contexts` và `reference`:

```powershell
pip install -r requirements.txt
python evals/run_ragas_eval.py evals/datasets/rag-pilot.jsonl
```

Đo độ đồng thuận giữa hai SME, AI so với nhãn đã adjudicate và false-positive/
false-negative của safety policy:

```powershell
python evals/run_pilot_eval.py evals/datasets/pilot-human-v1.jsonl
```

File `evals/datasets/pilot-human-template.jsonl` chỉ mô tả schema; không phải dữ
liệu người thật và không được dùng để tuyên bố metric pilot.

Smoke test đồng thời cho MVP dùng ba tài khoản sinh viên demo, đồng thời báo median/max latency,
error và chênh lệch số lần gọi/token/cost của LLM:

```powershell
.\.venv\Scripts\python.exe scripts\evaluate_concurrent_students.py
```

Đây chỉ là kiểm tra tích hợp với 2–3 người dùng, không phải bằng chứng hệ thống chịu được 1.000
người. Bài 1.000 virtual users được hoãn tới môi trường staging đủ tài nguyên; khi thực hiện mới
dùng lệnh sau và phải lưu report trước khi tuyên bố đạt:

```powershell
pip install -r requirements.txt
locust -f load_tests/locustfile.py --host http://localhost:5173 --headless -u 1000 -r 50 -t 5m --csv evals/reports/load-1000
```

## License

[MIT](LICENSE)
