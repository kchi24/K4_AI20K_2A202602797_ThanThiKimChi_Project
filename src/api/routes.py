import asyncio
import logging
import re
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from src.agents.graph import agent
from src.agents.tools.qdrant_retriever import ingest_course_resources
from src.config import Settings, get_settings
from src.models.schemas import ChatRequest, ChatResponse
from src.observability import observe_rag
from src.security import SessionContext, require_csrf
from src.services.lms_client import LMSClient

router = APIRouter()
logger = logging.getLogger("pacewise.rag")

_CLIENT_CONTEXT_FIELDS = {
    "availability",
    "unavailable_slots",
    "current_plan",
    "progress_metrics",
    "proposed_milestones",
    "goals",
    "approved_rubric",
}


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
    course = next((item for item in courses if int(item["id"]) == session.course_id), None)
    if not course:
        raise HTTPException(status_code=403, detail="LMS enrollment no longer grants this course")

    assignments = await client.service_get(
        f"/api/pacewise/v1/courses/{session.course_id}/assignments"
    )
    content = await client.service_get(f"/api/pacewise/v1/courses/{session.course_id}/content")
    submissions = []
    if session.role == "student":
        submissions = await client.service_get(
            f"/api/pacewise/v1/courses/{session.course_id}/submissions",
            {"user_id": session.user_id},
        )
    submissions_by_assignment = {int(item["assignment_id"]): item for item in submissions}

    normalized_assignments = []
    for item in assignments:
        points = float(item.get("points_possible") or 5)
        normalized_assignments.append(
            {
                "id": str(item["id"]),
                "title": item["title"],
                "description": _plain_text(item.get("description")),
                "deadline": item.get("due_at"),
                "estimated_hours": round(max(0.5, min(4.0, points * 0.2)), 2),
                "submission": submissions_by_assignment.get(int(item["id"])),
            }
        )

    course_code = str(course.get("code") or session.course_id)
    resources = []
    for index, item in enumerate(content, start=1):
        body = _plain_text(item.get("body"))
        if not body:
            continue
        title = str(item.get("title") or f"Học liệu {index}")
        resources.append(
            {
                "document_title": title,
                "course_code": course_code,
                "page": 1,
                "paragraph": index,
                "citation": f"[{title}, Trang 1, Đoạn {index}]",
                "content": body,
            }
        )

    return {
        "student_id": str(session.user_id) if session.role == "student" else "",
        "course_id": str(session.course_id),
        "course_code": course_code,
        "role": session.role,
        "assignments": normalized_assignments,
        "learning_resources": resources,
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
    if payload.workflow == "qa" and lms_context["learning_resources"]:
        started = time.perf_counter()
        outcome = "ok"
        try:
            await asyncio.to_thread(ingest_course_resources, lms_context["learning_resources"])
        except Exception:
            outcome = "fallback"
            logger.exception("rag_ingestion_failed course_id=%s", session.course_id)
        finally:
            observe_rag("ingest", outcome, time.perf_counter() - started)
    safe_context = {
        key: value
        for key, value in payload.context.items()
        if key in _CLIENT_CONTEXT_FIELDS
    }
    config = {"configurable": {"thread_id": f"pacewise:{session.sid}"}}
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

    security_action = str((result.get("security_flags") or {}).get("action") or "")
    source_refs = result.get("source_refs") or []
    if security_action == "guided_help":
        mode = "integrity"
    elif source_refs:
        mode = "grounded"
    elif result.get("workflow", payload.workflow) == "qa":
        mode = "abstained"
    else:
        mode = result.get("workflow", payload.workflow)

    return ChatResponse(
        response=result.get("response", ""),
        workflow=result.get("workflow", payload.workflow or "qa"),
        mode=mode,
        status=result.get("status", "completed"),
        pending_action=result.get("pending_action"),
        output=result.get("output"),
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
