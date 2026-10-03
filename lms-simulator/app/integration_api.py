import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.learning_api import (
    assignment_extension_payload,
    can_access_resource,
    module_extension_payload,
    resource_extension_payload,
    submission_history_payload,
)
from app.models import (
    AppointmentGroup,
    AppointmentReservation,
    Assignment,
    AuditLog,
    CalendarEvent,
    Course,
    CourseContent,
    CourseGroup,
    CourseModule,
    CourseSection,
    Enrollment,
    GradeHistory,
    GroupCategory,
    GroupMembership,
    IntegrationEvent,
    LaunchNonce,
    LearningActivity,
    LearningEvidence,
    ModuleItem,
    OutcomeAlignment,
    PlannerItem,
    QuizAttempt,
    QuizQuestion,
    Resource,
    ResourceFolder,
    SectionMembership,
    Submission,
    SubmissionDetail,
    User,
)
from app.telemetry import record_change

router = APIRouter()
service_router = APIRouter(prefix="/api/pacewise/v1")


class LaunchVerifyRequest(BaseModel):
    token: str


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def require_service_key(x_pacewise_key: str = Header(default="")) -> None:
    configured = os.getenv("PACEWISE_API_KEY", "").strip()
    if not configured:
        raise HTTPException(status_code=503, detail="PACEWISE_API_KEY is not configured")
    if not x_pacewise_key or not hmac.compare_digest(x_pacewise_key, configured):
        raise HTTPException(status_code=401, detail="Invalid PaceWise API key")


