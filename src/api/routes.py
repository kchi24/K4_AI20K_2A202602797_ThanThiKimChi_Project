import json
import logging
import re
from asyncio import gather
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from src.agents.graph import agent
from src.agents.safety import enforce_output_policy
from src.config import Settings, get_settings
from src.db import get_db
from src.models.schemas import ChatRequest, ChatResponse
from src.persistence_models import LmsCourseContextProjection
from src.security import SessionContext, require_csrf
from src.services.agent_memory import (
    load_approved_assessment,
    load_learner_memory,
    persist_agent_outcome,
)
from src.services.lms_client import LMSClient
from src.services.planning import build_plan_draft

router = APIRouter()
logger = logging.getLogger("pacewise.api.agent")
_CLIENT_CONTEXT_FIELDS = {
    "availability",
    "unavailable_slots",
    "current_plan",
    "progress_metrics",
    "proposed_milestones",
    "goals",
    "assessment_id",
    "plan_input",
    "planning_stage",
}


def _learning_thread_id(
    session: SessionContext,
    settings: Settings,
    now: datetime | None = None,
) -> str:
    """Return a login-independent memory key for one weekly course cycle."""
    current = now or datetime.now(ZoneInfo(settings.app_timezone))
    calendar = current.isocalendar()
    learning_cycle = f"{calendar.year}-week-{calendar.week:02d}"
    return ":".join(
        (
            settings.institution_id,
            str(session.user_id),
            str(session.course_id),
            learning_cycle,
        )
    )


def _plain_text(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(value or ""))).strip()


