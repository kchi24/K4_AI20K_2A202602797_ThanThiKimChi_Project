"""Authenticated server-sent events for LMS projection changes."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator, Sequence

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from src.config import Settings
from src.db import SessionLocal
from src.persistence_models import LmsEventProjection
from src.security import SessionContext, get_detached_session

router = APIRouter(prefix="/lms", tags=["lms-realtime"])
logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 1.0
HEARTBEAT_INTERVAL_SECONDS = 15.0
EVENT_BATCH_SIZE = 100
SUBSCRIBER_QUEUE_SIZE = 20


def encode_sse_event(*, event_id: int, event_type: str, course_id: int | None) -> str:
    """Serialize the minimal event contract exposed to the browser."""
    payload = json.dumps(
        {"eventId": event_id, "type": event_type, "courseId": course_id},
        separators=(",", ":"),
    )
    return f"id: {event_id}\nevent: lms.changed\ndata: {payload}\n\n"


def _latest_event_id(institution_id: str) -> int:
    with SessionLocal() as db:
        value = db.scalar(
            select(func.max(LmsEventProjection.source_event_id)).where(
                LmsEventProjection.institution_id == institution_id,
            )
        )
    return int(value or 0)


def _events_after(institution_id: str, cursor: int) -> list[LmsEventProjection]:
    with SessionLocal() as db:
        return list(
            db.scalars(
                select(LmsEventProjection)
                .where(
                    LmsEventProjection.institution_id == institution_id,
                    LmsEventProjection.source_event_id > cursor,
                )
                .order_by(LmsEventProjection.source_event_id)
                .limit(EVENT_BATCH_SIZE)
            )
        )


class LmsEventBroker:
    """Poll the durable projection once and fan changes out to SSE clients."""

    def __init__(self, settings: Settings) -> None:
        self._institution_id = settings.institution_id
        self._subscribers: dict[asyncio.Queue[LmsEventProjection], frozenset[int]] = {}
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="lms-event-broker")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        self._subscribers.clear()

    def subscribe(self, course_ids: Sequence[int]) -> asyncio.Queue[LmsEventProjection]:
        queue: asyncio.Queue[LmsEventProjection] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        self._subscribers[queue] = frozenset(course_ids)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[LmsEventProjection]) -> None:
        self._subscribers.pop(queue, None)

    def _publish(self, event: LmsEventProjection) -> None:
        for queue, course_ids in tuple(self._subscribers.items()):
            if event.course_id is not None and event.course_id not in course_ids:
                continue
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(event)

    async def _run(self) -> None:
        cursor = await asyncio.to_thread(_latest_event_id, self._institution_id)
        while True:
            try:
                events = await asyncio.to_thread(_events_after, self._institution_id, cursor)
                for event in events:
                    cursor = max(cursor, event.source_event_id)
                    self._publish(event)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("lms_event_broker_poll_failed")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def _event_stream(
    request: Request,
    session: SessionContext,
    broker: LmsEventBroker,
) -> AsyncIterator[str]:
    queue = broker.subscribe(session.course_ids)
    try:
        yield "event: ready\ndata: {}\n\n"
        while not await request.is_disconnected():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL_SECONDS)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            yield encode_sse_event(
                event_id=event.source_event_id,
                event_type=event.event_type,
                course_id=event.course_id,
            )
    finally:
        broker.unsubscribe(queue)


@router.get("/events/stream", include_in_schema=False)
async def stream_lms_events(
    request: Request,
    session: SessionContext = Depends(get_detached_session),
) -> StreamingResponse:
    broker = getattr(request.app.state, "lms_event_broker", None)
    if not isinstance(broker, LmsEventBroker):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Realtime LMS updates are not available",
        )
    return StreamingResponse(
        _event_stream(request, session, broker),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
