import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.api import lms_integration
from src.config import Settings
from src.db import SessionLocal
from src.persistence_models import AgentReviewCase, InstructorAction
from src.security import SessionContext


def _session(*, role: str = "student", course_id: int = 701) -> SessionContext:
    return SessionContext(
        user_id=12 if role == "student" else 22,
        course_id=course_id,
        course_ids=(course_id, course_id + 1),
        role=role,
        name="Test User",
        email="test@example.edu",
        csrf_hash="hash",
        sid="sid",
        exp=4_102_444_800,
    )


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        institution_id="coverage-university",
        pacewise_session_secret="test-session-secret-with-at-least-32-characters",
    )


def test_claim_validation_and_task_edge_cases():
    lms_integration._validate_claims(
        {
            "iss": "canvas-lms-simulator",
            "aud": "pacewise",
            "sub": "12",
            "course_id": "701",
            "role": "student",
        }
    )
    with pytest.raises(HTTPException, match="issuer"):
        lms_integration._validate_claims({"iss": "other", "aud": "pacewise"})
    with pytest.raises(HTTPException, match="Incomplete"):
        lms_integration._validate_claims(
            {"iss": "canvas-lms-simulator", "aud": "pacewise", "role": "student"}
        )
    with pytest.raises(HTTPException, match="Unsupported"):
        lms_integration._validate_claims(
            {
                "iss": "canvas-lms-simulator",
                "aud": "pacewise",
                "sub": "12",
                "course_id": "701",
                "role": "admin",
            }
        )

    assert lms_integration._parse_lms_datetime("not-a-date") is None
    assert lms_integration._task_priority(None) == "low"
    assert lms_integration._task_priority("not-a-date") == "medium"
    assert lms_integration._task_status(None) == "todo"
    assert lms_integration._submission_status(None)["state"] == "unsubmitted"
    task = lms_integration._task_payload(
        701,
        {"id": 3, "title": "No deadline", "points_possible": 0},
        None,
    )
    assert task["estimateMin"] == 60
    assert task["assignmentGroup"] is None


@pytest.mark.asyncio
async def test_student_sync_builds_multicourse_payload_and_review_resolutions(monkeypatch):
    settings = _settings()
    session = _session()
    calls: list[tuple[str, dict | None]] = []

    async def service_get(path, params=None):
        calls.append((path, params))
        if path == "/api/pacewise/v1/courses":
            return [
                {"id": 701, "code": "CS701", "name": "AI Systems"},
                {"id": 702, "code": "DS702", "name": "Data Systems"},
                {"id": 999, "code": "NO", "name": "Not enrolled"},
            ]
        if path == "/api/pacewise/v1/users/12/planner":
            return [{"course_id": 701, "assignment_id": 1, "title": "Todo"}]
        if path == "/api/pacewise/v1/users/12/calendar":
            return [
                {
                    "id": "event-1",
                    "source_id": 1,
                    "type": "event",
                    "course_id": 701,
                    "course_code": "CS701",
                    "title": "Online class",
                    "starts_at": "2099-10-01T10:00:00Z",
                    "ends_at": "2099-10-01T11:00:00Z",
                    "duration_minutes": 60,
                    "event_kind": "class_session",
                    "editable": False,
                }
            ]
        if path.endswith("/assignments"):
            course_id = int(path.split("/")[-2])
            return [
                {
                    "id": course_id * 10 + 1,
                    "title": f"Assignment {course_id}",
                    "due_at": "2099-10-10T10:00:00Z",
                    "points_possible": 10,
                }
            ]
        if path.endswith("/submissions"):
            return []
        if path.endswith("/modules"):
            return [{"id": 1, "name": "Week 1"}]
        if path.endswith("/files"):
            return [{"id": 1, "name": "syllabus.pdf"}]
        if path.endswith("/appointment-groups"):
            return []
        if path == "/api/pacewise/v1/courses/701/quizzes":
            return [{"title": "Quiz 1", "questions": [{"id": 501, "prompt": "Why?"}]}]
        raise AssertionError(f"Unexpected LMS path: {path}")

    fake_client = SimpleNamespace(service_get=AsyncMock(side_effect=service_get))
    monkeypatch.setattr(lms_integration, "_client", lambda _settings: fake_client)

    with SessionLocal() as db:
        db.query(InstructorAction).filter(InstructorAction.course_id == 701).delete()
        db.query(AgentReviewCase).filter(AgentReviewCase.course_id == 701).delete()
        db.add_all(
            [
                InstructorAction(
                    id="coverage-guidance",
                    course_id=701,
                    actor_user_id=22,
                    action_type="guidance",
                    entity_id="topic-1",
                    payload_json=json.dumps({"message": "Review chapter 1"}),
                ),
                InstructorAction(
                    id="coverage-assessment",
                    course_id=701,
                    actor_user_id=22,
                    action_type="assessment",
                    entity_id="Q-501",
                    payload_json=json.dumps(
                        {"status": "approved", "version": 2, "rubric": ["Reasoning"]}
                    ),
                ),
                AgentReviewCase(
                    id="coverage-review",
                    institution_id=settings.institution_id,
                    course_id=701,
                    student_user_id=12,
                    case_type="understanding_review",
                    entity_id="Q-501",
                    status="edited",
                    payload_json=json.dumps(
                        {
                            "instructor_note": "Use evidence",
                            "edited_result": {"status": "mastered"},
                        }
                    ),
                ),
            ]
        )
        db.commit()
        payload = await lms_integration._sync_payload(session, settings, db)

    assert [course["id"] for course in payload["courses"]] == ["701", "702"]
    assert len(payload["tasks"]) == 2
    assert payload["guidance"][0]["message"] == "Review chapter 1"
    assert payload["assessments"][0]["version"] == 2
    assert payload["reviewResolutions"]["coverage-review"]["resolvedStatus"] == "mastered"
    assert payload["courseData"]["701"]["plannerItems"]
    assert any(path.endswith("/files") and params == {"user_id": 12} for path, params in calls)


