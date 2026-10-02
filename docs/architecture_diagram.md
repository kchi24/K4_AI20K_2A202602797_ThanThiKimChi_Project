# PaceWise — Architecture

**Trạng thái:** Kiến trúc thực thi cho MVP + hướng mở rộng production pilot · **Cập nhật:** 30/09/2026

## 1. System context

```mermaid
flowchart LR
    Student[Student] --> Web[React/Vite Web App]
    Instructor[Instructor / Advisor] --> Web
    Canvas[Canvas LMS] -.->|P1: LTI 1.3 launch| Web
    Web -->|HTTPS / HttpOnly session + CSRF| API[FastAPI API]
    API -.->|Optional: REST read-only| Canvas
    API --> DB[(PostgreSQL)]
    API -->|retrieval only| Qdrant[(Qdrant service)]
    API --> AI[LangGraph AI Harness]
    API -->|OAuth 2.0: identity + freebusy + confirmed events| GCal[Google Calendar API]
    API -->|RFC 5545 export, no OAuth| ICS[ICS file]
    Canvas -->|event trigger + REST snapshot| Worker[Projection/RAG worker]
    Worker --> DB
    Worker -->|versioned ingestion| Qdrant
    AI --> Gateway[OpenRouter / OpenAI-compatible Models]
    API --> Obs[Request ID + structured logs + Prometheus/Grafana]
```

Canvas là hệ thống bên ngoài. MVP luôn chạy bằng fixture; REST chỉ đọc chỉ bật khi có sandbox/token và LTI 1.3 là P1 khi có developer key. PaceWise không fork Canvas và không ghi điểm/nộp bài. Fixture dùng cùng schema nội bộ để CI/demo vẫn chạy khi sandbox không khả dụng.

## 2. Application components

```mermaid
flowchart TB
    UI[React/Vite: /student + /instructor] --> API[FastAPI Router]
    API --> Auth[HttpOnly session + CSRF + RBAC]
    API --> CanvasAdapter[Canvas Fixture/REST Adapter]
    API --> Plan[Plan + Progress + Risk Service]
    API --> Assess[Assessment + Evidence Service]
    API --> Tutor[Grounded Tutor Service]
    API --> Dashboard[Aggregate Dashboard Service]
    API --> Calendar[Google Calendar Adapter]

    Plan --> Graph[LangGraph Typed Workflow]
    Assess --> Graph
    Tutor --> Graph
    Graph --> Decompose[Task Decomposer]
    Graph --> Recover[Recovery Planner]
    Graph --> ItemBuilder[Assessment Builder]
    Graph --> RubricScorer[CR Rubric Scorer]
    Graph --> Retriever[Qdrant Retriever + lazy FastEmbed + FlashRank ONNX]
    Graph --> Guardrail[Rules + calibrated classifier + output policy]
    Graph --> Critic[Deterministic quality gate]
    Critic -->|invalid, max 1 pass| Repair[Safe Repair Agent]
    Repair --> Critic

    Plan --> Deterministic[Constraint + Risk Validators]
    Assess --> Deterministic
    Assess --> MC[MC Rule Scorer]
    Tutor --> Citation[Citation Validator]

    Auth --> DB[(PostgreSQL)]
    CanvasAdapter --> DB
    Plan --> DB
    Assess --> DB
    Dashboard --> DB
    Calendar --> DB
    Calendar --> GoogleAPI[Google Calendar REST API]
    Retriever --> Qdrant[(Qdrant)]
    CanvasAdapter --> Queue[(PostgreSQL ingestion queue)]
    Queue --> Worker[Projection/RAG worker]
    Worker --> Qdrant
    Graph --> Checkpoint[(PostgreSQL LangGraph checkpoint)]
```

Ranh giới quan trọng:

- LLM hiểu ngữ nghĩa và sinh đề xuất; code kiểm tra quyền, schema, deadline, key MC, citation existence và privacy threshold.
- Backend deterministic scheduler là nguồn duy nhất tạo study block và quyết định tính khả thi; frontend chỉ thu thập input và hiển thị bản nháp.
- Thread học tập có khóa `institution:user:course:learning-cycle`, không phụ thuộc cookie session đăng nhập.
- PostgreSQL lưu learner profile/mastery/misconception theo `institution:user:course`; checkpoint theo tuần chỉ giữ working memory.
- Browser chỉ gửi `assessment_id`; backend kiểm tra bản duyệt của giảng viên rồi lấy rubric/đáp án từ LMS bằng service credential.
- Ca đánh giá thiếu chắc chắn và khiếu nại citation tạo `AgentReviewCase` bền vững, không chỉ nằm trong LangGraph state.
- Chat ưu tiên đọc LMS course projection do worker duy trì; chỉ fallback sang REST khi projection thiếu hoặc quá hạn.
- Request chat chỉ retrieval. Worker riêng nhận event, lấy REST snapshot, version hóa học liệu và cập nhật Qdrant; point được cô lập theo institution/course/resource/version/access scope.
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

