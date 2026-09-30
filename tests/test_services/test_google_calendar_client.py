import httpx
import pytest
from cryptography.fernet import Fernet

from src.config import Settings
from src.services.google_calendar import (
    GoogleCalendarClient,
    GoogleCalendarError,
    TokenCipher,
    hash_oauth_state,
    new_oauth_state,
    new_pkce_pair,
)


def _settings(**overrides) -> Settings:
    values = {
        "google_client_id": "client-id",
        "google_client_secret": "client-secret",
        "google_token_encryption_key": Fernet.generate_key().decode(),
        "google_redirect_uri": "https://pacewise.test/callback",
    }
    values.update(overrides)
    return Settings(**values)


def test_oauth_helpers_and_token_cipher_are_safe():
    state = new_oauth_state()
    verifier, challenge = new_pkce_pair()
    assert len(state) >= 32
    assert len(hash_oauth_state(state)) == 64
    assert verifier != challenge

    cipher = TokenCipher(_settings())
    encrypted = cipher.encrypt("refresh-token")
    assert encrypted != "refresh-token"
    assert cipher.decrypt(encrypted) == "refresh-token"

    with pytest.raises(GoogleCalendarError):
        TokenCipher(_settings(google_token_encryption_key="invalid"))


@pytest.mark.asyncio
async def test_google_calendar_client_complete_flow():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/token"):
            body = request.content.decode()
            if "authorization_code" in body:
                return httpx.Response(200, json={"access_token": "access", "refresh_token": "refresh", "scope": "calendar"})
            return httpx.Response(200, json={"access_token": "renewed"})
        if path.endswith("/userinfo"):
            return httpx.Response(200, json={"email": "student@gmail.com"})
        if path.endswith("/freeBusy"):
            return httpx.Response(200, json={"calendars": {"primary": {"busy": [{"start": "2026-10-01T08:00:00Z", "end": "2026-10-01T09:00:00Z"}]}}})
        if path.endswith("/events"):
            return httpx.Response(200, json={"id": "event-1", "htmlLink": "https://calendar.test/event-1"})
        if path.endswith("/revoke"):
            return httpx.Response(200, json={})
        raise AssertionError(request.url)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = GoogleCalendarClient(_settings(), http_client)
        assert client.configured is True
        assert "code_challenge=challenge" in client.authorization_url("state", "challenge")
        tokens = await client.exchange_code("code", "verifier")
        assert tokens.refresh_token == "refresh"
        assert await client.access_token("refresh") == "renewed"
        assert await client.account_email("access") == "student@gmail.com"
        busy = await client.freebusy("access", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "Asia/Ho_Chi_Minh")
        assert busy[0]["start"] == "2026-10-01T08:00:00Z"
        event = await client.create_event(
            "access",
            "Study block",
            "2026-10-01T10:00:00+07:00",
            "2026-10-01T11:00:00+07:00",
            "Asia/Ho_Chi_Minh",
            "block-1",
        )
        assert event["id"] == "event-1"
        await client.revoke("refresh")


def test_google_calendar_requires_configuration():
    client = GoogleCalendarClient(_settings(google_client_secret=""))
    assert client.configured is False
    with pytest.raises(GoogleCalendarError):
        client.authorization_url("state", "challenge")
