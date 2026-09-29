import hashlib
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet

from src.config import Settings, get_settings
from src.db import SessionLocal
from src.main import app
from src.persistence_models import (
    GoogleCalendarConnection,
    GoogleCalendarEventLink,
    GoogleOAuthState,
    IntegrationAuditLog,
)
from src.security import decode_session
from src.services.google_calendar import OAuthTokens, TokenCipher


@pytest.fixture
def calendar_settings():
    settings = Settings(
        _env_file=None,
        app_env="test",
        pacewise_api_key="test-service-key",
        pacewise_session_secret="test-session-secret-with-at-least-32-characters",
        google_client_id="google-client-id",
        google_client_secret="google-client-secret",
        google_token_encryption_key=Fernet.generate_key().decode(),
        google_oauth_success_url="http://localhost:5173/#/settings",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture(autouse=True)
def clean_google_calendar_tables():
    with SessionLocal() as db:
        db.query(GoogleCalendarEventLink).delete()
        db.query(GoogleCalendarConnection).delete()
        db.query(GoogleOAuthState).delete()
        db.query(IntegrationAuditLog).delete()
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(GoogleCalendarEventLink).delete()
        db.query(GoogleCalendarConnection).delete()
        db.query(GoogleOAuthState).delete()
        db.query(IntegrationAuditLog).delete()
        db.commit()


async def login_student(client, monkeypatch, role="student"):
    claims = {
        "iss": "canvas-lms-simulator",
        "aud": "pacewise",
        "sub": "42",
        "course_id": 7,
        "role": role,
        "name": "Calendar Student",
        "email": "student@example.edu",
    }
    monkeypatch.setattr("src.services.lms_client.LMSClient.verify_launch", AsyncMock(return_value=claims))
    monkeypatch.setattr(
        "src.services.lms_client.LMSClient.service_get",
        AsyncMock(return_value=[{"id": 7}]),
    )
    response = await client.post("/api/v1/auth/lms-launch", json={"token": "x" * 40})
    assert response.status_code == 200
    return {"X-CSRF-Token": client.cookies["pacewise_csrf"]}


@pytest.mark.asyncio
async def test_connect_uses_minimal_scopes_state_and_pkce(client, monkeypatch, calendar_settings):
    headers = await login_student(client, monkeypatch)

    response = await client.post("/api/v1/integrations/google-calendar/connect", headers=headers)

    assert response.status_code == 200
    authorization_url = response.json()["authorizationUrl"]
    query = parse_qs(urlparse(authorization_url).query)
    assert query["access_type"] == ["offline"]
    assert query["code_challenge_method"] == ["S256"]
    assert set(query["scope"][0].split()) == set(calendar_settings.google_calendar_scopes.split())
    with SessionLocal() as db:
        state = db.get(GoogleOAuthState, hashlib.sha256(query["state"][0].encode()).hexdigest())
        assert state is not None
        assert state.session_id
        assert "google" not in state.encrypted_code_verifier.lower()


@pytest.mark.asyncio
async def test_callback_encrypts_refresh_token_and_rejects_replay(client, monkeypatch, calendar_settings):
    headers = await login_student(client, monkeypatch)
    started = await client.post("/api/v1/integrations/google-calendar/connect", headers=headers)
    state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]
    with SessionLocal() as db:
        state_row = db.get(GoogleOAuthState, hashlib.sha256(state.encode()).hexdigest())
        session = decode_session(client.cookies["pacewise_session"], calendar_settings, db)
        assert state_row is not None
        assert state_row.session_id == session.sid
    exchange = AsyncMock(
        return_value=OAuthTokens(
            access_token="short-lived-access-token",
            refresh_token="long-lived-refresh-token",
            scope=calendar_settings.google_calendar_scopes,
        )
    )
    monkeypatch.setattr("src.services.google_calendar.GoogleCalendarClient.exchange_code", exchange)

    callback = await client.get(
        "/api/v1/integrations/google-calendar/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )
    assert callback.status_code == 303, callback.text
    replay = await client.get(
        "/api/v1/integrations/google-calendar/callback",
        params={"state": state, "code": "authorization-code"},
        follow_redirects=False,
    )

    assert "google_calendar=connected" in callback.headers["location"]
    assert replay.status_code == 400
    with SessionLocal() as db:
        connection = db.get(GoogleCalendarConnection, 42)
        assert connection is not None
        assert "long-lived-refresh-token" not in connection.encrypted_refresh_token
        assert TokenCipher(calendar_settings).decrypt(connection.encrypted_refresh_token) == "long-lived-refresh-token"


def add_connection(settings: Settings) -> None:
    with SessionLocal() as db:
        db.add(
            GoogleCalendarConnection(
                user_id=42,
                encrypted_refresh_token=TokenCipher(settings).encrypt("refresh-token"),
                granted_scopes=settings.google_calendar_scopes,
            )
        )
        db.commit()


@pytest.mark.asyncio
async def test_freebusy_converts_google_intervals_without_event_details(client, monkeypatch, calendar_settings):
    headers = await login_student(client, monkeypatch)
    add_connection(calendar_settings)
    monkeypatch.setattr("src.services.google_calendar.GoogleCalendarClient.access_token", AsyncMock(return_value="access"))
    monkeypatch.setattr(
        "src.services.google_calendar.GoogleCalendarClient.freebusy",
        AsyncMock(
            return_value=[
                {"start": "2026-09-29T09:00:00+07:00", "end": "2026-09-29T10:30:00+07:00"},
            ]
        ),
    )

    response = await client.post(
        "/api/v1/integrations/google-calendar/freebusy",
        headers=headers,
        json={
            "timeMin": "2026-09-28T00:00:00+07:00",
            "timeMax": "2026-10-05T00:00:00+07:00",
            "timeZone": "Asia/Ho_Chi_Minh",
        },
    )

    assert response.status_code == 200
    assert response.json()["unavailableSlots"][0] == {
        "id": "google-2026-09-29-0900-1030",
        "label": "Google Calendar",
        "date": "2026-09-29",
        "weekday": 1,
        "start": "09:00",
        "end": "10:30",
    }
    assert "summary" not in response.text


@pytest.mark.asyncio
async def test_event_export_requires_confirmation_and_is_idempotent(client, monkeypatch, calendar_settings):
    headers = await login_student(client, monkeypatch)
    add_connection(calendar_settings)
    monkeypatch.setattr("src.services.google_calendar.GoogleCalendarClient.access_token", AsyncMock(return_value="access"))
    create = AsyncMock(return_value={"id": "google-event-1", "htmlLink": "https://calendar.google.com/event/1"})
    monkeypatch.setattr("src.services.google_calendar.GoogleCalendarClient.create_event", create)
    payload = {
        "confirmed": False,
        "timeZone": "Asia/Ho_Chi_Minh",
        "blocks": [
            {
                "blockId": "plan-1:block-1",
                "title": "PaceWise: Ôn tập",
                "start": "2026-09-29T19:00:00+07:00",
                "end": "2026-09-29T20:00:00+07:00",
            }
        ],
    }

    rejected = await client.post("/api/v1/integrations/google-calendar/events", headers=headers, json=payload)
    payload["confirmed"] = True
    created = await client.post("/api/v1/integrations/google-calendar/events", headers=headers, json=payload)
    duplicate = await client.post("/api/v1/integrations/google-calendar/events", headers=headers, json=payload)

    assert rejected.status_code == 409
    assert created.status_code == 200
    assert created.json()["created"][0]["eventId"] == "google-event-1"
    assert duplicate.json() == {"created": [], "skipped": ["plan-1:block-1"]}
    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_disconnect_revokes_google_token_before_removing_connection(client, monkeypatch, calendar_settings):
    headers = await login_student(client, monkeypatch)
    add_connection(calendar_settings)
    revoke = AsyncMock(return_value=None)
    monkeypatch.setattr("src.services.google_calendar.GoogleCalendarClient.revoke", revoke)

    response = await client.delete("/api/v1/integrations/google-calendar", headers=headers)

    assert response.status_code == 200
    revoke.assert_awaited_once_with("refresh-token")
    with SessionLocal() as db:
        assert db.get(GoogleCalendarConnection, 42) is None


@pytest.mark.asyncio
async def test_status_displays_the_connected_google_account(client, monkeypatch, calendar_settings):
    await login_student(client, monkeypatch)
    add_connection(calendar_settings)
    monkeypatch.setattr("src.services.google_calendar.GoogleCalendarClient.access_token", AsyncMock(return_value="access"))
    monkeypatch.setattr(
        "src.services.google_calendar.GoogleCalendarClient.account_email",
        AsyncMock(return_value="personal.calendar@gmail.com"),
    )

    response = await client.get("/api/v1/integrations/google-calendar/status")

    assert response.status_code == 200
    assert response.json()["accountEmail"] == "personal.calendar@gmail.com"


@pytest.mark.asyncio
async def test_instructor_cannot_connect_personal_calendar(client, monkeypatch, calendar_settings):
    headers = await login_student(client, monkeypatch, role="instructor")
    response = await client.post("/api/v1/integrations/google-calendar/connect", headers=headers)
    assert response.status_code == 403
