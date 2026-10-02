import json
from asyncio import gather
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.api.workspace import check_login_rate_limit, record_failed_login, revoke_session
from src.config import Settings, get_settings
from src.db import get_db
from src.persistence_models import AgentReviewCase, InstructorAction, PaceWiseSession
from src.security import (
    SessionContext,
    get_current_session,
    issue_session,
    require_course,
    require_csrf,
    require_instructor,
)
from src.services.lms_client import LMSClient

router = APIRouter()


class LaunchRequest(BaseModel):
    token: str = Field(min_length=20, max_length=4096)


class LMSLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)
    course_id: int | None = Field(default=None, ge=1)


class CourseSwitchRequest(BaseModel):
    course_id: int = Field(alias="courseId", ge=1)


def _client(settings: Settings) -> LMSClient:
    return LMSClient(settings)


def _parse_lms_datetime(value: object) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _weekly_completion(
    assignments: list[dict],
    submissions: list[dict],
    student_ids: set[int],
    *,
    limit: int = 8,
) -> list[dict]:
    """Aggregate on-time completion by assignment due week without identifiers."""
    assignments_by_week: dict[tuple[int, int], list[int]] = defaultdict(list)
    for assignment in assignments:
        due_at = _parse_lms_datetime(assignment.get("due_at"))
        if due_at is None:
            continue
        calendar = due_at.isocalendar()
        assignments_by_week[(calendar.year, calendar.week)].append(int(assignment["id"]))

    submissions_by_key = {
        (int(item["assignment_id"]), int(item["user_id"])): item
        for item in submissions
        if int(item.get("user_id") or 0) in student_ids
    }
    rows = []
    for year_week, assignment_ids in sorted(assignments_by_week.items())[-limit:]:
        total = len(assignment_ids) * len(student_ids)
        completed = sum(
            1
            for assignment_id in assignment_ids
            for student_id in student_ids
            if (
                (submission := submissions_by_key.get((assignment_id, student_id)))
                and not bool(submission.get("late"))
                and str(submission.get("workflow_state") or "submitted")
                in {"submitted", "graded", "pending_review"}
            )
        )
        year, week = year_week
        week_start = datetime.fromisocalendar(year, week, 1)
        rows.append(
            {
                "week": f"{week_start:%d/%m}",
                "rate": completed / total if total else 0,
                "count": completed,
                "total": total,
            }
        )
    return rows


