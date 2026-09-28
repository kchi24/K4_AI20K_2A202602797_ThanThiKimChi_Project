from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.api.workspace import check_login_rate_limit, record_failed_login
from src.config import Settings, get_settings
from src.db import SessionLocal
from src.main import app


@pytest.fixture
def integration_settings():
    settings = Settings(
        _env_file=None,
        app_env="test",
        pacewise_api_key="test-service-key",
        pacewise_session_secret="test-session-secret-with-at-least-32-characters",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def launch_claims():
    return {
        "iss": "canvas-lms-simulator",
        "aud": "pacewise",
        "sub": "12",
        "course_id": 7,
        "role": "student",
        "name": "Student Test",
        "email": "student@example.edu",
    }


@pytest.mark.asyncio
async def test_launch_creates_http_only_session(client, monkeypatch, integration_settings, launch_claims):
    verify = AsyncMock(return_value=launch_claims)
    monkeypatch.setattr("src.services.lms_client.LMSClient.verify_launch", verify)
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.service_get",
        AsyncMock(return_value=[{"id": 7}]),
    )

    response = await client.post("/api/v1/auth/lms-launch", json={"token": "x" * 40})

    assert response.status_code == 200
    assert response.json()["user"]["role"] == "student"
    cookies = response.headers.get_list("set-cookie")
    assert any("pacewise_session=" in value and "HttpOnly" in value for value in cookies)
    assert any("pacewise_csrf=" in value and "HttpOnly" not in value for value in cookies)
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["courseId"] == "7"


@pytest.mark.asyncio
async def test_session_cannot_cross_course_or_instructor_boundary(
    client, monkeypatch, integration_settings, launch_claims
):
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.verify_launch",
        AsyncMock(return_value=launch_claims),
    )
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.service_get",
        AsyncMock(return_value=[{"id": 7}]),
    )
    assert (await client.post("/api/v1/auth/lms-launch", json={"token": "x" * 40})).status_code == 200

    cross_course = await client.get("/api/v1/lms/courses/8/assignments")
    instructor_only = await client.get("/api/v1/instructor/overview")

    assert cross_course.status_code == 403
    assert instructor_only.status_code == 403


@pytest.mark.asyncio
async def test_logout_requires_csrf(client, monkeypatch, integration_settings, launch_claims):
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.verify_launch",
        AsyncMock(return_value=launch_claims),
    )
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.service_get",
        AsyncMock(return_value=[{"id": 7}]),
    )
    await client.post("/api/v1/auth/lms-launch", json={"token": "x" * 40})
    stolen_session = client.cookies["pacewise_session"]

    rejected = await client.post("/api/v1/auth/logout")
    accepted = await client.post(
        "/api/v1/auth/logout",
        headers={"X-CSRF-Token": client.cookies["pacewise_csrf"]},
    )

    assert rejected.status_code == 403
    assert accepted.status_code == 200
    client.cookies.set("pacewise_session", stolen_session)
    assert (await client.get("/api/v1/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_switch_course_and_persist_workspace(client, monkeypatch, integration_settings, launch_claims):
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.verify_launch",
        AsyncMock(return_value=launch_claims),
    )
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.service_get",
        AsyncMock(return_value=[{"id": 7}, {"id": 8}]),
    )
    await client.post("/api/v1/auth/lms-launch", json={"token": "x" * 40})
    csrf = client.cookies["pacewise_csrf"]

    switched = await client.post(
        "/api/v1/auth/course",
        json={"courseId": 8},
        headers={"X-CSRF-Token": csrf},
    )
    saved = await client.put(
        "/api/v1/workspace",
        json={"state": {"plan": {"id": "plan-1"}, "user": {"should": "not persist"}}},
        headers={"X-CSRF-Token": csrf},
    )
    loaded = await client.get("/api/v1/workspace")

    assert switched.json()["courseId"] == "8"
    assert saved.status_code == 200
    assert loaded.json()["state"]["plan"]["id"] == "plan-1"
    assert "user" not in loaded.json()["state"]


def test_login_rate_limit_is_shared_in_database():
    settings = Settings(_env_file=None, login_rate_limit=2, login_rate_window_seconds=600)
    request = SimpleNamespace(client=SimpleNamespace(host="203.0.113.10"))
    with SessionLocal() as db:
        record_failed_login(request, "student@example.edu", db)
        check_login_rate_limit(request, "student@example.edu", db, settings)
        record_failed_login(request, "student@example.edu", db)
        with pytest.raises(HTTPException) as blocked:
            check_login_rate_limit(request, "student@example.edu", db, settings)
    assert blocked.value.status_code == 429


def test_settings_can_read_mounted_secret_files(tmp_path):
    api_key_file = tmp_path / "api-key"
    session_secret_file = tmp_path / "session-secret"
    api_key_file.write_text("mounted-api-key", encoding="utf-8")
    session_secret_file.write_text("mounted-session-secret-with-32-characters", encoding="utf-8")

    settings = Settings(
        _env_file=None,
        pacewise_api_key_file=str(api_key_file),
        pacewise_session_secret_file=str(session_secret_file),
    )

    assert settings.pacewise_api_key == "mounted-api-key"
    assert settings.pacewise_session_secret == "mounted-session-secret-with-32-characters"


@pytest.mark.asyncio
async def test_security_headers_are_present(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