async def _load_lms_agent_context(
    session: SessionContext,
    settings: Settings,
    db: Session | None = None,
) -> dict[str, Any]:
    """Load only LMS data authorized by the server-side PaceWise session."""
    client = LMSClient(settings)
    projections = {
        item.course_id: item
        for item in (
            db.query(LmsCourseContextProjection)
            .filter(
                LmsCourseContextProjection.institution_id == settings.institution_id,
                LmsCourseContextProjection.course_id.in_(session.course_ids),
            )
            .all()
            if db
            else []
        )
    }
    freshness_cutoff = datetime.now(UTC) - timedelta(
        seconds=max(60, settings.lms_sync_interval_seconds * 3)
    )
    projection_ready = len(projections) == len(session.course_ids) and all(
        (
            item.updated_at.replace(tzinfo=UTC)
            if item.updated_at.tzinfo is None
            else item.updated_at.astimezone(UTC)
        )
        >= freshness_cutoff
        for item in projections.values()
    )
    if projection_ready:
        allowed_courses = [json.loads(projections[course_id].course_json) for course_id in session.course_ids]
    else:
        courses = await client.service_get(
            "/api/pacewise/v1/courses",
            {"user_id": session.user_id},
        )
        allowed_courses = [item for item in courses if int(item["id"]) in session.course_ids]
    course = next((item for item in allowed_courses if int(item["id"]) == session.course_id), None)
    if not course:
        raise HTTPException(status_code=403, detail="LMS enrollment no longer grants this course")

    normalized_assignments = []
    active_modules: list[dict[str, Any]] = []
    planner_items: list[dict[str, Any]] = []
    if session.role == "student":
        try:
            planner_items = await client.service_get(
                f"/api/pacewise/v1/users/{session.user_id}/planner"
            )
        except Exception as exc:
            # Course projections remain useful when the user-specific planner
            # endpoint is temporarily unavailable. Do not fail the whole chat.
            logger.warning(
                "lms_planner_unavailable user_id=%s error=%s",
                session.user_id,
                type(exc).__name__,
            )
    planner_by_assignment = {
        (int(item.get("course_id") or 0), int(item.get("assignment_id") or 0)): item
        for item in planner_items
        if item.get("assignment_id") is not None
    }
    for enrolled_course in allowed_courses:
        course_id = int(enrolled_course["id"])
        projection = projections.get(course_id) if projection_ready else None
        if projection:
            assignments = json.loads(projection.assignments_json or "[]")
            modules = json.loads(projection.modules_json or "[]")
            submissions = []
        else:
            scoped_params = {"user_id": session.user_id} if session.role == "student" else None
            assignments, submissions, modules = await gather(
                client.service_get(
                    f"/api/pacewise/v1/courses/{course_id}/assignments",
                    scoped_params,
                ),
                client.service_get(
                    f"/api/pacewise/v1/courses/{course_id}/submissions",
                    scoped_params,
                ),
                client.service_get(
                    f"/api/pacewise/v1/courses/{course_id}/modules",
                    scoped_params,
                ),
            )
            if db:
                context_id = f"{settings.institution_id}:{course_id}"
                cached = db.get(LmsCourseContextProjection, context_id) or LmsCourseContextProjection(
                    id=context_id,
                    institution_id=settings.institution_id,
                    course_id=course_id,
                )
                cached.course_json = json.dumps(enrolled_course, ensure_ascii=False)
                cached.assignments_json = json.dumps(assignments, ensure_ascii=False)
                cached.modules_json = json.dumps(modules, ensure_ascii=False)
                db.add(cached)
        if course_id == session.course_id:
            active_modules = modules
        submissions_by_assignment = {int(item["assignment_id"]): item for item in submissions}
        for item in assignments:
            points = float(item.get("points_possible") or 5)
            planner_item = planner_by_assignment.get((course_id, int(item["id"])), {})
            normalized_assignments.append(
                {
                    "id": f"{course_id}:{item['id']}",
                    "lms_assignment_id": str(item["id"]),
                    "course_id": str(course_id),
                    "course_code": str(enrolled_course.get("code") or course_id),
                    "title": item["title"],
                    "description": _plain_text(item.get("description")),
                    "deadline": planner_item.get("due_at") or item.get("due_at"),
                    "unlock_at": item.get("unlock_at"),
                    "lock_at": item.get("lock_at"),
                    "override_target": item.get("override_target"),
                    "estimated_hours": round(max(0.5, min(4.0, points * 0.2)), 2),
                    "points_possible": points,
                    "assignment_group": item.get("assignment_group"),
                    "grading_type": item.get("grading_type"),
                    "peer_reviews": bool(item.get("peer_reviews")),
                    "rubric": item.get("rubric"),
                    "submission": submissions_by_assignment.get(int(item["id"]))
                    or (
                        {
                            "assignment_id": item["id"],
                            "workflow_state": "submitted"
                            if planner_item.get("completed")
                            else "unsubmitted",
                        }
                        if (course_id, int(item["id"])) in planner_by_assignment
                        else None
                    ),
                }
            )

    if db and not projection_ready:
        db.commit()

    course_code = str(course.get("code") or session.course_id)
    return {
        "institution_id": settings.institution_id,
        "student_id": str(session.user_id) if session.role == "student" else "",
        "course_id": str(session.course_id),
        "course_code": course_code,
        "role": session.role,
        "assignments": normalized_assignments,
        "modules": active_modules,
        "planner_items": planner_items,
        # The request path performs retrieval only. Raw LMS content is ingested
        # asynchronously by the dedicated worker and never embedded here.
        "learning_resources": [],
    }


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    session: SessionContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> ChatResponse:
    """Run one agent turn with authenticated user, role, course and LMS context."""
    scoped_session = session
    requested_course_id = payload.context.get("do_course_id")
    do_block_id = str(payload.context.get("do_block_id") or "").strip()
    if requested_course_id is not None and do_block_id and payload.workflow in {"do", "qa"}:
        try:
            course_id = int(requested_course_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Invalid course_id") from exc
        if course_id not in session.course_ids:
            raise HTTPException(status_code=403, detail="Course is outside the authenticated LMS enrollment")
        scoped_session = replace(session, course_id=course_id)

    lms_context = await _load_lms_agent_context(scoped_session, settings, db)
    safe_context = {key: value for key, value in payload.context.items() if key in _CLIENT_CONTEXT_FIELDS}
    assessment_id = str(safe_context.pop("assessment_id", "")).strip() or None
    trusted_assessment: dict[str, Any] = {}
    if payload.workflow == "understanding":
        if not assessment_id:
            raise HTTPException(status_code=422, detail="assessment_id is required for understanding checks")
        trusted_assessment = await load_approved_assessment(
            db,
            scoped_session,
            settings,
            assessment_id,
        )
    learner_memory = load_learner_memory(db, scoped_session, settings)
    thread_id = _learning_thread_id(scoped_session, settings)
    config = {"configurable": {"thread_id": thread_id}}
    try:
        active_agent = getattr(request.app.state, "agent", agent)
        result = await active_agent.ainvoke(
            {
                **safe_context,
                **lms_context,
                **({"approved_rubric": trusted_assessment["approved_rubric"]} if trusted_assessment else {}),
                "learner_profile": learner_memory["profile"],
                "mastery_profile": learner_memory["mastery"],
                "misconceptions": learner_memory["misconceptions"],
                "query": payload.message,
                "request": {
                    "channel": "pacewise_web",
                    "workflow_hint": payload.workflow,
                    **(
                        {
                            "assessment_id": assessment_id,
                            "question": trusted_assessment["question"],
                            "question_type": trusted_assessment["question_type"],
                            "correct_answer": trusted_assessment["correct_answer"],
                            "topic": trusted_assessment["topic"],
                        }
                        if trusted_assessment
                        else {}
                    ),
                },
            },
            config=config,
        )
        if trusted_assessment and isinstance(result.get("assessment_result"), dict):
            result["assessment_result"]["rubric_version"] = trusted_assessment["rubric_version"]
            result["assessment_result"]["assessment_id"] = assessment_id
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Agent request failed") from exc

    security_flags = result.get("security_flags") or {}
    security_action = str(security_flags.get("action") or "")
    result_workflow = str(result.get("workflow") or payload.workflow or "qa")
    source_refs = (result.get("source_refs") or []) if result_workflow in {"qa", "do"} else []
    if security_action == "guided_help":
        mode = "integrity"
    elif source_refs:
        mode = "grounded"
    elif result_workflow == "qa":
        mode = "abstained"
    else:
        mode = result.get("workflow", payload.workflow)

    output = dict(result.get("output") or {})
    plan_input = safe_context.get("plan_input")
    if payload.workflow == "plan" and isinstance(plan_input, dict):
        draft = build_plan_draft(
            plan_input,
            lms_context["assignments"],
            proposed_milestones=result.get("proposed_milestones") or [],
            timezone_name=settings.app_timezone,
        )
        milestone_validation = output.get("plan_validation")
        if milestone_validation:
            output["milestone_validation"] = milestone_validation
        shortfalls = draft["feasibility"]["shortfalls"]
        output["plan_validation"] = {
            "valid": draft["feasibility"]["feasible"],
            "errors": [
                {
                    "code": "DEADLINE_CAPACITY_SHORTFALL",
                    "task_id": item["taskId"],
                    "missing_minutes": item["missingMin"],
                }
                for item in shortfalls
            ],
        }
        output["plan_draft"] = draft

    review_case_id = persist_agent_outcome(db, scoped_session, settings, result, assessment_id)

    safe_response, output_policy = enforce_output_policy(
        str(result.get("response") or ""),
        input_decision=security_flags,
    )
    output["safety"] = {
        "input": security_flags,
        "output": output_policy,
    }

    return ChatResponse(
        response=safe_response,
        workflow=result_workflow,
        mode=mode,
        status=result.get("status", "completed"),
        pending_action=result.get("pending_action"),
        output=output or None,
        proposed_milestones=(result.get("proposed_milestones") or [])
        if result_workflow == "plan"
        else [],
        recovery_options=(result.get("recovery_options") or [])
        if result_workflow == "recover"
        else [],
        reflection_draft=result.get("reflection_draft") if result_workflow == "reflect" else None,
        assessment_result=result.get("assessment_result")
        if result_workflow == "understanding"
        else None,
        review_case_id=review_case_id,
        progress_metrics=result.get("progress_metrics") or {},
        risk_signals=(result.get("risk_signals") or [])
        if result_workflow == "tracking"
        else [],
        source_refs=source_refs,
    )


@router.get("/status")
async def agent_status() -> dict:
    return {"status": "ready", "agent": "PaceWise LangGraph Agent v1.0"}