def _validate_claims(claims: dict) -> None:
    if claims.get("iss") != "canvas-lms-simulator" or claims.get("aud") != "pacewise":
        raise HTTPException(status_code=401, detail="Invalid LMS launch issuer or audience")
    try:
        int(claims["sub"])
        int(claims["course_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Incomplete LMS launch claims") from exc
    if claims.get("role") not in {"student", "instructor"}:
        raise HTTPException(status_code=403, detail="Unsupported LMS role")


def _set_session_cookies(
    response: Response,
    claims: dict,
    settings: Settings,
    db: Session,
    course_ids: list[int],
) -> dict:
    course_ids = sorted(set(course_ids + [int(claims["course_id"])]))
    token, csrf = issue_session(db, claims, settings, course_ids)
    max_age = settings.pacewise_session_minutes * 60
    secure_cookie = settings.session_cookie_secure or settings.force_https or settings.app_env == "production"
    response.set_cookie(
        settings.pacewise_session_cookie,
        token,
        max_age=max_age,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        settings.pacewise_csrf_cookie,
        csrf,
        max_age=max_age,
        httponly=False,
        secure=secure_cookie,
        samesite="lax",
        path="/",
    )
    return {
        "user": {
            "id": str(claims["sub"]),
            "name": claims.get("name", ""),
            "email": claims.get("email", ""),
            "role": claims["role"],
            "courseId": str(claims["course_id"]),
            "courseIds": [str(value) for value in course_ids],
        },
        "course_id": str(claims["course_id"]),
    }


@router.post("/auth/lms-launch")
async def lms_launch(
    payload: LaunchRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    client = _client(settings)
    claims = await client.verify_launch(payload.token)
    _validate_claims(claims)
    courses = await client.service_get("/api/pacewise/v1/courses", {"user_id": int(claims["sub"])})
    return _set_session_cookies(response, claims, settings, db, [int(item["id"]) for item in courses])


@router.post("/auth/lms-login")
async def lms_login(
    payload: LMSLoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    """Development login through LMS. Production should enter via the one-time launch flow."""
    check_login_rate_limit(request, payload.email, db, settings)
    client = _client(settings)
    try:
        claims = await client.login_and_create_launch(
            payload.email.strip().lower(),
            payload.password,
            payload.course_id,
        )
    except HTTPException as exc:
        if exc.status_code in {401, 403}:
            record_failed_login(request, payload.email, db)
        raise
    _validate_claims(claims)
    courses = await client.service_get("/api/pacewise/v1/courses", {"user_id": int(claims["sub"])})
    return _set_session_cookies(response, claims, settings, db, [int(item["id"]) for item in courses])


@router.get("/auth/me")
async def auth_me(session: SessionContext = Depends(get_current_session)) -> dict:
    return {
        "user": session.public_user()
        | {"courseId": str(session.course_id), "courseIds": [str(value) for value in session.course_ids]}
    }


@router.post("/auth/course")
async def switch_course(
    payload: CourseSwitchRequest,
    session: SessionContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    require_course(payload.course_id, session)
    row = db.get(PaceWiseSession, session.sid)
    row.active_course_id = payload.course_id
    db.commit()
    return {"courseId": str(payload.course_id)}


@router.post("/auth/logout")
async def auth_logout(
    response: Response,
    session: SessionContext = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    revoke_session(session, db)
    response.delete_cookie(settings.pacewise_session_cookie, path="/")
    response.delete_cookie(settings.pacewise_csrf_cookie, path="/")
    return {"ok": True}


def _tone(course_id: int) -> str:
    return ("primary", "success", "accent", "warning")[course_id % 4]


def _task_status(submission: dict | None) -> str:
    return "done" if submission and submission.get("workflow_state") == "submitted" else "todo"


def _task_priority(due_at: str | None) -> str:
    if not due_at:
        return "low"
    try:
        due = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
        if due.tzinfo is None:
            due = due.replace(tzinfo=UTC)
        days = (due - datetime.now(UTC)).total_seconds() / 86400
        return "high" if days <= 2 else "medium" if days <= 7 else "low"
    except ValueError:
        return "medium"


def _submission_status(submission: dict | None) -> dict:
    if not submission:
        return {
            "state": "unsubmitted",
            "attempts": 0,
            "late": False,
            "score": None,
            "feedback": "",
            "rubricAssessment": {},
        }
    return {
        "state": submission.get("workflow_state") or "unsubmitted",
        "attempts": len(submission.get("history") or []),
        "late": bool(submission.get("late")),
        "score": submission.get("score"),
        "feedback": submission.get("feedback") or "",
        "rubricAssessment": submission.get("rubric") or {},
    }


def _task_payload(course_id: int, assignment: dict, submission: dict | None) -> dict:
    due_at = assignment.get("due_at")
    points = float(assignment.get("points_possible") or 5)
    group = assignment.get("assignment_group") or {}
    return {
        "id": f"{course_id}:{assignment['id']}",
        "lmsAssignmentId": str(assignment["id"]),
        "title": assignment["title"],
        "courseId": str(course_id),
        "deadline": due_at[:10] if due_at else datetime.now(UTC).date().isoformat(),
        "dueAt": due_at,
        "unlockAt": assignment.get("unlock_at"),
        "lockAt": assignment.get("lock_at"),
        "overrideTarget": assignment.get("override_target"),
        "estimateMin": max(30, min(240, int(points * 12))),
        "loggedMin": 0,
        "status": _task_status(submission),
        "priority": _task_priority(due_at),
        "objective": assignment.get("description") or "Hoàn thành yêu cầu của bài tập trên Canvas.",
        "estimateIsAssumption": True,
        "pointsPossible": points,
        "assignmentGroup": {
            "id": str(group.get("id")),
            "name": group.get("name") or "",
            "weight": float(group.get("weight") or 0),
        }
        if group
        else None,
        "gradingType": assignment.get("grading_type") or "points",
        "peerReviews": bool(assignment.get("peer_reviews")),
        "groupCategoryId": str(assignment["group_category_id"])
        if assignment.get("group_category_id")
        else None,
        "rubric": assignment.get("rubric"),
        "submission": _submission_status(submission),
    }


async def _course_snapshot(
    client: LMSClient,
    course: dict,
    session: SessionContext,
    planner_items: list[dict],
) -> tuple[list[dict], dict]:
    course_id = int(course["id"])
    user_params = {"user_id": session.user_id}
    scoped_params = user_params if session.role == "student" else None
    assignments, submissions, modules, files, appointments = await gather(
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/assignments", scoped_params),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/submissions", scoped_params),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/modules", scoped_params),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/files", user_params),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/appointment-groups"),
    )
    submissions_by_assignment = {int(item["assignment_id"]): item for item in submissions}
    tasks = [
        _task_payload(course_id, item, submissions_by_assignment.get(int(item["id"])))
        for item in assignments
    ]
    snapshot = {
        "courseId": str(course_id),
        "modules": modules,
        "resources": files,
        "plannerItems": [
            item for item in planner_items if int(item.get("course_id") or 0) == course_id
        ],
        "appointmentGroups": appointments,
    }
    if session.role == "instructor":
        sections, groups, analytics = await gather(
            client.service_get(f"/api/pacewise/v1/courses/{course_id}/sections"),
            client.service_get(f"/api/pacewise/v1/courses/{course_id}/groups"),
            client.service_get(f"/api/pacewise/v1/courses/{course_id}/analytics"),
        )
        snapshot.update({"sections": sections, "groups": groups, "analytics": analytics})
    return tasks, snapshot


def _guidance_payload(actions: list[InstructorAction]) -> list[dict]:
    result = []
    for item in reversed(actions):
        payload = json.loads(item.payload_json or "{}")
        if payload.get("message"):
            result.append(
                {
                    "id": item.id,
                    "topic": item.entity_id,
                    "message": payload["message"],
                    "at": item.created_at.isoformat(),
                    "instructorName": "Giảng viên",
                }
            )
    return result


async def _sync_payload(session: SessionContext, settings: Settings, db: Session) -> dict:
    client = _client(settings)
    courses = await client.service_get("/api/pacewise/v1/courses", {"user_id": session.user_id})
    allowed_courses = [item for item in courses if int(item["id"]) in session.course_ids]
    if not any(int(item["id"]) == session.course_id for item in allowed_courses):
        raise HTTPException(status_code=403, detail="LMS enrollment no longer grants this course")
    ui_courses = [
        {
            "id": str(course["id"]),
            "code": course["code"],
            "name": course["name"],
            "tone": _tone(int(course["id"])),
        }
        for course in allowed_courses
    ]
    planner_items = (
        await client.service_get(f"/api/pacewise/v1/users/{session.user_id}/planner")
        if session.role == "student"
        else []
    )
    synchronized = await gather(
        *[_course_snapshot(client, course, session, planner_items) for course in allowed_courses]
    )
    tasks = [task for course_tasks, _snapshot in synchronized for task in course_tasks]
    course_data = {snapshot["courseId"]: snapshot for _tasks, snapshot in synchronized}
    guidance_actions = db.scalars(
        select(InstructorAction)
        .where(
            InstructorAction.course_id == session.course_id,
            InstructorAction.action_type == "guidance",
        )
        .order_by(InstructorAction.created_at)
    ).all()
    assessments = []
    quizzes = await client.service_get(
        f"/api/pacewise/v1/courses/{session.course_id}/quizzes"
    )
    assessment_actions = db.scalars(
        select(InstructorAction)
        .where(
            InstructorAction.course_id == session.course_id,
            InstructorAction.action_type == "assessment",
        )
        .order_by(InstructorAction.created_at)
    ).all()
    latest_assessment_actions = {item.entity_id: item for item in assessment_actions}
    for quiz in quizzes:
        for question in quiz.get("questions", []):
            assessment_id = f"Q-{question['id']}"
            action = latest_assessment_actions.get(assessment_id)
            payload = json.loads(action.payload_json or "{}") if action else {}
            if payload.get("status") != "approved":
                continue
            assessments.append(
                {
                    "id": assessment_id,
                    "topic": quiz["title"],
                    "question": payload.get("question") or question["prompt"],
                    "rubric": payload.get("rubric")
                    or ["Đúng khái niệm", "Giải thích có lập luận", "Không sao chép đáp án"],
                    "status": "approved",
                    "version": max(1, int(payload.get("version") or 1)),
                    "source": payload.get("source") or "Canvas quiz",
                    "aiGenerated": False,
                }
            )
    review_resolutions = {}
    if session.role == "student":
        review_cases = db.scalars(
            select(AgentReviewCase).where(
                AgentReviewCase.institution_id == settings.institution_id,
                AgentReviewCase.student_user_id == session.user_id,
                AgentReviewCase.course_id.in_(session.course_ids),
            )
        ).all()
        for review_case in review_cases:
            case_payload = json.loads(review_case.payload_json or "{}")
            review_resolutions[review_case.id] = {
                "status": review_case.status,
                "note": case_payload.get("instructor_note"),
                "resolvedStatus": (
                    (case_payload.get("edited_result") or {}).get("status")
                    or (case_payload.get("assessment_result") or {}).get("status")
                ),
            }
    return {
        "courses": ui_courses,
        "tasks": tasks,
        "guidance": _guidance_payload(list(guidance_actions)),
        "assessments": assessments,
        "reviewResolutions": review_resolutions,
        "courseData": course_data,
        "syncedAt": datetime.now(UTC).isoformat(),
        "source": "canvas-lms-simulator",
        "activeCourseId": str(session.course_id),
    }


@router.get("/lms/sync")
async def sync_lms(
    session: SessionContext = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    return await _sync_payload(session, settings, db)


@router.get("/lms/courses/{course_id}/{resource}")
async def course_resource(
    course_id: int,
    resource: str,
    session: SessionContext = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
):
    require_course(course_id, session)
    allowed = {
        "assignments",
        "submissions",
        "modules",
        "content",
        "files",
        "grades",
        "quizzes",
        "outcomes",
        "sections",
        "groups",
        "analytics",
        "resource-folders",
        "appointment-groups",
    }
    if resource not in allowed:
        raise HTTPException(status_code=404, detail="Unsupported LMS resource")
    params = None
    if resource in {"sections", "groups", "analytics"} and session.role != "instructor":
        raise HTTPException(status_code=403, detail="Instructor role required")
    if resource in {
        "assignments",
        "submissions",
        "modules",
        "files",
        "grades",
        "quizzes",
        "outcomes",
    } and session.role == "student":
        params = {"user_id": session.user_id}
    return await _client(settings).service_get(f"/api/pacewise/v1/courses/{course_id}/{resource}", params)


@router.get("/lms/learning-evidence")
async def learning_evidence(
    session: SessionContext = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
):
    params = {"course_id": session.course_id}
    if session.role == "student":
        params["user_id"] = session.user_id
    return await _client(settings).service_get("/api/pacewise/v1/learning-evidence", params)


@router.get("/instructor/overview")
async def instructor_overview(
    session: SessionContext = Depends(require_instructor),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> dict:
    client = _client(settings)
    course_id = session.course_id
    (
        enrollments,
        assignments,
        submissions,
        evidence,
        quizzes,
        audits,
        analytics,
        sections,
        groups,
        modules,
    ) = await gather(
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/enrollments"),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/assignments"),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/submissions"),
        client.service_get("/api/pacewise/v1/learning-evidence", {"course_id": course_id, "limit": 500}),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/quizzes"),
        client.service_get("/api/pacewise/v1/audit-logs", {"course_id": course_id, "limit": 100}),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/analytics"),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/sections"),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/groups"),
        client.service_get(f"/api/pacewise/v1/courses/{course_id}/modules"),
    )
    students = [item for item in enrollments if item.get("role") == "student"]
    student_ids = {int(item["user_id"]) for item in students}
    saved_actions = db.scalars(
        select(InstructorAction)
        .where(InstructorAction.course_id == course_id)
        .order_by(InstructorAction.created_at)
    ).all()
    agent_review_cases = db.scalars(
        select(AgentReviewCase)
        .where(AgentReviewCase.course_id == course_id)
        .order_by(AgentReviewCase.created_at.desc())
    ).all()
    guidance = _guidance_payload(list(saved_actions))

    submitted_by_student: dict[int, list[dict]] = defaultdict(list)
    for item in submissions:
        if int(item["user_id"]) in student_ids:
            submitted_by_student[int(item["user_id"])].append(item)
    on_time_ids = {
        student_id
        for student_id, rows in submitted_by_student.items()
        if rows and any(not bool(row.get("late")) for row in rows)
    }
    total_students = len(students)
    required = max(1, len(assignments))
    at_risk = sum(
        1
        for student_id in student_ids
        if any(row.get("late") for row in submitted_by_student.get(student_id, []))
        or len(submitted_by_student.get(student_id, [])) < required
    )
    topic_users: dict[str, set[int]] = defaultdict(set)
    low_evidence = []
    for item in evidence:
        max_score = float(item.get("max_score") or 0)
        ratio = float(item.get("score") or 0) / max_score if max_score else 0
        if ratio < 0.7:
            topic = str(item.get("competency_key") or "Chưa phân loại")
            topic_users[topic].add(int(item["user_id"]))
            low_evidence.append(item)

    group = {"id": "all", "name": "Cả lớp", "n": total_students}
    if total_students < 5:
        return {
            "classGroups": [group],
            "groupStats": {},
            "reviewQueue": [],
            "assessments": [],
            "audit": [],
            "guidance": guidance,
            "privacy": {
                "minimumGroupSize": 5,
                "containsDirectIdentifiers": False,
                "suppressed": True,
            },
            "lmsSummary": None,
        }
    rate = len(on_time_ids) / total_students if total_students else 0
    weekly_completion = _weekly_completion(assignments, submissions, student_ids)
    stats = {
        "groupId": "all",
        "onTimeRate": rate,
        "onTimeCount": len(on_time_ids),
        "weeklyCompletion": weekly_completion or [
            {"week": "Hiện tại", "rate": rate, "count": len(on_time_ids), "total": total_students}
        ],
        "topics": [
            {"topic": key, "needsSupport": len(value), "n": total_students}
            for key, value in sorted(topic_users.items(), key=lambda row: len(row[1]), reverse=True)[:5]
        ],
        "atRisk": at_risk,
    }
    review_queue = [
        {
            "id": f"EV-{item['id']}",
            "topic": item.get("competency_key", "Chưa phân loại"),
            "question": f"Xem lại bằng chứng {item.get('evidence_type', 'learning evidence')}",
            "responseExcerpt": "Dữ liệu cá nhân được ẩn trong màn hình tổng hợp.",
            "confidence": "low",
            "reason": "Điểm bằng chứng dưới ngưỡng 70%.",
            "status": "pending",
            "submittedAt": item.get("observed_at", ""),
        }
        for item in low_evidence[:20]
    ]
    review_queue.extend(
        {
            "id": item.id,
            "topic": "Đánh giá hiểu bài"
            if item.case_type == "understanding_review"
            else "Khiếu nại trích dẫn",
            "question": item.entity_id,
            "responseExcerpt": "Nội dung cá nhân chỉ hiển thị cho giảng viên được phân quyền.",
            "confidence": "low",
            "reason": item.case_type,
            "status": item.status,
            "submittedAt": item.created_at.isoformat(),
            "suggestedStatus": (json.loads(item.payload_json or "{}").get("assessment_result") or {}).get("status"),
            "rubricVersion": json.loads(item.payload_json or "{}").get("rubric_version"),
        }
        for item in agent_review_cases
    )
    assessments = []
    for quiz in quizzes:
        for question in quiz.get("questions", []):
            assessments.append(
                {
                    "id": f"Q-{question['id']}",
                    "topic": quiz["title"],
                    "question": question["prompt"],
                    "rubric": ["Đúng khái niệm", "Giải thích có lập luận", "Không sao chép đáp án"],
                    "status": "review",
                    "version": 0,
                    "source": "Canvas quiz",
                    "aiGenerated": False,
                }
            )
    review_by_id = {item["id"]: item for item in review_queue}
    assessment_by_id = {item["id"]: item for item in assessments}
    for action in saved_actions:
        payload = json.loads(action.payload_json or "{}")
        if action.action_type == "review" and action.entity_id in review_by_id:
            review_by_id[action.entity_id].update(
                {key: payload[key] for key in ("status", "note") if key in payload}
            )
        if action.action_type == "assessment" and action.entity_id in assessment_by_id:
            assessment_by_id[action.entity_id].update(
                {key: payload[key] for key in ("status", "note", "question", "rubric", "level", "source", "version") if key in payload}
            )
    audit = [
        {
            "id": str(item["id"]),
            "at": item.get("created_at", ""),
            "actor": "LMS user" if item.get("actor_user_id") else "Hệ thống",
            "action": item.get("action", "LMS event"),
        }
        for item in audits[-50:]
    ]
    audit.extend(
        {
            "id": item.id,
            "at": item.created_at.isoformat(),
            "actor": session.name,
            "action": f"{item.action_type}: {item.entity_id}",
        }
        for item in saved_actions[-50:]
    )
    return {
        "classGroups": [group],
        "groupStats": {"all": stats},
        "reviewQueue": review_queue,
        "assessments": assessments,
        "audit": audit,
        "guidance": guidance,
        "lmsSummary": {
            "analytics": analytics,
            "sections": [
                {"id": str(item["id"]), "name": item["name"], "memberCount": len(item.get("member_ids") or [])}
                for item in sections
            ],
            "groups": [
                {
                    "id": str(category["id"]),
                    "name": category["name"],
                    "teamCount": len(category.get("groups") or []),
                }
                for category in groups
            ],
            "modules": [
                {
                    "id": str(item["id"]),
                    "name": item["name"],
                    "requirementCount": len(item.get("requirements") or []),
                }
                for item in modules
            ],
            "weightedAssignments": sum(1 for item in assignments if item.get("assignment_group")),
            "rubricAssignments": sum(1 for item in assignments if item.get("rubric")),
        },
        "privacy": {"minimumGroupSize": 5, "containsDirectIdentifiers": False},
    }