@pytest.mark.asyncio
async def test_course_snapshot_uses_the_effective_planner_deadline():
    session = _session()

    async def service_get(path, params=None):
        if path.endswith("/assignments"):
            return [
                {
                    "id": 9,
                    "title": "Individual deadline",
                    "due_at": "2026-10-05T23:59:00+07:00",
                    "points_possible": 10,
                }
            ]
        if path.endswith("/submissions"):
            return []
        if path.endswith("/modules") or path.endswith("/files") or path.endswith("/appointment-groups"):
            return []
        raise AssertionError(path)

    client = SimpleNamespace(service_get=AsyncMock(side_effect=service_get))
    tasks, _snapshot = await lms_integration._course_snapshot(
        client,
        {"id": 701},
        session,
        [
            {
                "id": 1,
                "course_id": 701,
                "assignment_id": 9,
                "due_at": "2026-10-06T23:59:00+07:00",
                "completed": False,
            }
        ],
    )

    assert tasks[0]["deadline"] == "2026-10-06"
    assert tasks[0]["dueAt"] == "2026-10-06T23:59:00+07:00"


@pytest.mark.asyncio
async def test_instructor_snapshot_loads_private_course_analytics(monkeypatch):
    session = _session(role="instructor")

    async def service_get(path, params=None):
        if path.endswith("/assignments"):
            return []
        if path.endswith("/submissions"):
            return []
        if path.endswith("/modules"):
            return []
        if path.endswith("/files"):
            return []
        if path.endswith("/appointment-groups"):
            return []
        if path.endswith("/sections"):
            return [{"id": 1}]
        if path.endswith("/groups"):
            return [{"id": 2}]
        if path.endswith("/analytics"):
            return {"views": 5}
        raise AssertionError(path)

    client = SimpleNamespace(service_get=AsyncMock(side_effect=service_get))
    tasks, snapshot = await lms_integration._course_snapshot(
        client,
        {"id": 701},
        session,
        [],
    )
    assert tasks == []
    assert snapshot["sections"] == [{"id": 1}]
    assert snapshot["analytics"] == {"views": 5}


@pytest.mark.asyncio
async def test_resource_proxy_enforces_role_and_scopes_student_requests(monkeypatch):
    settings = _settings()
    student = _session()
    fake_client = SimpleNamespace(service_get=AsyncMock(return_value=[{"id": 1}]))
    monkeypatch.setattr(lms_integration, "_client", lambda _settings: fake_client)

    result = await lms_integration.course_resource(701, "assignments", student, settings)
    assert result == [{"id": 1}]
    fake_client.service_get.assert_awaited_with(
        "/api/pacewise/v1/courses/701/assignments", {"user_id": 12}
    )
    with pytest.raises(HTTPException, match="Unsupported"):
        await lms_integration.course_resource(701, "secrets", student, settings)
    with pytest.raises(HTTPException, match="Instructor"):
        await lms_integration.course_resource(701, "analytics", student, settings)

    evidence = await lms_integration.learning_evidence(student, settings)
    assert evidence == [{"id": 1}]
    fake_client.service_get.assert_awaited_with(
        "/api/pacewise/v1/learning-evidence", {"course_id": 701, "user_id": 12}
    )


