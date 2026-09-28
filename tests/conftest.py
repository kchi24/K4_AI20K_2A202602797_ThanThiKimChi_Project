from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from src.db import SessionLocal, initialize_database
from src.main import app
from src.persistence_models import LoginAttempt


@pytest_asyncio.fixture
async def client():
    """Async HTTP client for testing API endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def initialize_test_database():
    initialize_database()
    with SessionLocal() as db:
        db.query(LoginAttempt).delete()
        db.commit()


@pytest.fixture(autouse=True)
def mock_llm(monkeypatch):
    """Mock LLM to avoid calling OpenAI during tests.

    Usage in test:
        def test_something(mock_llm):
            # LLM calls will return mock response instead of hitting OpenAI
            ...
    """
    mock = AsyncMock()
    mock.ainvoke.return_value = SimpleNamespace(content="Mocked LLM response")
    monkeypatch.setattr("src.agents.nodes.example_node.get_llm", lambda: mock)
    return mock
