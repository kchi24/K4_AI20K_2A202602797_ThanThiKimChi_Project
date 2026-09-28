from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

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
    assert state["learning_resources"][0]["document_title"] == "Giáo trình AI"
    assert config["configurable"]["thread_id"] == "pacewise:server-side-session"