def require_course(db: Session, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _launch_secret() -> bytes:
    secret = os.getenv("PACEWISE_LAUNCH_SECRET", "").strip()
    if len(secret) < 32:
        raise HTTPException(status_code=503, detail="PACEWISE_LAUNCH_SECRET must be at least 32 characters")
    return secret.encode()


def _sign_launch(payload: dict) -> str:
    encoded = _b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
    signature = _b64encode(hmac.new(_launch_secret(), encoded.encode(), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def _decode_launch(token: str) -> dict:
    try:
        encoded, signature = token.split(".", 1)
        expected = _b64encode(hmac.new(_launch_secret(), encoded.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        payload = json.loads(_b64decode(encoded))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid launch token") from exc
    if int(payload.get("exp", 0)) < int(datetime.now(UTC).timestamp()):
        raise HTTPException(status_code=401, detail="Launch token expired")
    return payload


@router.post("/api/pacewise/launch/{course_id}")
def create_launch(course_id: int, request: Request, db: Session = Depends(get_db)) -> dict:
    actor_id = getattr(request.state, "current_user_id", None)
    enrollment = db.scalar(
        select(Enrollment).where(Enrollment.user_id == actor_id, Enrollment.course_id == course_id)
    )
    if not enrollment:
        raise HTTPException(status_code=403, detail="Course enrollment required")
    user = db.get(User, actor_id)
    course = require_course(db, course_id)
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=5)
    nonce = secrets.token_urlsafe(24)
    db.add(
        LaunchNonce(
            nonce=nonce,
            user_id=user.id,
            course_id=course.id,
            role=enrollment.role,
            expires_at=expires_at,
        )
    )
    payload = {
        "iss": "canvas-lms-simulator",
        "aud": "pacewise",
        "sub": str(user.id),
        "course_id": course.id,
        "role": enrollment.role,
        "name": user.full_name,
        "email": user.email,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "nonce": nonce,
    }
    token = _sign_launch(payload)
    launch_url = os.getenv("PACEWISE_URL", "http://localhost:5173").rstrip("/") + "/#/launch?" + urlencode(
        {"token": token}
    )
    record_change(
        db,
        actor_user_id=user.id,
        action="pacewise.launch.created",
        entity_type="course",
        entity_id=course.id,
        course_id=course.id,
        metadata={"role": enrollment.role, "expires_at": expires_at},
    )
    db.commit()
    return {"launch_url": launch_url, "expires_at": expires_at.isoformat()}


@service_router.post("/launch/verify", dependencies=[Depends(require_service_key)])
def verify_launch(payload: LaunchVerifyRequest, db: Session = Depends(get_db)) -> dict:
    claims = _decode_launch(payload.token)
    nonce = db.scalar(select(LaunchNonce).where(LaunchNonce.nonce == claims.get("nonce")))
    now = datetime.now(UTC)
    if not nonce or nonce.used_at or nonce.expires_at <= now:
        raise HTTPException(status_code=401, detail="Launch token already used or expired")
    if nonce.user_id != int(claims["sub"]) or nonce.course_id != int(claims["course_id"]):
        raise HTTPException(status_code=401, detail="Launch token claims do not match")
    nonce.used_at = now
    record_change(
        db,
        actor_user_id=nonce.user_id,
        action="pacewise.launch.consumed",
        entity_type="course",
        entity_id=nonce.course_id,
        course_id=nonce.course_id,
        metadata={"role": nonce.role},
        emit_event=False,
    )
    db.commit()
    return claims


@service_router.get("/courses", dependencies=[Depends(require_service_key)])
def courses(
    user_id: int | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(Course).order_by(Course.id).offset(offset).limit(limit)
    if user_id is not None:
        query = (
            select(Course)
            .join(Enrollment, Enrollment.course_id == Course.id)
            .where(Enrollment.user_id == user_id)
            .order_by(Course.id)
            .offset(offset)
            .limit(limit)
        )
    return [
        {
            "id": course.id,
            "code": course.code,
            "name": course.name,
            "term": course.term,
            "published": course.published,
        }
        for course in db.scalars(query).all()
    ]


@service_router.get("/courses/{course_id}/enrollments", dependencies=[Depends(require_service_key)])
def enrollments(course_id: int, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    rows = db.execute(
        select(Enrollment, User)
        .join(User, User.id == Enrollment.user_id)
        .where(Enrollment.course_id == course_id)
        .order_by(Enrollment.id)
    ).all()
    return [
        {
            "id": enrollment.id,
            "user_id": user.id,
            "name": user.full_name,
            "email": user.email,
            "role": enrollment.role,
            "progress": enrollment.progress,
        }
        for enrollment, user in rows
    ]


@service_router.get("/courses/{course_id}/assignments", dependencies=[Depends(require_service_key)])
def assignments(
    course_id: int,
    user_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    require_course(db, course_id)
    items = db.scalars(select(Assignment).where(Assignment.course_id == course_id).order_by(Assignment.due_at)).all()
    return [
        {
            "id": item.id,
            "course_id": item.course_id,
            "title": item.title,
            "description": item.description,
            "due_at": _iso(item.due_at),
            "points_possible": item.points_possible,
            "submission_types": item.submission_types.split(","),
            "published": item.published,
            **assignment_extension_payload(db, item, user_id),
        }
        for item in items
    ]


@service_router.get("/courses/{course_id}/submissions", dependencies=[Depends(require_service_key)])
def submissions(course_id: int, user_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    query = (
        select(Submission, Assignment, SubmissionDetail)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .outerjoin(SubmissionDetail, SubmissionDetail.submission_id == Submission.id)
        .where(Assignment.course_id == course_id)
        .order_by(Submission.id)
    )
    if user_id is not None:
        query = query.where(Submission.user_id == user_id)
    return [
        {
            "id": submission.id,
            "assignment_id": assignment.id,
            "user_id": submission.user_id,
            "submitted_at": _iso(submission.submitted_at),
            "workflow_state": submission.workflow_state,
            "score": submission.score,
            "late": submission.late,
            "feedback": detail.instructor_comment if detail else "",
            "rubric": json.loads(detail.rubric_json or "{}") if detail else {},
            "history": submission_history_payload(db, submission),
        }
        for submission, assignment, detail in db.execute(query).all()
    ]


@service_router.get("/courses/{course_id}/modules", dependencies=[Depends(require_service_key)])
def modules(
    course_id: int,
    user_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    require_course(db, course_id)
    result = []
    for module in db.scalars(
        select(CourseModule).where(CourseModule.course_id == course_id).order_by(CourseModule.position)
    ).all():
        items = db.scalars(
            select(ModuleItem).where(ModuleItem.module_id == module.id).order_by(ModuleItem.position)
        ).all()
        result.append(
            {
                "id": module.id,
                "name": module.name,
                "position": module.position,
                "published": module.published,
                "items": [
                    {
                        "id": item.id,
                        "title": item.title,
                        "type": item.item_type,
                        "content_id": item.content_id,
                        "external_url": item.external_url,
                        "position": item.position,
                        "published": item.published,
                    }
                    for item in items
                ],
                **module_extension_payload(db, module, user_id),
            }
        )
    return result


@service_router.get("/courses/{course_id}/content", dependencies=[Depends(require_service_key)])
def content(course_id: int, kind: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    query = select(CourseContent).where(CourseContent.course_id == course_id).order_by(CourseContent.id)
    if kind:
        query = query.where(CourseContent.kind == kind)
    return [
        {
            "id": item.id,
            "kind": item.kind,
            "title": item.title,
            "body": item.body,
            "due_at": _iso(item.due_at),
            "points_possible": item.points_possible,
            "published": item.published,
        }
        for item in db.scalars(query).all()
    ]


@service_router.get("/courses/{course_id}/files", dependencies=[Depends(require_service_key)])
def files(
    course_id: int,
    user_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    require_course(db, course_id)
    resources = db.scalars(
        select(Resource).where(Resource.course_id == course_id).order_by(Resource.id)
    ).all()
    if user_id is not None:
        resources = [item for item in resources if can_access_resource(db, item, user_id)]
    return [
        {
            "id": item.id,
            "title": item.title,
            "kind": item.kind,
            "source_url": item.source_url,
            **resource_extension_payload(db, item),
        }
        for item in resources
    ]


@service_router.get("/courses/{course_id}/sections", dependencies=[Depends(require_service_key)])
def sections(course_id: int, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    result = []
    for section in db.scalars(select(CourseSection).where(CourseSection.course_id == course_id)).all():
        result.append(
            {
                "id": section.id,
                "name": section.name,
                "member_ids": db.scalars(
                    select(SectionMembership.user_id).where(SectionMembership.section_id == section.id)
                ).all(),
            }
        )
    return result


@service_router.get("/courses/{course_id}/groups", dependencies=[Depends(require_service_key)])
def groups(course_id: int, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    result = []
    categories = db.scalars(select(GroupCategory).where(GroupCategory.course_id == course_id)).all()
    for category in categories:
        category_groups = []
        for group in db.scalars(select(CourseGroup).where(CourseGroup.category_id == category.id)).all():
            category_groups.append(
                {
                    "id": group.id,
                    "name": group.name,
                    "member_ids": db.scalars(
                        select(GroupMembership.user_id).where(GroupMembership.group_id == group.id)
                    ).all(),
                }
            )
        result.append(
            {
                "id": category.id,
                "name": category.name,
                "self_signup": category.self_signup,
                "groups": category_groups,
            }
        )
    return result


@service_router.get("/courses/{course_id}/analytics", dependencies=[Depends(require_service_key)])
def analytics(course_id: int, db: Session = Depends(get_db)) -> dict:
    require_course(db, course_id)
    activities = db.scalars(
        select(LearningActivity).where(LearningActivity.course_id == course_id)
    ).all()
    by_type: dict[str, int] = {}
    total_duration = 0
    active_users: set[int] = set()
    for item in activities:
        by_type[item.activity_type] = by_type.get(item.activity_type, 0) + 1
        total_duration += item.duration_seconds
        active_users.add(item.user_id)
    return {
        "events": len(activities),
        "active_users": len(active_users),
        "duration_seconds": total_duration,
        "by_type": by_type,
    }


@service_router.get("/users/{user_id}/planner", dependencies=[Depends(require_service_key)])
def planner(user_id: int, db: Session = Depends(get_db)) -> list[dict]:
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    items = db.scalars(
        select(PlannerItem)
        .where(PlannerItem.user_id == user_id)
        .order_by(PlannerItem.due_at)
    ).all()
    return [
        {
            "id": item.id,
            "course_id": item.course_id,
            "assignment_id": item.assignment_id,
            "title": item.title,
            "due_at": _iso(item.due_at),
            "completed": item.completed,
        }
        for item in items
    ]


@service_router.get("/users/{user_id}/calendar", dependencies=[Depends(require_service_key)])
def user_calendar(user_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Return fixed calendar commitments used by PaceWise planning.

    Assignment deadlines remain in the assignment API. This endpoint exposes
    events with an actual start/end range so PaceWise can treat them as dynamic
    constraints and react when an instructor moves or removes one.
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    enrolled_course_ids = set(
        db.scalars(select(Enrollment.course_id).where(Enrollment.user_id == user_id)).all()
    )
    events = db.scalars(
        select(CalendarEvent)
        .where(
            CalendarEvent.user_id == user_id,
            (CalendarEvent.course_id.is_(None) | CalendarEvent.course_id.in_(enrolled_course_ids)),
        )
        .order_by(CalendarEvent.starts_at)
    ).all()
    courses = {
        item.id: item
        for item in db.scalars(select(Course).where(Course.id.in_(enrolled_course_ids))).all()
    }
    return [
        {
            "id": f"event-{item.id}",
            "source_id": item.id,
            "type": "event",
            "course_id": item.course_id,
            "course_code": courses[item.course_id].code if item.course_id in courses else None,
            "title": item.title,
            "starts_at": _iso(item.starts_at),
            "ends_at": _iso(item.ends_at),
            "duration_minutes": (
                max(0, int((item.ends_at - item.starts_at).total_seconds() // 60))
                if item.ends_at
                else None
            ),
            "event_kind": item.event_kind,
            "editable": not (
                item.description.startswith("pacewise-2026-v1;")
                or item.description.startswith("course-activity-v1;")
            ),
        }
        for item in events
    ]


@service_router.get(
    "/courses/{course_id}/appointment-groups",
    dependencies=[Depends(require_service_key)],
)
def appointment_groups(course_id: int, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    items = db.scalars(
        select(AppointmentGroup).where(AppointmentGroup.course_id == course_id)
    ).all()
    return [
        {
            "id": item.id,
            "title": item.title,
            "starts_at": _iso(item.starts_at),
            "ends_at": _iso(item.ends_at),
            "slot_minutes": item.slot_minutes,
            "participants_per_slot": item.participants_per_slot,
            "reservations": [
                {
                    "id": reservation.id,
                    "user_id": reservation.user_id,
                    "starts_at": _iso(reservation.starts_at),
                    "ends_at": _iso(reservation.ends_at),
                }
                for reservation in db.scalars(
                    select(AppointmentReservation).where(
                        AppointmentReservation.appointment_group_id == item.id
                    )
                ).all()
            ],
        }
        for item in items
    ]


@service_router.get("/courses/{course_id}/resource-folders", dependencies=[Depends(require_service_key)])
def resource_folders(course_id: int, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    return [
        {
            "id": item.id,
            "parent_id": item.parent_id,
            "name": item.name,
        }
        for item in db.scalars(
            select(ResourceFolder)
            .where(ResourceFolder.course_id == course_id)
            .order_by(ResourceFolder.parent_id, ResourceFolder.name)
        ).all()
    ]


@service_router.get("/courses/{course_id}/grades", dependencies=[Depends(require_service_key)])
def grades(course_id: int, user_id: int | None = None, db: Session = Depends(get_db)) -> dict:
    current = submissions(course_id, user_id, db)
    assignment_ids = select(Assignment.id).where(Assignment.course_id == course_id)
    history_query = select(GradeHistory).where(GradeHistory.assignment_id.in_(assignment_ids)).order_by(
        GradeHistory.graded_at
    )
    if user_id is not None:
        history_query = history_query.where(GradeHistory.user_id == user_id)
    history = db.scalars(history_query).all()
    return {
        "current": current,
        "history": [
            {
                "id": item.id,
                "submission_id": item.submission_id,
                "assignment_id": item.assignment_id,
                "user_id": item.user_id,
                "grader_id": item.grader_id,
                "score": item.score,
                "comment": item.comment,
                "rubric": json.loads(item.rubric_json or "{}"),
                "graded_at": _iso(item.graded_at),
            }
            for item in history
        ],
    }


@service_router.get("/courses/{course_id}/quizzes", dependencies=[Depends(require_service_key)])
def quizzes(
    course_id: int,
    user_id: int | None = None,
    include_answers: bool = False,
    db: Session = Depends(get_db),
) -> list[dict]:
    require_course(db, course_id)
    quiz_items = db.scalars(
        select(CourseContent).where(CourseContent.course_id == course_id, CourseContent.kind == "quiz")
    ).all()
    result = []
    for quiz in quiz_items:
        questions = db.scalars(select(QuizQuestion).where(QuizQuestion.quiz_id == quiz.id)).all()
        attempts_query = select(QuizAttempt).where(QuizAttempt.quiz_id == quiz.id)
        if user_id is not None:
            attempts_query = attempts_query.where(QuizAttempt.user_id == user_id)
        attempts = db.scalars(attempts_query).all()
        result.append(
            {
                "id": quiz.id,
                "title": quiz.title,
                "due_at": _iso(quiz.due_at),
                "questions": [
                    {
                        "id": q.id,
                        "prompt": q.prompt,
                        "points": q.points,
                        "position": q.position,
                        "question_type": "closed" if q.correct_answer else "open",
                        **({"correct_answer": q.correct_answer} if include_answers else {}),
                    }
                    for q in questions
                ],
                "attempts": [
                    {
                        "id": attempt.id,
                        "user_id": attempt.user_id,
                        "score": attempt.score,
                        "submitted_at": _iso(attempt.submitted_at),
                    }
                    for attempt in attempts
                ],
            }
        )
    return result


@service_router.get("/courses/{course_id}/outcomes", dependencies=[Depends(require_service_key)])
def outcomes(course_id: int, user_id: int | None = None, db: Session = Depends(get_db)) -> list[dict]:
    require_course(db, course_id)
    items = db.scalars(
        select(CourseContent).where(CourseContent.course_id == course_id, CourseContent.kind == "outcome")
    ).all()
    result = []
    for item in items:
        alignments = db.scalars(select(OutcomeAlignment).where(OutcomeAlignment.outcome_id == item.id)).all()
        evidence_query = select(LearningEvidence).where(
            LearningEvidence.course_id == course_id,
            LearningEvidence.competency_key == f"outcome:{item.id}",
        )
        if user_id is not None:
            evidence_query = evidence_query.where(LearningEvidence.user_id == user_id)
        evidence = db.scalars(evidence_query).all()
        result.append(
            {
                "id": item.id,
                "title": item.title,
                "description": item.body,
                "mastery_points": item.points_possible,
                "assignment_ids": [alignment.assignment_id for alignment in alignments],
                "evidence_count": len(evidence),
            }
        )
    return result


@service_router.get("/learning-evidence", dependencies=[Depends(require_service_key)])
def learning_evidence(
    user_id: int | None = None,
    course_id: int | None = None,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(LearningEvidence).where(LearningEvidence.id > after_id)
    if user_id is not None:
        query = query.where(LearningEvidence.user_id == user_id)
    if course_id is not None:
        query = query.where(LearningEvidence.course_id == course_id)
    query = query.order_by(LearningEvidence.id).limit(limit)
    return [
        {
            "id": item.id,
            "user_id": item.user_id,
            "course_id": item.course_id,
            "evidence_type": item.evidence_type,
            "source_type": item.source_type,
            "source_id": item.source_id,
            "competency_key": item.competency_key,
            "score": item.score,
            "max_score": item.max_score,
            "details": json.loads(item.details_json or "{}"),
            "observed_at": _iso(item.observed_at),
        }
        for item in db.scalars(query).all()
    ]


@service_router.get("/events", dependencies=[Depends(require_service_key)])
def events(
    after_id: int = Query(default=0, ge=0),
    course_id: int | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(IntegrationEvent).where(IntegrationEvent.id > after_id)
    if course_id is not None:
        query = query.where(IntegrationEvent.course_id == course_id)
    query = query.order_by(IntegrationEvent.id).limit(limit)
    return [
        {
            "id": item.id,
            "type": item.event_type,
            "aggregate_type": item.aggregate_type,
            "aggregate_id": item.aggregate_id,
            "course_id": item.course_id,
            "actor_user_id": item.actor_user_id,
            "payload": json.loads(item.payload_json or "{}"),
            "created_at": _iso(item.created_at),
        }
        for item in db.scalars(query).all()
    ]


@service_router.get("/audit-logs", dependencies=[Depends(require_service_key)])
def audit_logs(
    after_id: int = Query(default=0, ge=0),
    course_id: int | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(AuditLog).where(AuditLog.id > after_id)
    if course_id is not None:
        query = query.where(AuditLog.course_id == course_id)
    query = query.order_by(AuditLog.id).limit(limit)
    return [
        {
            "id": item.id,
            "actor_user_id": item.actor_user_id,
            "action": item.action,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "course_id": item.course_id,
            "metadata": json.loads(item.metadata_json or "{}"),
            "created_at": _iso(item.created_at),
        }
        for item in db.scalars(query).all()
    ]


router.include_router(service_router)
