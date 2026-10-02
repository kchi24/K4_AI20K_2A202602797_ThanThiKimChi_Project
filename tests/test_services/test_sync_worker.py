import json
from unittest.mock import AsyncMock

import pytest

from src.config import get_settings
from src.db import SessionLocal
from src.persistence_models import (
    CourseProjection,
    LmsCourseContextProjection,
    LmsEventProjection,
    RagIngestionJob,
    SyncCursor,
)
from src.services import sync_worker
from src.services.sync_worker import (
    bootstrap_course_snapshots,
    process_pending_ingestion_jobs,
    project_lms_events,
    recover_interrupted_ingestion_jobs,
)


@pytest.mark.asyncio
async def test_lms_event_updates_projection_and_enqueues_rag_snapshot():
    settings = get_settings()
    with SessionLocal() as db:
        db.query(LmsEventProjection).delete()
        db.query(RagIngestionJob).delete()
        db.query(CourseProjection).delete()
        db.query(LmsCourseContextProjection).delete()
        db.query(SyncCursor).delete()
        db.commit()

    async def service_get(path, params=None):
        if path.endswith("/events"):
            assert params["after_id"] == 0
            return [
                {
                    "id": 901,
                    "type": "content.updated",
                    "aggregate_type": "page",
                    "aggregate_id": "11",
                    "course_id": 7,
                    "actor_user_id": 2,
                    "payload": {"title": "Updated lesson"},
                    "created_at": "2026-09-28T10:00:00Z",
                }
            ]
        if path == "/api/pacewise/v1/courses":
            return [{"id": 7, "code": "AI101", "name": "AI"}]
        if path.endswith("/content"):
            return [{"id": 11, "title": "Updated lesson", "body": "Fresh content", "published": True}]
        if path.endswith("/modules"):
            return [{"id": 1, "name": "Week 1", "items": []}]
        raise AssertionError(path)

    client = AsyncMock()
    client.service_get.side_effect = service_get
    count = await project_lms_events(client, settings)
    assert count == 1
    with SessionLocal() as db:
        event = db.get(LmsEventProjection, f"{settings.institution_id}:901")
        projection = db.get(CourseProjection, f"{settings.institution_id}:7")
        context = db.get(LmsCourseContextProjection, f"{settings.institution_id}:7")
        job = db.scalar(db.query(RagIngestionJob).statement)
        cursor = db.get(SyncCursor, "lms-global")
        assert event is not None
        assert projection is not None and projection.content_version
        assert json.loads(context.modules_json)[0]["name"] == "Week 1"
        assert json.loads(job.resources_json)[0]["course_id"] == "7"
        assert cursor.last_event_id == 901


def test_worker_recovers_interrupted_ingestion_jobs():
    settings = get_settings()
    job = RagIngestionJob(
        id="interrupted-job",
        institution_id=settings.institution_id,
        course_id=7,
        resource_version="v1",
        resources_json="[]",
        status="processing",
        attempts=1,
    )
    with SessionLocal() as db:
        db.query(RagIngestionJob).filter(RagIngestionJob.id == job.id).delete()
        db.add(job)
        db.commit()

    assert recover_interrupted_ingestion_jobs() == 1
    with SessionLocal() as db:
        recovered = db.get(RagIngestionJob, job.id)
        assert recovered.status == "retry"
        assert "Worker stopped" in recovered.last_error


