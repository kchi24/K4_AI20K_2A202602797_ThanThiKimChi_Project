import os
import time
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://canvas:canvas@postgres:5432/canvas_development",
)


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def initialize_database(max_attempts: int = 30) -> None:
    """Wait for PostgreSQL, create the small schema, and add demo fixtures."""
    last_error: Exception | None = None
    for _ in range(max_attempts):
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            break
        except Exception as exc:  # pragma: no cover - startup retry
            last_error = exc
            time.sleep(1)
    else:
        raise RuntimeError("PostgreSQL did not become ready") from last_error

    from app import models  # noqa: F401
    from app.seed import seed_demo_data

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_data(db)
