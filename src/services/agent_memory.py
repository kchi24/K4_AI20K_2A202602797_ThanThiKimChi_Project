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
                "rubric_version": max(1, int(approval_payload.get("version") or 1)),
            }
    raise HTTPException(status_code=404, detail="Assessment no longer exists in the LMS")


def persist_agent_outcome(
    db: Session,
    session: SessionContext,
    settings: Settings,
    result: dict[str, Any],
    assessment_id: str | None,
) -> str | None:
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
    is_provisional = workflow == "understanding" and result.get("status") == "awaiting_teacher"
    if workflow == "understanding" and assessment_id and assessment and not is_provisional:
        topic = str((result.get("request") or {}).get("topic") or assessment_id)
        mastery, misconceptions = _apply_assessment_result(
            mastery,
            misconceptions,
            assessment_id=assessment_id,
            topic=topic,
            assessment=assessment,
            recorded_at=now,
        )
    if (
        workflow == "reflect"
        and result.get("status") == "completed"
        and result.get("reflection_draft")
    ):
        profile["last_reflection"] = result["reflection_draft"]
        profile["next_week_adjustment"] = {
            "effective_week_start": result["reflection_draft"].get(
                "effective_week_start"
            ),
            "adjustment": result["reflection_draft"].get("adjustment"),
            "confirmed_at": now,
        }
    if workflow == "tracking":
        profile["last_progress_metrics"] = result.get("progress_metrics") or {}
    if workflow == "do" and isinstance((result.get("output") or {}).get("do_session"), dict):
        do_session = (result.get("output") or {})["do_session"]
        profile["last_do_session"] = do_session
        do_history = list(profile.get("do_history") or [])
        do_history.append({**do_session, "recorded_at": now})
        profile["do_history"] = do_history[-20:]

    history.append(
        {
            "workflow": workflow,
            "assessment_id": assessment_id,
            "status": result.get("status", "completed"),
            "rubric_version": assessment.get("rubric_version"),
            "provisional": is_provisional,
            "recorded_at": now,
        }
    )
    row.profile_json = json.dumps(profile, ensure_ascii=False)
    row.mastery_json = json.dumps(mastery, ensure_ascii=False)
    row.misconceptions_json = json.dumps(misconceptions[-MAX_HISTORY_ITEMS:], ensure_ascii=False)
    row.history_json = json.dumps(history[-MAX_HISTORY_ITEMS:], ensure_ascii=False)

    pending_action = result.get("pending_action") or {}
    review_case_id = None
    if workflow == "understanding" and result.get("status") == "awaiting_teacher":
        review_case_id = _create_review_case(
            db,
            session,
            settings,
            case_type="understanding_review",
            entity_id=assessment_id or str(uuid.uuid4()),
            payload={
                "pending_action": pending_action,
                "assessment_result": assessment,
                "topic": str((result.get("request") or {}).get("topic") or assessment_id or ""),
                "rubric_version": assessment.get("rubric_version"),
            },
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
    return review_case_id


def _apply_assessment_result(
    mastery: dict[str, Any],
    misconceptions: list[dict[str, Any]],
    *,
    assessment_id: str,
    topic: str,
    assessment: dict[str, Any],
    recorded_at: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    next_mastery = dict(mastery)
    next_misconceptions = [
        item for item in misconceptions if item.get("assessment_id") != assessment_id
    ]
    next_mastery[topic] = {
        "assessment_id": assessment_id,
        "status": assessment.get("status"),
        "confidence": assessment.get("confidence"),
        "rubric_version": assessment.get("rubric_version"),
        "updated_at": recorded_at,
    }
    normalized_status = str(assessment.get("status") or "").casefold()
    if "nhầm lẫn" in normalized_status or "misconception" in normalized_status:
        next_misconceptions.append(
            {
                "assessment_id": assessment_id,
                "topic": topic,
                "evidence": assessment.get("evidence_quotes") or [],
                "rubric_version": assessment.get("rubric_version"),
                "observed_at": recorded_at,
            }
        )
    return next_mastery, next_misconceptions


def resolve_review_case(
    db: Session,
    review_case: AgentReviewCase,
    decision: dict[str, Any],
    settings: Settings,
) -> None:
    """Apply only a teacher-confirmed understanding result to learner memory."""
    status = str(decision.get("status") or "")
    if review_case.case_type != "understanding_review" or status not in {"approved", "edited"}:
        return
    case_payload = _json(review_case.payload_json, {})
    assessment = dict(case_payload.get("assessment_result") or {})
    if status == "edited":
        assessment.update(decision.get("edited_result") or case_payload.get("edited_result") or {})
    assessment["confidence"] = "teacher_confirmed"
    assessment["rubric_version"] = (
        case_payload.get("rubric_version") or assessment.get("rubric_version")
    )
    topic = str(case_payload.get("topic") or review_case.entity_id)
    memory_key = _memory_id(
        settings.institution_id,
        review_case.student_user_id,
        review_case.course_id,
    )
    row = db.get(LearnerMemory, memory_key) or LearnerMemory(
        id=memory_key,
        institution_id=settings.institution_id,
        user_id=review_case.student_user_id,
        course_id=review_case.course_id,
    )
    db.add(row)
    mastery = _json(row.mastery_json, {})
    misconceptions = _json(row.misconceptions_json, [])
    history = _json(row.history_json, [])
    now = datetime.now(UTC).isoformat()
    mastery, misconceptions = _apply_assessment_result(
        mastery,
        misconceptions,
        assessment_id=review_case.entity_id,
        topic=topic,
        assessment=assessment,
        recorded_at=now,
    )
    history = [item for item in history if item.get("review_case_id") != review_case.id]
    history.append(
        {
            "workflow": "understanding_review",
            "assessment_id": review_case.entity_id,
            "review_case_id": review_case.id,
            "status": status,
            "rubric_version": assessment.get("rubric_version"),
            "recorded_at": now,
        }
    )
    row.mastery_json = json.dumps(mastery, ensure_ascii=False)
    row.misconceptions_json = json.dumps(
        misconceptions[-MAX_HISTORY_ITEMS:], ensure_ascii=False
    )
    row.history_json = json.dumps(history[-MAX_HISTORY_ITEMS:], ensure_ascii=False)


def _create_review_case(
    db: Session,
    session: SessionContext,
    settings: Settings,
    *,
    case_type: str,
    entity_id: str,
    payload: dict[str, Any],
) -> str:
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
        return duplicate.id
    review_case = AgentReviewCase(
        id=f"AR-{uuid.uuid4().hex[:16]}",
        institution_id=settings.institution_id,
        course_id=session.course_id,
        student_user_id=session.user_id,
        case_type=case_type,
        entity_id=entity_id,
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(review_case)
    return review_case.id