@pytest.mark.asyncio
async def test_assignment_event_refreshes_risk_projection():
    settings = get_settings()
    with SessionLocal() as db:
        db.query(LmsEventProjection).delete()
        db.query(CourseProjection).delete()
        db.query(LmsCourseContextProjection).delete()
        db.query(SyncCursor).delete()
        db.commit()

    async def service_get(path, params=None):
        if path.endswith("/events"):
            return [
                {
                    "id": 902,
                    "type": "assignment.updated",
                    "aggregate_type": "assignment",
                    "aggregate_id": "12",
                    "course_id": 8,
                    "payload": {},
                    "created_at": "2026-10-02T10:00:00Z",
                }
            ]
        if path == "/api/pacewise/v1/courses":
            return [{"id": 8, "code": "CS8", "name": "Systems"}]
        if path.endswith("/assignments"):
            return [
                {
                    "id": 12,
                    "title": "Urgent project",
                    "due_at": "2020-01-01T00:00:00Z",
                    "points_possible": 10,
                    "published": True,
                },
                {"id": 13, "title": "Draft", "published": False},
            ]
        raise AssertionError(path)

    client = AsyncMock()
    client.service_get.side_effect = service_get
    assert await project_lms_events(client, settings) == 1
    with SessionLocal() as db:
        projection = db.get(CourseProjection, f"{settings.institution_id}:8")
        context = db.get(LmsCourseContextProjection, f"{settings.institution_id}:8")
        assert json.loads(projection.risk_signals_json)[0]["assignment_id"] == "12"
        assert json.loads(context.assignments_json)[0]["title"] == "Urgent project"


@pytest.mark.asyncio
async def test_bootstrap_refreshes_each_course_and_skips_missing_course(monkeypatch):
    settings = get_settings()
    client = AsyncMock()
    client.service_get.return_value = [{"id": 7}, {"id": 8}]
    refresh = AsyncMock()
    monkeypatch.setattr(sync_worker, "_refresh_course", refresh)

    await bootstrap_course_snapshots(client, settings)

    assert refresh.await_count == 2
    assert refresh.await_args_list[0].kwargs == {
        "refresh_content": True,
        "refresh_assignments": True,
    }

    missing_client = AsyncMock()
    missing_client.service_get.return_value = []
    await sync_worker._refresh_course(
        missing_client,
        settings,
        999,
        refresh_content=True,
        refresh_assignments=True,
    )


def _queue_job(job_id: str, attempts: int = 0) -> None:
    settings = get_settings()
    with SessionLocal() as db:
        db.query(RagIngestionJob).filter(
            RagIngestionJob.status.in_(("pending", "retry", "processing"))
        ).delete(synchronize_session=False)
        db.add(
            RagIngestionJob(
                id=job_id,
                institution_id=settings.institution_id,
                course_id=7,
                resource_version=f"version-{job_id}",
                resources_json="[]",
                status="pending",
                attempts=attempts,
            )
        )
        db.commit()


def test_pending_ingestion_jobs_complete_and_retry(monkeypatch):
    settings = get_settings()
    settings.worker_batch_size = 1
    _queue_job("coverage-job-success")
    monkeypatch.setattr(sync_worker, "process_ingestion_job", lambda _job: {"status": "ok"})
    assert process_pending_ingestion_jobs(settings) == 1
    with SessionLocal() as db:
        completed = db.get(RagIngestionJob, "coverage-job-success")
        assert completed.status == "completed"
        assert completed.attempts == 1

    _queue_job("coverage-job-failure", attempts=2)

    def fail(_job):
        raise RuntimeError("vector store unavailable")

    monkeypatch.setattr(sync_worker, "process_ingestion_job", fail)
    assert process_pending_ingestion_jobs(settings) == 1
    with SessionLocal() as db:
        failed = db.get(RagIngestionJob, "coverage-job-failure")
        assert failed.status == "failed"
        assert "vector store unavailable" in failed.last_error


@pytest.mark.asyncio
async def test_worker_runs_one_complete_iteration(monkeypatch):
    settings = get_settings()
    stop = __import__("asyncio").Event()
    bootstrap = AsyncMock()
    project = AsyncMock()

    def process(_settings):
        stop.set()
        return 0

    monkeypatch.setattr(sync_worker, "recover_interrupted_ingestion_jobs", lambda: 0)
    monkeypatch.setattr(sync_worker, "bootstrap_course_snapshots", bootstrap)
    monkeypatch.setattr(sync_worker, "project_lms_events", project)
    monkeypatch.setattr(sync_worker, "process_pending_ingestion_jobs", process)

    await sync_worker.run_worker(settings, stop)

    bootstrap.assert_awaited_once()
    project.assert_awaited_once()
