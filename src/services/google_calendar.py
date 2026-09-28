"""Small Google OAuth/Calendar REST client with no Google SDK runtime cost."""

from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from src.config import Settings

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"


class GoogleCalendarError(RuntimeError):
    """A safe, user-displayable integration error."""


@dataclass(frozen=True)
class OAuthTokens:
    access_token: str
    refresh_token: str | None
    scope: str


def new_oauth_state() -> str:
    return secrets.token_urlsafe(32)


def hash_oauth_state(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return verifier, challenge


class TokenCipher:
    def __init__(self, settings: Settings):
        key = settings.google_token_encryption_key.strip()
        if not key:
            raise GoogleCalendarError("Google Calendar token encryption is not configured")
        try:
            self._fernet = Fernet(key.encode())
        except (TypeError, ValueError) as exc:
            raise GoogleCalendarError("GOOGLE_TOKEN_ENCRYPTION_KEY must be a valid Fernet key") from exc

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str:
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except InvalidToken as exc:
            raise GoogleCalendarError("Stored Google Calendar credentials cannot be decrypted") from exc


class GoogleCalendarClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._client = client

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.google_client_id.strip()
            and self.settings.google_client_secret.strip()
            and self.settings.google_token_encryption_key.strip()
        )

    def authorization_url(self, state: str, code_challenge: str) -> str:
        if not self.configured:
            raise GoogleCalendarError("Google Calendar is not configured")
        params = {
            "client_id": self.settings.google_client_id,
            "redirect_uri": self.settings.google_redirect_uri,
            "response_type": "code",
            "scope": self.settings.google_calendar_scopes,
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"

    async def _post(self, url: str, **kwargs: Any) -> httpx.Response:
        try:
            if self._client:
                response = await self._client.post(url, timeout=15, **kwargs)
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, timeout=15, **kwargs)
        except httpx.HTTPError as exc:
            raise GoogleCalendarError("Cannot reach Google Calendar") from exc
        if response.status_code >= 400:
            raise GoogleCalendarError(f"Google Calendar rejected the request ({response.status_code})")
        return response

    async def _get(self, url: str, **kwargs: Any) -> httpx.Response:
        try:
            if self._client:
                response = await self._client.get(url, timeout=15, **kwargs)
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.get(url, timeout=15, **kwargs)
        except httpx.HTTPError as exc:
            raise GoogleCalendarError("Cannot reach Google Calendar") from exc
        if response.status_code >= 400:
            raise GoogleCalendarError(f"Google Calendar rejected the request ({response.status_code})")
        return response

    async def exchange_code(self, code: str, code_verifier: str) -> OAuthTokens:
        response = await self._post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret,
                "code": code,
                "code_verifier": code_verifier,
                "grant_type": "authorization_code",
                "redirect_uri": self.settings.google_redirect_uri,
            },
        )
        payload = response.json()
        if not payload.get("access_token"):
            raise GoogleCalendarError("Google did not return an access token")
        return OAuthTokens(
            access_token=str(payload["access_token"]),
            refresh_token=str(payload["refresh_token"]) if payload.get("refresh_token") else None,
            scope=str(payload.get("scope", self.settings.google_calendar_scopes)),
        )

    async def access_token(self, refresh_token: str) -> str:
        response = await self._post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        token = response.json().get("access_token")
        if not token:
            raise GoogleCalendarError("Google did not refresh the access token")
        return str(token)

    async def account_email(self, access_token: str) -> str | None:
        response = await self._get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        email = response.json().get("email")
        return str(email) if email else None

    async def freebusy(
        self,
        access_token: str,
        time_min: str,
        time_max: str,
        time_zone: str,
        calendar_id: str = "primary",
    ) -> list[dict[str, str]]:
        response = await self._post(
            f"{GOOGLE_CALENDAR_API}/freeBusy",
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "timeMin": time_min,
                "timeMax": time_max,
                "timeZone": time_zone,
                "items": [{"id": calendar_id}],
            },
        )
        calendars = response.json().get("calendars", {})
        calendar = calendars.get(calendar_id)
        if calendar is None and len(calendars) == 1:
            calendar = next(iter(calendars.values()))
        calendar = calendar or {}
        if calendar.get("errors"):
            raise GoogleCalendarError("Google could not read calendar availability")
        return [
            {"start": str(item["start"]), "end": str(item["end"])}
            for item in calendar.get("busy", [])
            if item.get("start") and item.get("end")
        ]

    async def create_event(
        self,
        access_token: str,
        summary: str,
        start: str,
        end: str,
        time_zone: str,
        block_id: str,
        calendar_id: str = "primary",
    ) -> dict[str, Any]:
        response = await self._post(
            f"{GOOGLE_CALENDAR_API}/calendars/{quote(calendar_id, safe='')}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"sendUpdates": "none"},
            json={
                "summary": summary,
                "description": "Study block created by PaceWise after student confirmation.",
                "start": {"dateTime": start, "timeZone": time_zone},
                "end": {"dateTime": end, "timeZone": time_zone},
                "extendedProperties": {"private": {"pacewiseBlockId": block_id}},
            },
        )
        payload = response.json()
        if not payload.get("id"):
            raise GoogleCalendarError("Google did not return the created event")
        return payload

    async def revoke(self, token: str) -> None:
        await self._post(
            GOOGLE_REVOKE_URL,
            data={"token": token},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
