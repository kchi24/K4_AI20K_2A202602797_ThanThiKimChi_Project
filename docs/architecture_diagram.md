# PaceWise — Architecture

**Trạng thái:** Target architecture cho production pilot · **Cập nhật:** 24/09/2026

## 1. System context

```mermaid
flowchart LR
    Student[Student] --> Web[Next.js Web App]
    Instructor[Instructor / Advisor] --> Web
    Canvas[Canvas LMS] -.->|P1: LTI 1.3 launch| Web
    Web -->|HTTPS / JWT| API[FastAPI API]
    API -.->|Optional: REST read-only| Canvas
    API --> DB[(PostgreSQL)]
    API --> Qdrant[(Qdrant Vector DB)]
    API --> Redis[(Redis)]
    Redis --> Worker[RQ Worker]
    API --> AI[LangGraph AI Harness]
    Worker --> AI
    AI --> Gateway[OpenRouter / OpenAI-compatible Models]
    API --> Obs[OpenTelemetry + Logs + Prometheus]
    AI --> LLMObs[LLM Traces]
```

Canvas là hệ thống bên ngoài. MVP luôn chạy bằng fixture; REST chỉ đọc chỉ bật khi có sandbox/token và LTI 1.3 là P1 khi có developer key. PaceWise không fork Canvas và không ghi điểm/nộp bài. Fixture dùng cùng schema nội bộ để CI/demo vẫn chạy khi sandbox không khả dụng.

## 2. Application components

```mermaid
flowchart TB
    UI[Next.js: /student + /instructor] --> API[FastAPI Router]
    API --> Auth[JWT/LTI Verification + RBAC]
    API --> CanvasAdapter[Canvas Fixture/REST Adapter]
    API --> Plan[Plan + Progress + Risk Service]
    API --> Assess[Assessment + Evidence Service]
    API --> Tutor[Grounded Tutor Service]
    API --> Dashboard[Aggregate Dashboard Service]

    Plan --> Graph[LangGraph Typed Workflow]
    Assess --> Graph
    Tutor --> Graph
    Graph --> Decompose[Task Decomposer]
    Graph --> Recover[Recovery Planner]
    Graph --> ItemBuilder[Assessment Builder]
    Graph --> RubricScorer[CR Rubric Scorer]
    Graph --> Retriever[Qdrant Retriever + bge-reranker]
    Graph --> Guardrail[Rules + Llama Guard]

    Plan --> Deterministic[Constraint + Risk Validators]
    Assess --> Deterministic
    Assess --> MC[MC Rule Scorer]
    Tutor --> Citation[Citation Validator]

    Auth --> DB[(PostgreSQL)]
    CanvasAdapter --> DB
    Plan --> DB
    Assess --> DB
    Dashboard --> DB
    Retriever --> Qdrant[(Qdrant)]
```

Ranh giới quan trọng:

- LLM hiểu ngữ nghĩa và sinh đề xuất; code kiểm tra quyền, schema, deadline, key MC, citation existence và privacy threshold.
- Assessment builder không tự duyệt output của chính nó. Item/rubric phải qua quality gate và giảng viên xác nhận.
- Độ tin cậy thấp, câu trả lời ngoài rubric hoặc bộ chấm bất đồng được chuyển vào hàng chờ giảng viên; không tự cập nhật bằng chứng học tập.
- Mọi plan/re-plan, assessment publish và instructor action đều version hóa/audit.

## 3. Plan–Do–Reflect workflow

Trong sơ đồ trạng thái, `Check` và `Recovery` là các nhánh hỗ trợ bên trong bước
`Do`, không phải hai giai đoạn độc lập thay thế chu trình của đề bài.

