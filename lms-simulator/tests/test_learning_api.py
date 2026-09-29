from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from app import security
from app.db import Base, get_db
from app.main import app
from app.models import (
    Assignment,
    Course,
    CourseModule,
    Enrollment,
    ModuleItem,
    Resource,
    Submission,
    User,
)
from app.security import hash_password
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


def _client() -> tuple[TestClient, sessionmaker]:
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    now = datetime.now(UTC)
    with factory() as db:
        teacher = User(
            email="teacher@example.test",
            full_name="Teacher",
            password_hash=hash_password("demo12345"),
            role="instructor",
            avatar_color="#111111",
        )
        student = User(
            email="student@example.test",
            full_name="Student",
            password_hash=hash_password("demo12345"),
            role="student",
            avatar_color="#222222",
        )
        course = Course(code="CS101", name="Test Course", term="Fall", color="#0374b5")
        db.add_all([teacher, student, course])
        db.flush()
        db.add_all(
            [
                Enrollment(user_id=teacher.id, course_id=course.id, role="instructor"),
                Enrollment(user_id=student.id, course_id=course.id, role="student"),
            ]
        )
        assignment = Assignment(
            course_id=course.id,
            title="Project",
            description="",
            due_at=now + timedelta(days=7),
            points_possible=10,
            submission_types="online_text_entry",
        )
        module = CourseModule(course_id=course.id, name="Week 1", position=1)
        resource = Resource(
            course_id=course.id,
            title="Syllabus",
            kind="link",
            source_url="https://example.test/syllabus",
        )
        db.add_all([assignment, module, resource])
        db.flush()
        db.add_all(
            [
                ModuleItem(module_id=module.id, title="Read", item_type="resource", position=1),
                ModuleItem(module_id=module.id, title="Practice", item_type="page", position=2),
            ]
        )
        db.commit()

    def override_db() -> Generator[Session, None, None]:
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    security.SessionLocal = factory
    return TestClient(app), factory


def _login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/session", json={"email": email, "password": "demo12345"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_assignment_groups_deadline_override_and_rubric() -> None:
    client, _ = _client()
    teacher = _login(client, "teacher@example.test")
    student = _login(client, "student@example.test")

    group = client.post(
        "/api/courses/1/assignment-groups",
        headers=teacher,
        json={"name": "Projects", "group_weight": 70, "drop_lowest": 1},
    )
    assert group.status_code == 201
    policy = client.put(
        "/api/assignments/1/policy",
        headers=teacher,
        json={
            "assignment_group_id": group.json()["id"],
            "unlock_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
            "lock_at": (datetime.now(UTC) + timedelta(days=10)).isoformat(),
            "grading_type": "points",
            "peer_reviews": True,
        },
    )
    assert policy.status_code == 200
    assert policy.json()["assignment_group"]["name"] == "Projects"

    override_due = datetime.now(UTC) + timedelta(days=14)
    override = client.post(
        "/api/assignments/1/overrides",
        headers=teacher,
        json={
            "title": "Student extension",
            "target_type": "student",
            "target_id": 2,
            "due_at": override_due.isoformat(),
        },
    )
    assert override.status_code == 201
    student_policy = client.get("/api/assignments/1/policy", headers=student)
    assert student_policy.status_code == 200
    assert student_policy.json()["override_target"] == "student"

    rubric = client.post(
        "/api/courses/1/rubrics",
        headers=teacher,
        json={
            "title": "Understanding",
            "criteria": [
                {
                    "description": "Reasoning",
                    "points": 10,
                    "ratings": [
                        {"description": "Meets", "points": 10},
                        {"description": "Missing", "points": 0},
                    ],
                }
            ],
        },
    )
    assert rubric.status_code == 201
    attached = client.put(
        f"/api/assignments/1/rubric/{rubric.json()['id']}",
        headers=teacher,
        json={},
    )
    assert attached.status_code == 200
    assert attached.json()["rubric"]["criteria"][0]["description"] == "Reasoning"