### 3.1 End-to-end data flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Student / Instructor
    participant UI as React Web
    participant API as FastAPI
    participant Auth as Session + RBAC
    participant LMS as LMS Adapter
    participant DB as PostgreSQL
    participant Agent as LangGraph
    participant Vector as Qdrant
    participant Model as LLM Gateway

    User->>UI: Login or LMS launch
    UI->>API: Credentials / one-time launch token
    API->>LMS: Verify identity and enrollments
    LMS-->>API: User, role, allowed courses
    API->>DB: Create revocable session
    API-->>UI: HttpOnly session + CSRF cookie

    User->>UI: Plan, Track, Ask, Check, Recover, Reflect
    UI->>API: Request + CSRF (no client user_id/role)
    API->>Auth: Validate session, role and course access
    API->>DB: Read workspace, projection and learner memory
    API->>Agent: Authorized state + workflow request
    opt Grounded QA
        Agent->>Vector: Retrieve tenant/course-scoped passages
        Vector-->>Agent: Versioned passages + metadata
        Agent->>Model: Prompt + authorized context
        Model-->>Agent: Candidate response
    end
    Agent->>Agent: Validate constraints, safety and citations
    Agent->>Agent: Critic → one bounded repair → Critic
    Agent-->>API: Draft/result + status + pending action
    API->>DB: Persist outcome, audit and review case
    API-->>UI: Safe response and source references
    UI-->>User: Result or confirmation screen
```

LMS event ingestion không nằm trên request chat:

```mermaid
flowchart LR
    Event[LMS event / periodic sync] --> Queue[(Durable ingestion queue)]
    Queue --> Worker[Projection and RAG worker]
    Worker --> REST[LMS REST current snapshot]
    REST --> Normalize[Normalize + checksum + version]
    Normalize --> DB[(Course projection in PostgreSQL)]
    Normalize --> Chunk[Chunk by resource/version/access scope]
    Chunk --> Embed[Lazy FastEmbed]
    Embed --> Vector[(Qdrant)]
    Worker --> Audit[Sync cursor + retry + audit]
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

Staging và production phải dùng project/schema, secret và telemetry environment tách biệt. Alembic migration, smoke test và rollback tương thích là release gate trước pilot; bản hiện tại vẫn dùng `create_all` và chưa được tuyên bố production-ready.

## 5. Technology decisions

| Thành phần | Lựa chọn P0 | Lý do |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Một codebase cho hai vai trò, production build phục vụ bằng Nginx |
| Backend | Python 3.11 + FastAPI + Pydantic + SQLAlchemy | Khớp repo và API/schema rõ; Alembic là hardening bắt buộc trước pilot |
| Database/vector | PostgreSQL + Qdrant service | PostgreSQL lưu nghiệp vụ/checkpoint/job; Qdrant tách process để backend có thể scale nhiều replica |
| Cache/job | Durable queue trong PostgreSQL + worker riêng | Event được project và ingestion retry được sau restart; Redis chỉ thêm khi throughput thực tế yêu cầu |
| AI | LangGraph + OpenAI-compatible client/OpenRouter | Workflow có state/HITL, đổi model qua config |
| RAG | FastEmbed đa ngôn ngữ + Qdrant + FlashRank ONNX | Pipeline ingest → retrieve → rerank → citation, lazy-load để giảm RAM |
| Guardrail | Quy tắc nhanh + classifier hiệu chuẩn + output policy | Chặn input/output nhiều lớp; khi classifier lỗi hệ thống hạ cấp sang guided help an toàn |
| Canvas | Fixture bắt buộc; REST read-only có điều kiện; LTI 1.3 P1 | Demo tái lập, tích hợp thật khi có credential |
| Calendar | Google OAuth 2.0 + Calendar REST qua HTTPX; RFC 5545 `.ics` | Kết nối trực tiếp có HITL và fallback không phụ thuộc Google |
| Quality | Pytest, Ruff, Vitest/Testing Library, axe-core, Locust/k6, RAGAS + metric xác định trước | Unit, integration, accessibility, load và chất lượng AI; browser E2E là bước hardening sau MVP |
| Observability | Request ID, structured logs, Prometheus/Grafana | Theo dõi lỗi/latency HTTP, agent node và RAG; OpenTelemetry/LLM tracing là P1 |

Hiện trạng P0 đã triển khai gồm request ID, structured logs, metrics Prometheus và dashboard
Grafana. Qdrant và worker đã chạy thành service riêng trong Docker Compose. OpenTelemetry/LLM
tracing và Redis chỉ là bước nâng cấp khi pilot đo được nhu cầu throughput tương ứng.

LangGraph dùng PostgreSQL checkpointer trong Docker/production. `MemorySaver` chỉ được giữ làm
fallback cho unit test hoặc cấu hình SQLite local. Embedding FastEmbed và FlashRank ONNX đều
lazy-load; chỉ workflow QA/RAG mới nạp model vào RAM.

## 6. Security and privacy boundaries

- Token Canvas, model key và DSN chỉ nằm trong secret store; không vào Git, prompt hoặc log.
- Google refresh token được mã hóa bằng Fernet trong PostgreSQL; access token và OAuth code không được lưu hoặc ghi log.
- Backend kiểm tra RBAC/tenant ở service layer; frontend ẩn nút không được xem là kiểm soát quyền.
- Log dùng mã giả, loại nội dung nhạy cảm; log vận hành giữ 30 ngày và dữ liệu pilot đã thay định danh giữ 90 ngày.
- Dashboard chỉ trả aggregate khi n≥5; chat/Reflect thô không hiển thị.
- Trạng thái bằng chứng không phải điểm chính thức; không xếp hạng hay tự động kỷ luật.
- Yêu cầu xóa hoàn tất trong 30 ngày; bản sao lưu hết hạn trong 30 ngày tiếp theo.
- Backup, restore, delete/export và incident runbook phải được kiểm thử trước pilot.
