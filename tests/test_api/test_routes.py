from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.api.routes import _learning_thread_id, _load_lms_agent_context
from src.config import get_settings
from src.main import app
from src.security import SessionContext, require_csrf


@pytest.fixture
def authenticated_student():
    session = SessionContext(
        user_id=12,
        course_id=7,
        course_ids=(7,),
        role="student",
        name="Student Test",
        email="student@example.edu",
        csrf_hash="test",
        sid="server-side-session",
        exp=4_102_444_800,
    )
    app.dependency_overrides[require_csrf] = lambda: session
    yield session
    app.dependency_overrides.pop(require_csrf, None)


def _lms_response(path: str, _params=None):
    if path == "/api/pacewise/v1/courses":
        return [{"id": 7, "code": "AI101", "name": "Nhập môn AI"}]
    if path.endswith("/assignments"):
        return [
            {
                "id": 21,
                "title": "Bài giữa kỳ",
                "description": "Giải thích overfitting",
                "due_at": "2026-10-01T10:00:00Z",
                "points_possible": 10,
            }
        ]
    if path.endswith("/content"):
        return [{"id": 1, "title": "Giáo trình AI", "body": "Overfitting là học quá sát dữ liệu."}]
    if path.endswith("/submissions"):
        return [{"assignment_id": 21, "workflow_state": "unsubmitted"}]
    raise AssertionError(f"Unexpected LMS path: {path}")


def test_learning_thread_is_stable_across_login_sessions_and_isolated_by_course():
    now = datetime(2026, 9, 29, tzinfo=UTC)
    settings = get_settings()
    first = SessionContext(12, 7, (7,), "student", "A", "a@x.edu", "x", "sid-1", 1)
    relogin = SessionContext(12, 7, (7,), "student", "A", "a@x.edu", "y", "sid-2", 2)
    other_course = SessionContext(12, 8, (8,), "student", "A", "a@x.edu", "z", "sid-3", 3)

    assert _learning_thread_id(first, settings, now) == _learning_thread_id(relogin, settings, now)
    assert _learning_thread_id(first, settings, now) != _learning_thread_id(other_course, settings, now)


@pytest.mark.asyncio
async def test_lms_context_normalizes_assignment_ids_across_courses(monkeypatch):
    session = SessionContext(12, 7, (7, 8), "student", "A", "a@x.edu", "x", "sid", 1)

    async def service_get(_client, path, _params=None):
        if path == "/api/pacewise/v1/courses":
            return [
                {"id": 7, "code": "AI101", "name": "AI"},
                {"id": 8, "code": "DB101", "name": "Database"},
            ]
        if path.endswith("/7/assignments"):
            return [{"id": 21, "title": "AI task", "points_possible": 10}]
        if path.endswith("/8/assignments"):
            return [{"id": 31, "title": "DB task", "points_possible": 5}]
        if path.endswith("/submissions"):
            return []
        raise AssertionError(path)

    monkeypatch.setattr("src.api.routes.LMSClient.service_get", service_get)
    context = await _load_lms_agent_context(session, get_settings())

    assert [item["id"] for item in context["assignments"]] == ["7:21", "8:31"]


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_metrics_endpoint(client):
    response = await client.get("/metrics")
    assert response.status_code == 200
    assert "# PaceWise application metrics" in response.text


@pytest.mark.asyncio
async def test_chat_empty_message(client, authenticated_student):
    response = await client.post("/api/v1/chat", json={"message": ""})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_agent_status(client):
    response = await client.get("/api/v1/status")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_chat_requires_pacewise_session(client):
    response = await client.post("/api/v1/chat", json={"message": "Giải thích overfitting"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_chat_uses_authenticated_identity_and_lms_context(
    client,
    authenticated_student,
    monkeypatch,
):
    service_get = AsyncMock(side_effect=_lms_response)
    monkeypatch.setattr("src.api.routes.LMSClient.service_get", service_get)
    ainvoke = AsyncMock(
        return_value={
            "response": "Overfitting là học quá sát dữ liệu. [Giáo trình AI, Trang 1, Đoạn 1]",
            "workflow": "qa",
            "status": "completed",
            "progress_metrics": {"completion_rate": 0.5},
            "risk_signals": [{"assignment_id": "21", "level": "high"}],
            "source_refs": [{"citation": "[Giáo trình AI, Trang 1, Đoạn 1]"}],
        }
    )
    monkeypatch.setattr("src.api.routes.agent", SimpleNamespace(ainvoke=ainvoke))

    response = await client.post(
        "/api/v1/chat",
        json={
            "message": "Giải thích overfitting",
            "workflow": "qa",
            "context": {
                "student_id": "attacker",
                "course_id": "999",
                "role": "instructor",
                "approved_rubric": [{"criterion_id": "c1", "description": "Correct explanation"}],
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["mode"] == "grounded"
    assert response.json()["progress_metrics"]["completion_rate"] == 0.5
    assert response.json()["risk_signals"][0]["level"] == "high"
    state = ainvoke.await_args.args[0]
    config = ainvoke.await_args.kwargs["config"]
    assert state["student_id"] == str(authenticated_student.user_id)
    assert state["course_id"] == str(authenticated_student.course_id)
    assert state["course_code"] == "AI101"
    assert state["role"] == "student"
    assert state["approved_rubric"][0]["criterion_id"] == "c1"
    assert state["assignments"][0]["title"] == "Bài giữa kỳ"
    assert state["assignments"][0]["id"] == "7:21"
    assert state["learning_resources"] == []
    assert not any(call.args[0].endswith("/content") for call in service_get.await_args_list)
    thread_id = config["configurable"]["thread_id"]
    assert thread_id.startswith("university-x:12:7:")
    assert "week-" in thread_id


@pytest.mark.asyncio
async def test_plan_returns_server_side_canonical_schedule(client, authenticated_student, monkeypatch):
    monkeypatch.setattr("src.api.routes.LMSClient.service_get", AsyncMock(side_effect=_lms_response))
    ainvoke = AsyncMock(
        return_value={
            "response": "Bản kế hoạch nháp.",
            "workflow": "plan",
            "status": "awaiting_student",
            "output": {
                "plan_validation": {
                    "valid": False,
                    "errors": [{"code": "LLM_MILESTONE_ESTIMATE"}],
                }
            },
        }
    )
    monkeypatch.setattr("src.api.routes.agent", SimpleNamespace(ainvoke=ainvoke))
    response = await client.post(
        "/api/v1/chat",
        json={
            "message": "Lập kế hoạch",
            "workflow": "plan",
            "context": {
                "plan_input": {
                    "goal": "Xong bài giữa kỳ",
                    "tasks": [{"taskId": "7:21", "remainingMin": 60}],
                    "availability": [
                        {"weekday": index, "enabled": True, "start": "18:00", "end": "20:00"} for index in range(7)
                    ],
                    "unavailable": [],
                    "preferred": "evening",
                }
            },
        },
    )
    assert response.status_code == 200
    draft = response.json()["output"]["plan_draft"]
    assert response.json()["output"]["plan_validation"]["valid"] is True
    assert response.json()["output"]["milestone_validation"]["valid"] is False
    assert draft["feasibility"]["feasible"] is True
    assert (
        sum(
            (int(block["end"][:2]) * 60 + int(block["end"][3:]))
            - (int(block["start"][:2]) * 60 + int(block["start"][3:]))
            for block in draft["blocks"]
        )
        == 60
    )
