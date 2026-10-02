"""Durable LMS event projection and asynchronous RAG ingestion worker."""

from __future__ import annotations

import asyncio
import json
import logging

from sqlalchemy import select

from src.agents.tools.schedule_calculator import check_deadline_slack
from src.config import Settings
from src.db import SessionLocal
from src.persistence_models import (
    CourseProjection,
    LmsCourseContextProjection,
    LmsEventProjection,
    RagIngestionJob,
    SyncCursor,
)
from src.services.lms_client import LMSClient
from src.services.rag_pipeline import (
    build_scoped_resources,
    enqueue_course_snapshot,
    process_ingestion_job,
    snapshot_version,
)

logger = logging.getLogger("pacewise.worker")
CONTENT_EVENTS = {
    "content.created",
    "content.updated",
    "content.deleted",
    "course.created",
    "course.updated",
}
RISK_EVENTS = {
    "assignment.created",
    "assignment.updated",
    "assignment.deleted",
    "submission.submitted",
    "grade.updated",
    "quiz.attempted",
}


def recover_interrupted_ingestion_jobs() -> int:
    """Return jobs abandoned by a stopped worker to the retry queue."""
    with SessionLocal() as db:
        jobs = db.scalars(select(RagIngestionJob).where(RagIngestionJob.status == "processing")).all()
        for job in jobs:
            job.status = "retry" if job.attempts < 3 else "failed"
            job.last_error = "Worker stopped before the ingestion job completed"
        db.commit()
        return len(jobs)


def _projection_id(settings: Settings, event_id: int) -> str:
    return f"{settings.institution_id}:{event_id}"


async def _refresh_course(
    client: LMSClient,
    settings: Settings,
    course_id: int,
    *,
    refresh_content: bool,
    refresh_assignments: bool,
    event_id: int = 0,
) -> None:
    courses = await client.service_get("/api/pacewise/v1/courses")
    course = next((item for item in courses if int(item["id"]) == course_id), None)
    if not course:
        return
    content = await client.service_get(f"/api/pacewise/v1/courses/{course_id}/content") if refresh_content else None
    assignments = (
        await client.service_get(f"/api/pacewise/v1/courses/{course_id}/assignments") if refresh_assignments else None
    )
    modules = (
        await client.service_get(f"/api/pacewise/v1/courses/{course_id}/modules")
        if refresh_content
        else None
    )

    with SessionLocal() as db:
        identifier = f"{settings.institution_id}:{course_id}"
        projection = db.get(CourseProjection, identifier) or CourseProjection(
            id=identifier,
            institution_id=settings.institution_id,
            course_id=course_id,
        )
        db.add(projection)
        if assignments is not None:
            projection.assignments_json = json.dumps(assignments, ensure_ascii=False)
            risk_signals = []
            for assignment in assignments:
                if not assignment.get("due_at") or not assignment.get("published", True):
                    continue
                estimated_hours = max(
                    0.5,
                    min(4.0, float(assignment.get("points_possible") or 5) * 0.2),
                )
                risk = check_deadline_slack(assignment["due_at"], estimated_hours)
                if risk["is_at_risk"]:
                    risk_signals.append(
                        {
                            "assignment_id": str(assignment["id"]),
                            "title": assignment.get("title", "Bài tập"),
                            "risk_level": risk["risk_level"],
                            "slack_hours": risk["slack_hours"],
                            "source": "lms_event_projection",
                        }
                    )
            projection.risk_signals_json = json.dumps(risk_signals, ensure_ascii=False)
            projection.risk_refresh_required = 1
        if content is not None:
            resources = build_scoped_resources(
                content,
                institution_id=settings.institution_id,
                course_id=course_id,
                course_code=str(course.get("code") or course_id),
            )
            projection.content_version = snapshot_version(resources)
            enqueue_course_snapshot(
                db,
                institution_id=settings.institution_id,
                course_id=course_id,
                resources=resources,
            )
        projection.last_event_id = max(projection.last_event_id or 0, event_id)
        context_id = f"{settings.institution_id}:{course_id}"
        context = db.get(LmsCourseContextProjection, context_id) or LmsCourseContextProjection(
            id=context_id,
            institution_id=settings.institution_id,
            course_id=course_id,
        )
        context.course_json = json.dumps(course, ensure_ascii=False)
        if assignments is not None:
            context.assignments_json = json.dumps(assignments, ensure_ascii=False)
        if modules is not None:
            context.modules_json = json.dumps(modules, ensure_ascii=False)
        db.add(context)
        db.commit()


