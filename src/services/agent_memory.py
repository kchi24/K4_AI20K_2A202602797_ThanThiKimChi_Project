"""Trusted assessment context, long-term learner memory and review cases."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.config import Settings
from src.persistence_models import AgentReviewCase, InstructorAction, LearnerMemory
from src.security import SessionContext
from src.services.lms_client import LMSClient

MAX_HISTORY_ITEMS = 50


def _json(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _memory_id(institution_id: str, user_id: int, course_id: int) -> str:
    return f"{institution_id}:{user_id}:{course_id}"


def load_learner_memory(db: Session, session: SessionContext, settings: Settings) -> dict[str, Any]:
    row = db.get(
        LearnerMemory,
        _memory_id(settings.institution_id, session.user_id, session.course_id),
    )
    if not row:
        return {"profile": {}, "mastery": {}, "misconceptions": [], "history": []}
    return {
        "profile": _json(row.profile_json, {}),
        "mastery": _json(row.mastery_json, {}),
        "misconceptions": _json(row.misconceptions_json, []),
        "history": _json(row.history_json, []),
    }


async def load_approved_assessment(
    db: Session,
    session: SessionContext,
    settings: Settings,
    assessment_id: str,
) -> dict[str, Any]:
    """Resolve an approved assessment exclusively from trusted server data."""
    if not assessment_id.startswith("Q-"):
        raise HTTPException(status_code=422, detail="Unsupported assessment identifier")
    try:
        question_id = int(assessment_id.removeprefix("Q-"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid assessment identifier") from exc

    approval = db.scalar(
        select(InstructorAction)
        .where(
            InstructorAction.course_id == session.course_id,
            InstructorAction.action_type == "assessment",
            InstructorAction.entity_id == assessment_id,
        )
        .order_by(InstructorAction.created_at.desc())
    )
    approval_payload = _json(approval.payload_json, {}) if approval else {}
    if approval_payload.get("status") != "approved":
        raise HTTPException(status_code=409, detail="Assessment has not been approved by an instructor")

    quizzes = await LMSClient(settings).service_get(
        f"/api/pacewise/v1/courses/{session.course_id}/quizzes",
        {"include_answers": True},
    )
    for quiz in quizzes:
        for question in quiz.get("questions", []):
            if int(question["id"]) != question_id:
                continue
            rubric = approval_payload.get("rubric") or [
                "Đúng khái niệm",
                "Giải thích có lập luận",
                "Không sao chép đáp án",
            ]
            return {
                "assessment_id": assessment_id,
                "question": question.get("prompt", ""),
                "question_type": question.get("question_type", "open"),
                "correct_answer": question.get("correct_answer"),
                "approved_rubric": [
                    {
                        "criterion_id": f"{assessment_id}-{index}",
                        "description": str(description),
                    }
                    for index, description in enumerate(rubric, start=1)
                ],
                "topic": quiz.get("title", ""),
            }
    raise HTTPException(status_code=404, detail="Assessment no longer exists in the LMS")


def persist_agent_outcome(
    db: Session,
    session: SessionContext,
    settings: Settings,
    result: dict[str, Any],
    assessment_id: str | None,
) -> None:
    """Update durable learner memory and create instructor review cases."""
    memory_key = _memory_id(settings.institution_id, session.user_id, session.course_id)
    row = db.get(LearnerMemory, memory_key) or LearnerMemory(
        id=memory_key,
        institution_id=settings.institution_id,
        user_id=session.user_id,
        course_id=session.course_id,
    )
    db.add(row)
    profile = _json(row.profile_json, {})
    mastery = _json(row.mastery_json, {})
    misconceptions = _json(row.misconceptions_json, [])
    history = _json(row.history_json, [])
    now = datetime.now(UTC).isoformat()

    workflow = str(result.get("workflow") or result.get("current_node") or "")
    assessment = result.get("assessment_result") or {}
    if workflow == "understanding" and assessment_id and assessment:
        topic = str((result.get("request") or {}).get("topic") or assessment_id)
        mastery[topic] = {
            "assessment_id": assessment_id,
            "status": assessment.get("status"),
            "confidence": assessment.get("confidence"),
            "updated_at": now,
        }
        if "nhầm lẫn" in str(assessment.get("status") or "").casefold():
            misconceptions = [
                item for item in misconceptions if item.get("assessment_id") != assessment_id
            ]
            misconceptions.append(
                {
                    "assessment_id": assessment_id,
                    "topic": topic,
                    "evidence": assessment.get("evidence_quotes") or [],
                    "observed_at": now,
                }
            )
    if workflow == "reflect" and result.get("reflection_draft"):
        profile["last_reflection"] = result["reflection_draft"]
    if workflow == "tracking":
        profile["last_progress_metrics"] = result.get("progress_metrics") or {}

    history.append(
        {
            "workflow": workflow,
            "assessment_id": assessment_id,
            "status": result.get("status", "completed"),
            "recorded_at": now,
        }
    )
    row.profile_json = json.dumps(profile, ensure_ascii=False)
    row.mastery_json = json.dumps(mastery, ensure_ascii=False)
    row.misconceptions_json = json.dumps(misconceptions[-MAX_HISTORY_ITEMS:], ensure_ascii=False)
    row.history_json = json.dumps(history[-MAX_HISTORY_ITEMS:], ensure_ascii=False)

    pending_action = result.get("pending_action") or {}
    if workflow == "understanding" and result.get("status") == "awaiting_teacher":
        _create_review_case(
            db,
            session,
            settings,
            case_type="understanding_review",
            entity_id=assessment_id or str(uuid.uuid4()),
            payload={"pending_action": pending_action, "assessment_result": assessment},
        )
    latest = (result.get("output") or {}).get("citation_dispute")
    if latest:
        _create_review_case(
            db,
            session,
            settings,
            case_type="citation_dispute",
            entity_id=str(latest.get("dispute_id") or uuid.uuid4()),
            payload=latest,
        )
    db.commit()


def _create_review_case(
    db: Session,
    session: SessionContext,
    settings: Settings,
    *,
    case_type: str,
    entity_id: str,
    payload: dict[str, Any],
) -> None:
    duplicate = db.scalar(
        select(AgentReviewCase).where(
            AgentReviewCase.institution_id == settings.institution_id,
            AgentReviewCase.course_id == session.course_id,
            AgentReviewCase.student_user_id == session.user_id,
            AgentReviewCase.case_type == case_type,
            AgentReviewCase.entity_id == entity_id,
            AgentReviewCase.status == "pending",
        )
    )
    if duplicate:
        duplicate.payload_json = json.dumps(payload, ensure_ascii=False)
        return
    db.add(
        AgentReviewCase(
            id=f"AR-{uuid.uuid4().hex[:16]}",
            institution_id=settings.institution_id,
            course_id=session.course_id,
            student_user_id=session.user_id,
            case_type=case_type,
            entity_id=entity_id,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
    )
