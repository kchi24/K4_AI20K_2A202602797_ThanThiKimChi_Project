import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, IntegrationEvent


def _json(data: dict[str, Any] | None) -> str:
    return json.dumps(data or {}, ensure_ascii=False, default=_json_default)


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def record_change(
    db: Session,
    *,
    actor_user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | str | None,
    course_id: int | None = None,
    metadata: dict[str, Any] | None = None,
    emit_event: bool = True,
) -> None:
    entity_id_text = "" if entity_id is None else str(entity_id)
    metadata_json = _json(metadata)
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id_text,
            course_id=course_id,
            metadata_json=metadata_json,
        )
    )
    if emit_event:
        db.add(
            IntegrationEvent(
                event_type=action,
                aggregate_type=entity_type,
                aggregate_id=entity_id_text,
                course_id=course_id,
                actor_user_id=actor_user_id,
                payload_json=metadata_json,
            )
        )
