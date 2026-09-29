import re
from asyncio import gather
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request

from src.agents.graph import agent
from src.agents.safety import enforce_output_policy
from src.config import Settings, get_settings
from src.models.schemas import ChatRequest, ChatResponse
from src.security import SessionContext, require_csrf
from src.services.lms_client import LMSClient
from src.services.planning import build_plan_draft

router = APIRouter()
_CLIENT_CONTEXT_FIELDS = {
    "availability",
    "unavailable_slots",
    "current_plan",
    "progress_metrics",
    "proposed_milestones",
    "goals",
    "approved_rubric",
    "plan_input",
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
) -> dict[str, Any]:
    """Load only LMS data authorized by the server-side PaceWise session."""
    client = LMSClient(settings)
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
        planner_items = await client.service_get(
            f"/api/pacewise/v1/users/{session.user_id}/planner"
        )
    for enrolled_course in allowed_courses:
        course_id = int(enrolled_course["id"])
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
        if course_id == session.course_id:
            active_modules = modules
        submissions_by_assignment = {int(item["assignment_id"]): item for item in submissions}
        for item in assignments:
            points = float(item.get("points_possible") or 5)
            normalized_assignments.append(
                {
                    "id": f"{course_id}:{item['id']}",
                    "lms_assignment_id": str(item["id"]),
                    "course_id": str(course_id),
                    "course_code": str(enrolled_course.get("code") or course_id),
                    "title": item["title"],
                    "description": _plain_text(item.get("description")),
                    "deadline": item.get("due_at"),
                    "unlock_at": item.get("unlock_at"),
                    "lock_at": item.get("lock_at"),
                    "override_target": item.get("override_target"),
                    "estimated_hours": round(max(0.5, min(4.0, points * 0.2)), 2),
                    "points_possible": points,
                    "assignment_group": item.get("assignment_group"),
                    "grading_type": item.get("grading_type"),
                    "peer_reviews": bool(item.get("peer_reviews")),
                    "rubric": item.get("rubric"),
                    "submission": submissions_by_assignment.get(int(item["id"])),
                }
            )

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
) -> ChatResponse:
    """Run one agent turn with authenticated user, role, course and LMS context."""
    lms_context = await _load_lms_agent_context(session, settings)
    safe_context = {key: value for key, value in payload.context.items() if key in _CLIENT_CONTEXT_FIELDS}
    thread_id = _learning_thread_id(session, settings)
    config = {"configurable": {"thread_id": thread_id}}
    try:
        active_agent = getattr(request.app.state, "agent", agent)
        result = await active_agent.ainvoke(
            {
                **safe_context,
                **lms_context,
                "query": payload.message,
                "request": {
                    "channel": "pacewise_web",
                    "workflow_hint": payload.workflow,
                },
            },
            config=config,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Agent request failed") from exc

    security_flags = result.get("security_flags") or {}
    security_action = str(security_flags.get("action") or "")
    source_refs = result.get("source_refs") or []
    if security_action == "guided_help":
        mode = "integrity"
    elif source_refs:
        mode = "grounded"
    elif result.get("workflow", payload.workflow) == "qa":
        mode = "abstained"
    else:
        mode = result.get("workflow", payload.workflow)

    output = dict(result.get("output") or {})
    plan_input = safe_context.get("plan_input")
    if payload.workflow == "plan" and isinstance(plan_input, dict):
        draft = build_plan_draft(
            plan_input,
            lms_context["assignments"],
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
        workflow=result.get("workflow", payload.workflow or "qa"),
        mode=mode,
        status=result.get("status", "completed"),
        pending_action=result.get("pending_action"),
        output=output or None,
        proposed_milestones=result.get("proposed_milestones") or [],
        recovery_options=result.get("recovery_options") or [],
        reflection_draft=result.get("reflection_draft"),
        assessment_result=result.get("assessment_result"),
        progress_metrics=result.get("progress_metrics") or {},
        risk_signals=result.get("risk_signals") or [],
        source_refs=source_refs,
    )


@router.get("/status")
async def agent_status() -> dict:
    return {"status": "ready", "agent": "PaceWise LangGraph Agent v1.0"}