```mermaid
stateDiagram-v2
    [*] --> PlanDraft
    PlanDraft --> PlanConfirmed: Student confirms
    PlanConfirmed --> Doing
    Doing --> CheckOffered: Milestone completed
    CheckOffered --> Doing: Student postpones
    CheckOffered --> Checking: Starts approved check
    Checking --> ReviewQueue: Low confidence / out of rubric
    Checking --> EvidenceUpdated: Valid evidence
    ReviewQueue --> EvidenceUpdated: Instructor resolves
    EvidenceUpdated --> RiskEvaluation
    Doing --> RiskEvaluation: Progress/deadline changes
    RiskEvaluation --> Doing: Plan remains feasible
    RiskEvaluation --> RecoveryDraft: Risk exceeds threshold
    RecoveryDraft --> Doing: Student confirms option
    Doing --> Reflecting: End of week
    Reflecting --> PlanDraft: Confirmed adjustment
```

## 4. Deployment and observability

```mermaid
flowchart LR
    GitHub[GitHub Actions] -->|test, scan, build| Registry[Container Registry]
    Registry --> Staging[Render Staging API + Worker]
    Registry --> Production[Render Production API + Worker]
    Vercel[Vercel Frontend] --> Staging
    Vercel --> Production
    Staging --> StagingDB[(Staging Postgres + Qdrant)]
    Production --> ProdDB[(Production Postgres + Qdrant)]
    Staging --> StagingRedis[(Staging Redis)]
    Production --> ProdRedis[(Production Redis)]
    Staging --> Telemetry[Sentry + Langfuse + Metrics]
    Production --> Telemetry
    Monitor[External Uptime Monitor] --> Staging
    Monitor --> Production
```

Staging và production dùng project/schema, secret và telemetry environment tách biệt. Release gắn Git SHA, chạy Alembic migration, smoke test và có đường rollback image/migration tương thích.

## 5. Technology decisions

| Thành phần | Lựa chọn P0 | Lý do |
|---|---|---|
| Frontend | Next.js + TypeScript + Tailwind/shadcn-ui | Một codebase cho hai vai trò, responsive và test bằng Playwright |
| Backend | Python 3.11 + FastAPI + Pydantic + SQLAlchemy/Alembic | Khớp repo, API/schema rõ, migration được kiểm soát |
| Database/vector | PostgreSQL + Qdrant | Tách dữ liệu nghiệp vụ và vector; khớp stack đề bài |
| Cache/job | Redis + RQ worker | Cache/rate limit và xử lý ingestion/eval ngoài request |
| AI | LangGraph + OpenAI-compatible client/OpenRouter | Workflow có state/HITL, đổi model qua config |
| RAG | Embedding đa ngôn ngữ + Qdrant + bge-reranker | Hỗ trợ tiếng Việt và hợp đồng trích dẫn; Cohere Rerank là tùy chọn |
| Guardrail | Quy tắc xác định trước + Llama Guard | Không phụ thuộc một prompt/classifier duy nhất |
| Canvas | Fixture bắt buộc; REST read-only có điều kiện; LTI 1.3 P1 | Demo tái lập, tích hợp thật khi có credential |
| Quality | Pytest, Vitest, Playwright, Locust/k6, RAGAS + metric xác định trước | Unit, integration, E2E, load và chất lượng AI |
| Observability | OpenTelemetry, structured logs, Prometheus/Grafana, LLM tracing | Nối request → service → LLM/job, theo dõi lỗi/latency/cost |

## 6. Security and privacy boundaries

- Token Canvas, model key và DSN chỉ nằm trong secret store; không vào Git, prompt hoặc log.
- Backend kiểm tra RBAC/tenant ở service layer; frontend ẩn nút không được xem là kiểm soát quyền.
- Log dùng mã giả, loại nội dung nhạy cảm; log vận hành giữ 30 ngày và dữ liệu pilot đã thay định danh giữ 90 ngày.
- Dashboard chỉ trả aggregate khi n≥5; chat/Reflect thô không hiển thị.
- Trạng thái bằng chứng không phải điểm chính thức; không xếp hạng hay tự động kỷ luật.
- Yêu cầu xóa hoàn tất trong 30 ngày; bản sao lưu hết hạn trong 30 ngày tiếp theo.
- Backup, restore, delete/export và incident runbook phải được kiểm thử trước pilot.
