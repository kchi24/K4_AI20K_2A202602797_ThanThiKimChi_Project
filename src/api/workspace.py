import json
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from src.config import Settings, get_settings
from src.db import get_db
from src.persistence_models import (
    AgentReviewCase,
    InstructorAction,
    LoginAttempt,
    PaceWiseSession,
    UserWorkspace,
)
from src.security import SessionContext, get_current_session, require_csrf, require_instructor
from src.services.agent_memory import resolve_review_case

router = APIRouter()

WORKSPACE_KEYS = {
    "plan",
    "planHistory",
    "availability",
    "unavailable",
    "sessions",
    "wizardInput",
    "planDraft",
    "quickChecks",
    "guidance",
    "reflection",
    "settings",
    "dismissedDrifts",
    "recoveryOptions",
    "taskProgress",
    "reflections",
}


class WorkspaceRequest(BaseModel):
    state: dict


class InstructorActionRequest(BaseModel):
    action_type: str = Field(alias="actionType", pattern="^(review|assessment|guidance)$")
    entity_id: str = Field(alias="entityId", min_length=1, max_length=128)
    payload: dict = Field(default_factory=dict)


ASSESSMENT_CONTENT_FIELDS = ("question", "rubric", "level", "source")
REVIEW_STATUSES = {"pending", "in_review", "approved", "edited", "rejected", "needs_evidence"}


def _versioned_assessment_payload(
    db: Session,
    course_id: int,
    entity_id: str,
    incoming: dict,
) -> dict:
    previous_action = db.scalar(
        select(InstructorAction)
        .where(
            InstructorAction.course_id == course_id,
            InstructorAction.action_type == "assessment",
            InstructorAction.entity_id == entity_id,
        )
        .order_by(InstructorAction.created_at.desc())
    )
    previous = json.loads(previous_action.payload_json or "{}") if previous_action else {}
    version = max(0, int(previous.get("version") or 0))
    content_changed = any(
        field in incoming and incoming[field] != previous.get(field)
        for field in ASSESSMENT_CONTENT_FIELDS
    )
    if version == 0 or content_changed:
        version += 1
    return {**previous, **incoming, "version": version}


def _safe_workspace(value: dict) -> dict:
    result = {key: value[key] for key in WORKSPACE_KEYS if key in value}
    encoded = json.dumps(result, ensure_ascii=False)
    if len(encoded.encode()) > 1_000_000:
        raise HTTPException(status_code=413, detail="Workspace exceeds 1 MB")
    return result


@router.get("/workspace")
def get_workspace(
    session: SessionContext = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(UserWorkspace, session.user_id)
    return {
        "state": json.loads(row.state_json) if row else {},
        "version": row.version if row else 0,
        "updatedAt": row.updated_at.isoformat() if row else None,
    }


@router.put("/workspace")
def save_workspace(
    payload: WorkspaceRequest,
    session: SessionContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    safe = _safe_workspace(payload.state)
    row = db.get(UserWorkspace, session.user_id)
    if row:
        row.state_json = json.dumps(safe, ensure_ascii=False)
        row.version += 1
    else:
        row = UserWorkspace(user_id=session.user_id, state_json=json.dumps(safe, ensure_ascii=False))
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"version": row.version, "updatedAt": row.updated_at.isoformat()}


@router.post("/instructor/actions")
def create_instructor_action(
    payload: InstructorActionRequest,
    session: SessionContext = Depends(require_instructor),
    _: SessionContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    action_payload = dict(payload.payload)
    if payload.action_type == "assessment":
        action_payload = _versioned_assessment_payload(
            db,
            session.course_id,
            payload.entity_id,
            action_payload,
        )
    if payload.action_type == "review":
        status = str(action_payload.get("status") or "")
        if status not in REVIEW_STATUSES:
            raise HTTPException(status_code=422, detail="Unsupported review status")
    action = InstructorAction(
        id=str(uuid.uuid4()),
        course_id=session.course_id,
        actor_user_id=session.user_id,
        action_type=payload.action_type,
        entity_id=payload.entity_id,
        payload_json=json.dumps(action_payload, ensure_ascii=False),
    )
    db.add(action)
    if payload.action_type == "review":
        review_case = db.get(AgentReviewCase, payload.entity_id)
        if review_case and review_case.course_id == session.course_id:
            review_case.status = str(action_payload.get("status") or review_case.status)
            review_payload = json.loads(review_case.payload_json or "{}")
            if action_payload.get("note"):
                review_payload["instructor_note"] = action_payload["note"]
            if action_payload.get("edited_result"):
                review_payload["edited_result"] = action_payload["edited_result"]
            review_case.payload_json = json.dumps(review_payload, ensure_ascii=False)
            resolve_review_case(db, review_case, action_payload, settings)
    db.commit()
    return {
        "id": action.id,
        "createdAt": action.created_at.isoformat(),
        "payload": action_payload,
    }


def check_login_rate_limit(request: Request, email: str, db: Session, settings: Settings) -> None:
    key_hash = _login_key(request, email)
    cutoff = datetime.now(UTC) - timedelta(seconds=settings.login_rate_window_seconds)
    db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < cutoff - timedelta(days=1)))
    attempts = db.scalar(
        select(func.count(LoginAttempt.id)).where(
            LoginAttempt.key_hash == key_hash,
            LoginAttempt.created_at >= cutoff,
        )
    )
    if int(attempts or 0) >= settings.login_rate_limit:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")


def record_failed_login(request: Request, email: str, db: Session) -> None:
    key_hash = _login_key(request, email)
    db.add(LoginAttempt(key_hash=key_hash))
    db.commit()


def _login_key(request: Request, email: str) -> str:
    import hashlib

    ip = request.client.host if request.client else "unknown"
    return hashlib.sha256(f"{ip}:{email.lower().strip()}".encode()).hexdigest()


def revoke_session(session: SessionContext, db: Session) -> None:
    row = db.get(PaceWiseSession, session.sid)
    if row and not row.revoked_at:
        row.revoked_at = datetime.now(UTC)
        db.commit()
