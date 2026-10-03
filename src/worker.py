"""Standalone PaceWise LMS projection and RAG worker."""

import asyncio
import logging

from src.config import get_settings
from src.db import initialize_database
from src.services.sync_worker import run_worker


def main() -> None:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    initialize_database()
    asyncio.run(run_worker(settings))


if __name__ == "__main__":
    main()
