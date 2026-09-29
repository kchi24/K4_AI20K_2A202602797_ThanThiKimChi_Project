from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class PaceWiseSession(Base):
    __tablename__ = "pacewise_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    role: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320))
    active_course_id: Mapped[int] = mapped_column(Integer, index=True)
    course_ids_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserWorkspace(Base):
    __tablename__ = "pacewise_workspaces"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class InstructorAction(Base):
    __tablename__ = "pacewise_instructor_actions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    course_id: Mapped[int] = mapped_column(Integer, index=True)
    actor_user_id: Mapped[int] = mapped_column(Integer, index=True)
    action_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str] = mapped_column(String(128), index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class LoginAttempt(Base):
    __tablename__ = "pacewise_login_attempts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    key_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class SyncCursor(Base):
    __tablename__ = "pacewise_sync_cursors"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    last_event_id: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class LmsEventProjection(Base):
    """Durable copy of an LMS event before downstream processing."""

    __tablename__ = "pacewise_lms_event_projections"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    institution_id: Mapped[str] = mapped_column(String(128), index=True)
    source_event_id: Mapped[int] = mapped_column(Integer, index=True)
    event_type: Mapped[str] = mapped_column(String(128), index=True)
    aggregate_type: Mapped[str] = mapped_column(String(64), index=True)
    aggregate_id: Mapped[str] = mapped_column(String(128))
    course_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    occurred_at: Mapped[str] = mapped_column(String(64), default="")
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CourseProjection(Base):
    """Latest server-side LMS state used by risk and ingestion workflows."""

    __tablename__ = "pacewise_course_projections"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    institution_id: Mapped[str] = mapped_column(String(128), index=True)
    course_id: Mapped[int] = mapped_column(Integer, index=True)
    assignments_json: Mapped[str] = mapped_column(Text, default="[]")
    risk_signals_json: Mapped[str] = mapped_column(Text, default="[]")
    content_version: Mapped[str] = mapped_column(String(64), default="")
    risk_refresh_required: Mapped[int] = mapped_column(Integer, default=0)
    last_event_id: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class RagIngestionJob(Base):
    """PostgreSQL-backed ingestion queue; one job represents one course snapshot."""

    __tablename__ = "pacewise_rag_ingestion_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    institution_id: Mapped[str] = mapped_column(String(128), index=True)
    course_id: Mapped[int] = mapped_column(Integer, index=True)
    resource_version: Mapped[str] = mapped_column(String(64), index=True)
    resources_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class GoogleCalendarConnection(Base):
    __tablename__ = "google_calendar_connections"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    encrypted_refresh_token: Mapped[str] = mapped_column(Text)
    granted_scopes: Mapped[str] = mapped_column(Text)
    calendar_id: Mapped[str] = mapped_column(String(255), default="primary")
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_freebusy_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GoogleOAuthState(Base):
    __tablename__ = "google_oauth_states"

    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    encrypted_code_verifier: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GoogleCalendarEventLink(Base):
    __tablename__ = "google_calendar_event_links"
    __table_args__ = (UniqueConstraint("user_id", "block_id", name="uq_google_calendar_user_block"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    block_id: Mapped[str] = mapped_column(String(128), index=True)
    google_event_id: Mapped[str] = mapped_column(String(255))
    event_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    event_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IntegrationAuditLog(Base):
    __tablename__ = "pacewise_integration_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    provider: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