def _overview_service(student_count: int):
    students = [
        {"user_id": index, "role": "student"}
        for index in range(1, student_count + 1)
    ]
    assignment = {
        "id": 10,
        "title": "Project",
        "due_at": "2026-10-02T23:59:00Z",
        "assignment_group": {"id": 1},
        "rubric": {"id": 1},
    }
    submissions = [
        {
            "id": 100 + index,
            "assignment_id": 10,
            "user_id": index,
            "late": index == student_count,
            "workflow_state": "submitted",
        }
        for index in range(1, student_count + 1)
    ]

    async def service_get(path, params=None):
        if path.endswith("/enrollments"):
            return students
        if path.endswith("/assignments"):
            return [assignment]
        if path.endswith("/submissions"):
            return submissions
        if path == "/api/pacewise/v1/learning-evidence":
            return [
                {
                    "id": 1,
                    "user_id": 1,
                    "score": 4,
                    "max_score": 10,
                    "competency_key": "outcome:5",
                    "evidence_type": "quiz",
                    "source_type": "submission",
                    "source_id": 101,
                    "details": {
                        "comment": "The base case is not justified.",
                        "rubric": {"understanding": 1, "process": 2},
                    },
                    "observed_at": "2026-10-02T10:00:00Z",
                }
            ]
        if path.endswith("/quizzes"):
            return [{"title": "Quiz", "questions": [{"id": 1, "prompt": "Explain"}]}]
        if path == "/api/pacewise/v1/audit-logs":
            return [{"id": 1, "actor_user_id": None, "action": "sync", "created_at": "now"}]
        if path.endswith("/analytics"):
            return {"participation": student_count}
        if path.endswith("/sections"):
            return [{"id": 1, "name": "A", "member_ids": list(range(student_count))}]
        if path.endswith("/groups"):
            return [{"id": 1, "name": "Teams", "groups": [{"id": 1}]}]
        if path.endswith("/modules"):
            return [{"id": 1, "name": "Week 1", "requirements": [{"type": "view"}]}]
        if path.endswith("/outcomes"):
            return [{"id": 5, "title": "Recursive problem solving"}]
        raise AssertionError(path)

    return service_get


@pytest.mark.asyncio
async def test_instructor_overview_suppresses_small_groups(monkeypatch):
    settings = _settings()
    session = _session(role="instructor")
    monkeypatch.setattr(
        lms_integration,
        "_client",
        lambda _settings: SimpleNamespace(service_get=AsyncMock(side_effect=_overview_service(4))),
    )
    with SessionLocal() as db:
        result = await lms_integration.instructor_overview(session, settings, db)
    assert result["privacy"]["suppressed"] is True
    assert result["groupStats"] == {}


@pytest.mark.asyncio
async def test_instructor_overview_aggregates_anonymous_workflow_data(monkeypatch):
    settings = _settings()
    session = _session(role="instructor")
    monkeypatch.setattr(
        lms_integration,
        "_client",
        lambda _settings: SimpleNamespace(service_get=AsyncMock(side_effect=_overview_service(5))),
    )
    with SessionLocal() as db:
        db.query(InstructorAction).filter(InstructorAction.course_id == 701).delete()
        db.query(AgentReviewCase).filter(AgentReviewCase.course_id == 701).delete()
        db.add_all(
            [
                InstructorAction(
                    id="coverage-overview-assessment",
                    course_id=701,
                    actor_user_id=22,
                    action_type="assessment",
                    entity_id="Q-1",
                    payload_json=json.dumps({"status": "approved", "version": 4}),
                ),
                InstructorAction(
                    id="coverage-overview-review",
                    course_id=701,
                    actor_user_id=22,
                    action_type="review",
                    entity_id="EV-1",
                    payload_json=json.dumps({"status": "approved", "note": "Checked"}),
                ),
                AgentReviewCase(
                    id="coverage-agent-review",
                    institution_id=settings.institution_id,
                    course_id=701,
                    student_user_id=12,
                    case_type="understanding_review",
                    entity_id="Q-1",
                    status="pending",
                    payload_json=json.dumps(
                        {"assessment_result": {"status": "developing"}, "rubric_version": 4}
                    ),
                ),
            ]
        )
        db.commit()
        result = await lms_integration.instructor_overview(session, settings, db)

    stats = result["groupStats"]["all"]
    assert stats["onTimeRate"] == pytest.approx(0.8)
    assert stats["onTimeTotal"] == 5
    assert stats["weeklyCompletion"][0]["count"] == 4
    assert stats["topics"][0]["topic"] == "Recursive problem solving"
    evidence_case = next(item for item in result["reviewQueue"] if item["id"] == "EV-1")
    assert evidence_case["responseExcerpt"] == "The base case is not justified."
    assert evidence_case["rubricCriteria"][0]["name"] == "Hiểu khái niệm"
    assert evidence_case["sourceRefs"][0]["label"] == "Project"
    assert result["assessments"][0]["status"] == "approved"
    assert any(item["id"] == "coverage-agent-review" for item in result["reviewQueue"])
    assert result["lmsSummary"]["weightedAssignments"] == 1
    assert result["privacy"]["containsDirectIdentifiers"] is False