def test_module_progress_submission_history_and_resource_version(monkeypatch) -> None:
    client, factory = _client()
    teacher = _login(client, "teacher@example.test")
    student = _login(client, "student@example.test")

    rules = client.put(
        "/api/modules/1/rules",
        headers=teacher,
        json={
            "sequential_progress": True,
            "requirements": [
                {"module_item_id": 1, "requirement_type": "must_mark_done"}
            ]
        },
    )
    assert rules.status_code == 200
    blocked = client.put(
        "/api/module-items/2/progress",
        headers=student,
        json={"status": "completed"},
    )
    assert blocked.status_code == 409
    progress = client.put(
        "/api/module-items/1/progress",
        headers=student,
        json={"status": "completed"},
    )
    assert progress.status_code == 200
    assert progress.json()["status"] == "completed"
    assert client.put(
        "/api/module-items/2/progress",
        headers=student,
        json={"status": "completed"},
    ).status_code == 200

    submitted = client.post(
        "/api/assignments/1/submissions",
        headers=student,
        json={"user_id": 2, "text_entry": "My first answer"},
    )
    assert submitted.status_code == 200
    history = client.get(
        f"/api/submissions/{submitted.json()['id']}/history",
        headers=student,
    )
    assert history.status_code == 200
    assert history.json()["attempts"][0]["text_entry"] == "My first answer"

    uploaded = client.post(
        "/api/assignments/1/submissions/files",
        headers=student,
        data={"user_id": "2"},
        files=[
            ("uploads", ("answer.txt", b"answer", "text/plain")),
            ("uploads", ("evidence.txt", b"evidence", "text/plain")),
        ],
    )
    assert uploaded.status_code == 200
    history = client.get(
        f"/api/submissions/{submitted.json()['id']}/history",
        headers=student,
    ).json()
    assert len(history["attempts"]) == 2
    assert len(history["attempts"][1]["attachments"]) == 2

    folder = client.post(
        "/api/courses/1/resource-folders",
        headers=teacher,
        json={"name": "Week 1"},
    )
    assert folder.status_code == 201

    version = client.post(
        "/api/resources/1/versions",
        headers=teacher,
        json={
            "source_url": "https://example.test/syllabus-v2",
            "checksum_sha256": "a" * 64,
            "size_bytes": 123,
            "content_type": "text/html",
            "folder_id": folder.json()["id"],
            "access_scope": "user",
            "access_scope_id": 2,
        },
    )
    assert version.status_code == 201
    folders = client.get("/api/courses/1/resource-folders", headers=student)
    assert folders.status_code == 200
    assert folders.json()[0]["resource_count"] == 1
    monkeypatch.setenv("PACEWISE_API_KEY", "test-service-key")
    service_headers = {"X-PaceWise-Key": "test-service-key"}
    student_files = client.get(
        "/api/pacewise/v1/courses/1/files?user_id=2",
        headers=service_headers,
    )
    other_user_files = client.get(
        "/api/pacewise/v1/courses/1/files?user_id=1",
        headers=service_headers,
    )
    assert [item["id"] for item in student_files.json()] == [1]
    assert other_user_files.json() == []
    with factory() as db:
        assert db.scalar(select(Submission).where(Submission.id == submitted.json()["id"]))


def test_sections_groups_planner_and_analytics() -> None:
    client, _ = _client()
    teacher = _login(client, "teacher@example.test")
    student = _login(client, "student@example.test")

    section = client.post(
        "/api/courses/1/sections",
        headers=teacher,
        json={"name": "Section A"},
    )
    assert section.status_code == 201
    member = client.post(
        f"/api/sections/{section.json()['id']}/members",
        headers=teacher,
        json={"member_id": 2},
    )
    assert member.status_code == 201

    category = client.post(
        "/api/courses/1/group-categories",
        headers=teacher,
        json={"name": "Teams", "self_signup": False},
    )
    group = client.post(
        f"/api/group-categories/{category.json()['id']}/groups",
        headers=teacher,
        json={"name": "Team 1"},
    )
    assert group.status_code == 201
    assert client.post(
        f"/api/groups/{group.json()['id']}/members",
        headers=teacher,
        json={"member_id": 2},
    ).status_code == 201

    planner = client.post(
        "/api/planner",
        headers=student,
        json={"course_id": 1, "title": "Review module"},
    )
    assert planner.status_code == 201
    assert client.get("/api/planner", headers=student).json()[0]["title"] == "Review module"

    assert client.post(
        "/api/analytics/activities",
        headers=student,
        json={"course_id": 1, "activity_type": "module_view", "duration_seconds": 90},
    ).status_code == 201
    analytics = client.get("/api/courses/1/analytics", headers=teacher)
    assert analytics.status_code == 200
    assert analytics.json()["by_type"]["module_view"] == 1
