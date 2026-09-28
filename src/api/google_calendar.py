"""Authenticated Google Calendar integration for PaceWise students."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.config import Settings, get_settings
from src.db import get_db
from src.persistence_models import (
    GoogleCalendarConnection,
    GoogleCalendarEventLink,
    GoogleOAuthState,
    IntegrationAuditLog,
)
from src.security import SessionContext, get_current_session, require_csrf
from src.services.google_calendar import (
    GoogleCalendarClient,
    GoogleCalendarError,
    TokenCipher,
    hash_oauth_state,
    new_oauth_state,
    new_pkce_pair,
)

router = APIRouter(prefix="/integrations/google-calendar", tags=["Google Calendar"])


class FreeBusyRequest(BaseModel):
    time_min: AwareDatetime = Field(alias="timeMin")
    time_max: AwareDatetime = Field(alias="timeMax")
    time_zone: str = Field(default="Asia/Ho_Chi_Minh", alias="timeZone", max_length=64)

    @model_validator(mode="after")
    def validate_window(self) -> FreeBusyRequest:
        if self.time_max <= self.time_min:
            raise ValueError("timeMax must be after timeMin")
        if self.time_max - self.time_min > timedelta(days=31):
            raise ValueError("Availability window cannot exceed 31 days")
        try:
            ZoneInfo(self.time_zone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unsupported time zone") from exc
        return self


class CalendarBlock(BaseModel):
    block_id: str = Field(alias="blockId", min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=200)
    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def validate_duration(self) -> CalendarBlock:
        if self.end <= self.start:
            raise ValueError("Block end must be after start")
        if self.end - self.start > timedelta(hours=12):
            raise ValueError("A study block cannot exceed 12 hours")
        return self


class ExportEventsRequest(BaseModel):
    confirmed: bool
    time_zone: str = Field(default="Asia/Ho_Chi_Minh", alias="timeZone", max_length=64)
    blocks: list[CalendarBlock] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_time_zone(self) -> ExportEventsRequest:
        try:
            ZoneInfo(self.time_zone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unsupported time zone") from exc
        return self


def _student(session: SessionContext) -> None:
    if session.role != "student":
        raise HTTPException(status_code=403, detail="Google Calendar is available to students only")


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _audit(db: Session, user_id: int, action: str, details: dict | None = None) -> None:
    db.add(
        IntegrationAuditLog(
            user_id=user_id,
            provider="google_calendar",
            action=action,
            details_json=json.dumps(details or {}, ensure_ascii=False),
        )
    )


def _connection(db: Session, user_id: int) -> GoogleCalendarConnection:
    row = db.get(GoogleCalendarConnection, user_id)
    if not row:
        raise HTTPException(status_code=409, detail="Google Calendar is not connected")
    return row


def _integration(settings: Settings) -> tuple[GoogleCalendarClient, TokenCipher]:
    client = GoogleCalendarClient(settings)
    if not client.configured:
        raise HTTPException(status_code=503, detail="Google Calendar is not configured")
    try:
        return client, TokenCipher(settings)
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _redirect(settings: Settings, **params: str) -> RedirectResponse:
    separator = "&" if "?" in settings.google_oauth_success_url else "?"
    return RedirectResponse(f"{settings.google_oauth_success_url}{separator}{urlencode(params)}", status_code=303)


@router.get("/status")
def status(
    session: SessionContext = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    _student(session)
    connection = db.get(GoogleCalendarConnection, session.user_id)
    return {
        "configured": GoogleCalendarClient(settings).configured,
        "connected": connection is not None,
        "calendarId": connection.calendar_id if connection else None,
        "connectedAt": connection.connected_at.isoformat() if connection else None,
        "lastFreeBusySyncAt": connection.last_freebusy_sync_at.isoformat() if connection and connection.last_freebusy_sync_at else None,
    }


@router.post("/connect")
def connect(
    session: SessionContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    _student(session)
    client, cipher = _integration(settings)
    state = new_oauth_state()
    verifier, challenge = new_pkce_pair()
    now = datetime.now(UTC)
    db.execute(
        delete(GoogleOAuthState).where(
            (GoogleOAuthState.expires_at < now) | (GoogleOAuthState.used_at.is_not(None))
        )
    )
    db.add(
        GoogleOAuthState(
            state_hash=hash_oauth_state(state),
            user_id=session.user_id,
            session_id=session.sid,
            encrypted_code_verifier=cipher.encrypt(verifier),
            expires_at=now + timedelta(minutes=10),
        )
    )
    _audit(db, session.user_id, "oauth_started")
    db.commit()
    return {"authorizationUrl": client.authorization_url(state, challenge)}


@router.get("/callback")
async def callback(
    state: str = Query(min_length=20, max_length=256),
    code: str | None = Query(default=None, max_length=4096),
    error: str | None = Query(default=None, max_length=128),
    session: SessionContext = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    _student(session)
    client, cipher = _integration(settings)
    row = db.get(GoogleOAuthState, hash_oauth_state(state))
    now = datetime.now(UTC)
    expired = row is None or _utc(row.expires_at) <= now
    if expired or row.used_at or row.user_id != session.user_id or row.session_id != session.sid:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
    row.used_at = now
    db.commit()
    if error or not code:
        _audit(db, session.user_id, "oauth_denied", {"reason": error or "missing_code"})
        db.commit()
        return _redirect(settings, google_calendar="denied")
    try:
        tokens = await client.exchange_code(code, cipher.decrypt(row.encrypted_code_verifier))
        existing = db.get(GoogleCalendarConnection, session.user_id)
        refresh_token = tokens.refresh_token
        if not refresh_token and existing:
            refresh_token = cipher.decrypt(existing.encrypted_refresh_token)
        if not refresh_token:
            raise GoogleCalendarError("Google did not grant offline access; reconnect and approve access")
        required_scopes = set(settings.google_calendar_scopes.split())
        if not required_scopes.issubset(set(tokens.scope.split())):
            raise GoogleCalendarError("Required Calendar permissions were not granted")
        if existing:
            existing.encrypted_refresh_token = cipher.encrypt(refresh_token)
            existing.granted_scopes = tokens.scope
            existing.updated_at = now
        else:
            db.add(
                GoogleCalendarConnection(
                    user_id=session.user_id,
                    encrypted_refresh_token=cipher.encrypt(refresh_token),
                    granted_scopes=tokens.scope,
                )
            )
        _audit(db, session.user_id, "connected")
        db.commit()
    except GoogleCalendarError as exc:
        db.rollback()
        _audit(db, session.user_id, "oauth_failed", {"reason": str(exc)})
        db.commit()
        return _redirect(settings, google_calendar="error")
    return _redirect(settings, google_calendar="connected")


def _busy_slots(busy: list[dict[str, str]], time_zone: str) -> list[dict]:
    zone = ZoneInfo(time_zone)
    slots: list[dict] = []
    for interval in busy:
        start = datetime.fromisoformat(interval["start"].replace("Z", "+00:00")).astimezone(zone)
        end = datetime.fromisoformat(interval["end"].replace("Z", "+00:00")).astimezone(zone)
        cursor = start
        while cursor.date() < end.date():
            midnight = datetime.combine(cursor.date() + timedelta(days=1), datetime.min.time(), zone)
            slot_id = f"google-{cursor.date().isoformat()}-{cursor.strftime('%H%M')}-2359"
            slots.append(
                {
                    "id": slot_id,
                    "label": "Google Calendar",
                    "date": cursor.date().isoformat(),
                    "weekday": cursor.weekday(),
                    "start": cursor.strftime("%H:%M"),
                    "end": "23:59",
                }
            )
            cursor = midnight
        if cursor < end:
            slot_id = f"google-{cursor.date().isoformat()}-{cursor.strftime('%H%M')}-{end.strftime('%H%M')}"
            slots.append(
                {
                    "id": slot_id,
                    "label": "Google Calendar",
                    "date": cursor.date().isoformat(),
                    "weekday": cursor.weekday(),
                    "start": cursor.strftime("%H:%M"),
                    "end": end.strftime("%H:%M"),
                }
            )
    return slots


@router.post("/freebusy")
async def freebusy(
    payload: FreeBusyRequest,
    session: SessionContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    _student(session)
    client, cipher = _integration(settings)
    connection = _connection(db, session.user_id)
    try:
        access_token = await client.access_token(cipher.decrypt(connection.encrypted_refresh_token))
        busy = await client.freebusy(
            access_token,
            payload.time_min.isoformat(),
            payload.time_max.isoformat(),
            payload.time_zone,
            connection.calendar_id,
        )
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    connection.last_freebusy_sync_at = datetime.now(UTC)
    _audit(db, session.user_id, "freebusy_read", {"busyCount": len(busy)})
    db.commit()
    return {"busy": busy, "unavailableSlots": _busy_slots(busy, payload.time_zone)}


@router.post("/events")
async def export_events(
    payload: ExportEventsRequest,
    session: SessionContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    _student(session)
    if not payload.confirmed:
        raise HTTPException(status_code=409, detail="Explicit confirmation is required before creating calendar events")
    client, cipher = _integration(settings)
    connection = _connection(db, session.user_id)
    try:
        access_token = await client.access_token(cipher.decrypt(connection.encrypted_refresh_token))
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    created: list[dict] = []
    skipped: list[str] = []
    for block in payload.blocks:
        existing = db.scalar(
            select(GoogleCalendarEventLink).where(
                GoogleCalendarEventLink.user_id == session.user_id,
                GoogleCalendarEventLink.block_id == block.block_id,
            )
        )
        if existing:
            skipped.append(block.block_id)
            continue
        try:
            event = await client.create_event(
                access_token,
                block.title,
                block.start.isoformat(),
                block.end.isoformat(),
                payload.time_zone,
                block.block_id,
                connection.calendar_id,
            )
        except GoogleCalendarError as exc:
            db.rollback()
            raise HTTPException(
                status_code=502,
                detail=f"Created {len(created)} event(s) before Google Calendar failed: {exc}",
            ) from exc
        db.add(
            GoogleCalendarEventLink(
                user_id=session.user_id,
                block_id=block.block_id,
                google_event_id=str(event["id"]),
                event_start=block.start,
                event_end=block.end,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            skipped.append(block.block_id)
            continue
        created.append({"blockId": block.block_id, "eventId": event["id"], "htmlLink": event.get("htmlLink")})
    _audit(db, session.user_id, "events_exported", {"created": len(created), "skipped": len(skipped)})
    db.commit()
    return {"created": created, "skipped": skipped}


@router.delete("")
async def disconnect(
    session: SessionContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    _student(session)
    client, cipher = _integration(settings)
    connection = _connection(db, session.user_id)
    try:
        await client.revoke(cipher.decrypt(connection.encrypted_refresh_token))
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=502, detail=f"Google access could not be revoked: {exc}") from exc
    db.delete(connection)
    _audit(db, session.user_id, "disconnected_and_revoked")
    db.commit()
    return {"disconnected": True, "tokenRevoked": True}
