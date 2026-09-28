import asyncio

from src.config import Settings
from src.db import SessionLocal
from src.persistence_models import SyncCursor
from src.services.lms_client import LMSClient


async def poll_lms_events(settings: Settings, stop: asyncio.Event) -> None:
    client = LMSClient(settings)
    while not stop.is_set():
        try:
            with SessionLocal() as db:
                cursor = db.get(SyncCursor, "lms-global") or SyncCursor(key="lms-global", last_event_id=0)
                db.add(cursor)
                events = await client.service_get(
                    "/api/pacewise/v1/events",
                    {"after_id": cursor.last_event_id, "limit": 500},
                )
                if events:
                    cursor.last_event_id = max(int(item["id"]) for item in events)
                db.commit()
        except Exception:
            # Health endpoints and logs expose outages; the next loop retries from the saved cursor.
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.lms_sync_interval_seconds)
        except TimeoutError:
            continue
