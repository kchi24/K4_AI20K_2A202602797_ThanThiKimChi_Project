# PaceWise

PaceWise là learning companion cho sinh viên theo chu trình **Plan → Do → Reflect**:

- **Plan:** lấy deadline/lịch học từ LMS, kết hợp lịch cá nhân, quỹ thời gian và ưu tiên để tạo study block khả thi.
- **Do:** chạy phiên tự học, ghi actual time, gợi ý học liệu có nguồn, hỏi đáp có citation và chặn yêu cầu làm hộ bài tính điểm.
- **Reflect:** phản tư sau hoạt động hoặc cuối tuần; đề xuất điều chỉnh, nhưng sinh viên vẫn xem và xác nhận trước khi đổi kế hoạch.
- **Instructor HITL:** hiển thị tín hiệu tổng hợp và hàng chờ cần con người xem; không dùng AI để tự chấm điểm hay tự đổi quy định học vụ.

Tài liệu kỹ thuật: [architecture diagram](docs/architecture_diagram.md) · [evaluation evidence](docs/evaluation-evidence.md).

## Chạy nhanh bằng Docker

Yêu cầu: Docker Desktop có Compose v2, Git và tối thiểu khoảng 4 GB RAM trống.

```powershell
git clone https://github.com/AI20K-Build-Phase-Cohort-4/P-008.git
cd P-008
Copy-Item .env.example .env
docker compose up --build -d
docker compose ps
```

Mở:

| Thành phần | URL |
|---|---|
| PaceWise | <http://localhost:5173> |
| FastAPI Swagger | <http://localhost:8000/docs> |
| Backend health | <http://localhost:8000/health> |
| LMS Simulator | <http://localhost:8010> |
| Qdrant dashboard | <http://localhost:6333/dashboard> |

Tài khoản demo LMS/PaceWise:

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Sinh viên | `student@canvas.local` | `demo123` |
| Giảng viên | `teacher@canvas.local` | `demo123` |

LMS tự seed dữ liệu demo khi khởi động. Với thay đổi frontend/backend, rebuild service liên quan:

```powershell
docker compose up --build -d frontend backend worker
```

Xem log và dừng hệ thống:

```powershell
docker compose logs -f backend worker frontend lms-simulator
docker compose down
```

`docker compose down` giữ nguyên volume. Chỉ dùng `docker compose down -v` khi chủ động muốn xóa toàn bộ dữ liệu local.

## Cấu hình `.env`

Tạo `.env` từ [`.env.example`](.env.example). Không commit `.env`, API key, token Canvas hoặc Google refresh token.

### Biến cốt lõi

| Biến | Khi nào cần | Mục đích |
|---|---|---|
| `OPENAI_API_KEY` | Khi chạy LLM thật | API key của OpenAI-compatible provider |
| `OPENAI_BASE_URL` | Khi chạy LLM thật | Base URL của provider/proxy |
| `MODEL_NAME` | Khi chạy LLM thật | Model cho coordinator và specialist workflows |
| `PACEWISE_API_KEY` | Luôn với LMS integration | Service key backend ↔ LMS; không đưa vào biến `VITE_*` |
| `PACEWISE_LAUNCH_SECRET` | Luôn | Ký one-time LMS launch token; tối thiểu 32 ký tự |
| `PACEWISE_SESSION_SECRET` | Luôn | Ký PaceWise session; tối thiểu 32 ký tự |
| `PACEWISE_DB_PASSWORD` | Docker/local | Mật khẩu PostgreSQL PaceWise |
| `LMS_DB_PASSWORD` | Docker/local | Mật khẩu PostgreSQL LMS Simulator |
| `DATABASE_URL` | Chạy backend ngoài Docker | Workspace, session, memory, queue và checkpoint |
| `LMS_BASE_URL` | Luôn | LMS adapter/simulator URL |
| `QDRANT_URL` | RAG | Vector store URL |

### Tùy chọn AI, calendar và vận hành

| Biến | Mặc định mẫu | Mục đích |
|---|---|---|
| `SEMANTIC_SAFETY_MODE` | `signals` | Phạm vi semantic safety classifier |
| `RAG_SCORE_THRESHOLD` | `0.72` | Ngưỡng evidence tối thiểu |
| `LLM_TIMEOUT_SECONDS` | `45` | Timeout một LLM request |
| `LLM_MAX_OUTPUT_TOKENS` | `800` | Giới hạn output |
| `APP_TIMEZONE` | `Asia/Ho_Chi_Minh` | Múi giờ học tập |
| `LMS_SYNC_INTERVAL_SECONDS` | `30` | Chu kỳ sync fallback/worker |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | trống | Google Calendar OAuth |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | trống | Fernet key mã hóa token |
| `LANGCHAIN_API_KEY` | trống | LangSmith tracing |
| `VITE_API_URL` | `/api/v1` | API URL mà frontend gọi |
| `VITE_LMS_URL` | `http://localhost:8010` | Đích của nút quay lại LMS |

Khi deploy, thay toàn bộ secret mẫu, bật HTTPS và đặt `SESSION_COOKIE_SECURE=true`, `FORCE_HTTPS=true`. Có thể dùng các biến `*_FILE` đã mô tả trong `.env.example` để mount secret.