async def bootstrap_course_snapshots(client: LMSClient, settings: Settings) -> None:
    """Ensure a fresh deployment has course projections without waiting for an event."""
    courses = await client.service_get("/api/pacewise/v1/courses")
    for course in courses:
        await _refresh_course(
            client,
            settings,
            int(course["id"]),
            refresh_content=True,
            refresh_assignments=True,
        )


async def project_lms_events(client: LMSClient, settings: Settings) -> int:
    """Persist LMS events and apply them to course projections."""
    with SessionLocal() as db:
        cursor = db.get(SyncCursor, "lms-global") or SyncCursor(key="lms-global", last_event_id=0)
        after_id = cursor.last_event_id
    events = await client.service_get(
        "/api/pacewise/v1/events",
        {"after_id": after_id, "limit": settings.worker_batch_size},
    )
    for event in events:
        event_id = int(event["id"])
        course_id = int(event["course_id"]) if event.get("course_id") is not None else None
        with SessionLocal() as db:
            identifier = _projection_id(settings, event_id)
            if not db.get(LmsEventProjection, identifier):
                db.add(
                    LmsEventProjection(
                        id=identifier,
                        institution_id=settings.institution_id,
                        source_event_id=event_id,
                        event_type=str(event.get("type") or "unknown"),
                        aggregate_type=str(event.get("aggregate_type") or ""),
                        aggregate_id=str(event.get("aggregate_id") or ""),
                        course_id=course_id,
                        payload_json=json.dumps(event.get("payload") or {}, ensure_ascii=False),
                        occurred_at=str(event.get("created_at") or ""),
                    )
                )
                db.commit()

        event_type = str(event.get("type") or "")
        if course_id is not None and (event_type in CONTENT_EVENTS or event_type in RISK_EVENTS):
            await _refresh_course(
                client,
                settings,
                course_id,
                refresh_content=event_type in CONTENT_EVENTS,
                refresh_assignments=event_type in RISK_EVENTS,
                event_id=event_id,
            )
        with SessionLocal() as db:
            cursor = db.get(SyncCursor, "lms-global") or SyncCursor(key="lms-global", last_event_id=0)
            cursor.last_event_id = max(cursor.last_event_id, event_id)
            db.add(cursor)
            db.commit()
    return len(events)


def process_pending_ingestion_jobs(settings: Settings) -> int:
    """Process a bounded number of durable jobs outside the request path."""
    processed = 0
    while processed < settings.worker_batch_size:
        with SessionLocal() as db:
            job = db.scalar(
                select(RagIngestionJob)
                .where(RagIngestionJob.status.in_(("pending", "retry")))
                .order_by(RagIngestionJob.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if not job:
                break
            job.status = "processing"
            job.attempts += 1
            db.commit()
            job_id = job.id
        try:
            with SessionLocal() as db:
                job = db.get(RagIngestionJob, job_id)
                if not job:
                    continue
                process_ingestion_job(job)
                job.status = "completed"
                job.last_error = ""
                db.commit()
        except Exception as exc:
            logger.exception("rag_job_failed job_id=%s", job_id)
            with SessionLocal() as db:
                failed = db.get(RagIngestionJob, job_id)
                if failed:
                    failed.status = "retry" if failed.attempts < 3 else "failed"
                    failed.last_error = f"{type(exc).__name__}: {exc}"[:2000]
                    db.commit()
        processed += 1
    return processed


async def run_worker(settings: Settings, stop: asyncio.Event | None = None) -> None:
    stop = stop or asyncio.Event()
    client = LMSClient(settings)
    bootstrapped = False
    await asyncio.to_thread(recover_interrupted_ingestion_jobs)
    while not stop.is_set():
        try:
            if not bootstrapped:
                await bootstrap_course_snapshots(client, settings)
                bootstrapped = True
            await project_lms_events(client, settings)
            await asyncio.to_thread(process_pending_ingestion_jobs, settings)
        except Exception:
            logger.exception("lms_worker_iteration_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.lms_sync_interval_seconds)
        except TimeoutError:
            continue


# Compatibility for tests and older callers.
poll_lms_events = run_worker
