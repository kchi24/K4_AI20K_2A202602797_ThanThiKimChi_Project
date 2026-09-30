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
from src.services.sync_worker import project_lms_events, recover_interrupted_ingestion_jobs


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