## Chạy local không dùng Docker cho app

Yêu cầu Python 3.11 và Node.js 20+. PostgreSQL/LMS/Qdrant vẫn có thể chạy bằng Docker.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Trong terminal khác:

```powershell
cd frontend\pacewise
npm install
npm run dev
```

## Sample queries / thao tác demo

| Luồng | Input mẫu | Điều cần quan sát |
|---|---|---|
| Plan | Thêm lịch cá nhân `Ăn tối 18:00–18:45`, chọn ưu tiên, bấm **AI lập kế hoạch** | AI tránh giờ bận, tính capacity và chỉ tạo bản nháp |
| Plan | `Lập kế hoạch cho ba deadline gần nhất; mỗi phiên tối đa 60 phút.` | Nhiệm vụ được chia thành study block trước deadline |
| Do/RAG | `Theo slide TRR_Full_P4.pdf, quan hệ tương đương cần những tính chất nào? Trích nguồn.` | Trả lời có source/page hoặc báo chưa đủ nguồn |
| Guardrail | `Làm toàn bộ quiz tính điểm này để tôi nộp.` | Từ chối làm hộ và chuyển sang gợi ý từng bước |
| Understanding | `Quan hệ hai ngôi này có phản xạ và đối xứng nhưng không bắc cầu; nó có tương đương không?` | Phân tích theo rubric/evidence, không tự chấm điểm chính thức |
| Recover | `Tôi phát sinh việc bận 3 giờ tối nay; xếp lại nhưng không vượt deadline.` | 2–3 phương án, capacity/trade-off và preview trước xác nhận |
| Reflect | `Phiên này tôi mới hoàn thành 60%, vướng phần chứng minh và cần thêm 30 phút.` | Lưu actual/blocker; chỉ yêu cầu Plan phân tích lại khi có lệch |

Health/status không cần đăng nhập:

```powershell
curl.exe http://localhost:8000/health
curl.exe http://localhost:8000/api/v1/status
```

Các API nghiệp vụ yêu cầu PaceWise session, và request thay đổi trạng thái yêu cầu CSRF. Không truyền `user_id`, `role` hoặc `course_id` tùy ý từ client; backend lấy các giá trị này từ session đã ký.

## Endpoint chính

| Method | Endpoint | Chức năng |
|---|---|---|
| `GET` | `/health` | Health backend/checkpointer |
| `GET` | `/api/v1/status` | Agent status |
| `POST` | `/api/v1/chat` | Chạy LangGraph workflow |
| `POST` | `/api/v1/auth/lms-login` | Login local qua LMS |
| `POST` | `/api/v1/auth/lms-launch` | Đổi one-time launch token lấy session |
| `GET` | `/api/v1/auth/me` | Khôi phục session |
| `GET` | `/api/v1/lms/sync` | Snapshot LMS theo enrollment |
| `GET/PUT` | `/api/v1/workspace` | Đọc/lưu plan, lịch cá nhân, session, reflection |
| `GET` | `/api/v1/lms/events/stream` | SSE báo LMS thay đổi |
| `GET` | `/api/v1/instructor/overview` | Tổng quan lớp, instructor-only |
| `POST` | `/api/v1/instructor/actions` | HITL review/assessment/guidance |
| `GET/POST/DELETE` | `/api/v1/integrations/google-calendar/*` | Calendar OAuth/free-busy/events |
| `POST` | `/api/v1/calendar/pacewise-study-plan.ics` | Xuất plan `.ics` |

## Kiểm thử

Backend:

```powershell
.\.venv\Scripts\python.exe -m ruff check src tests evals
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m evals.run_agent_eval
```

Frontend:

```powershell
cd frontend\pacewise
npm test -- --run
npm run build
```

Live external-model evaluation có thể gửi snapshot học tập demo đến provider được cấu hình. Chỉ chạy khi đã được phép chia sẻ payload và đã kiểm tra đích nhận:

```powershell
.\.venv\Scripts\python.exe -m evals.run_live_manual_evidence --case LIVE-01,LIVE-08,LIVE-12,LIVE-15,LIVE-19
```

Kết quả thực tế mới nhất: [docs/evaluation-evidence.md](docs/evaluation-evidence.md).

## Cấu trúc repository

```text
src/                         FastAPI, LangGraph, services, persistence
frontend/pacewise/           React + TypeScript + Vite
lms-simulator/               Canvas-compatible demo LMS
tests/                       Backend unit/integration/security tests
evals/                       Eval datasets, runners và raw reports
docs/                        Product/architecture/evaluation documents
observability/               Prometheus và Grafana provisioning
docker-compose.yml           Full local stack
```

## Giới hạn hiện tại

- LMS production adapter/LTI cần developer key và sandbox của trường; simulator đang là nguồn demo chính.
- KPI nộp đúng hạn cần pilot nhiều tuần, không thể chứng minh chỉ bằng UI hoặc seed data.
- Live LLM/RAG eval phải được chạy với quyền chia sẻ dữ liệu rõ ràng; deterministic tests không thay thế SME review.
- PaceWise không làm hộ, tự nộp bài, tự chấm điểm hoặc tự gia hạn deadline.
