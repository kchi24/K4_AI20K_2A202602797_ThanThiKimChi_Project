from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest_asyncio.fixture
async def client():
    """Async HTTP client for testing API endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def mock_llm(monkeypatch):
    """Mock the synchronous LLM interface used by all agent workflows."""
    mock = MagicMock()

    def invoke(messages):
        system_prompt = str(messages[0].content)
        if "Coordinator Agent" in system_prompt:
            return SimpleNamespace(
                content='{"workflow": "qa", "reasoning": "Deterministic test route"}'
            )
        return SimpleNamespace(content="Mocked study-support response")

    mock.invoke.side_effect = invoke

    workflow_modules = (
        "src.agents.workflows.coordinator.get_agent_llm",
        "src.agents.workflows.plan.get_agent_llm",
        "src.agents.workflows.qa.get_agent_llm",
        "src.agents.workflows.understanding.get_agent_llm",
        "src.agents.workflows.recover.get_agent_llm",
        "src.agents.workflows.reflect.get_agent_llm",
    )
    for target in workflow_modules:
        monkeypatch.setattr(target, lambda **_kwargs: mock)

    monkeypatch.setattr(
        "src.agents.workflows.qa.search_course_materials",
        lambda **_kwargs: {
            "passages": [],
            "insufficient_sources": True,
            "top_score": 0.0,
        },
    )
    return mock
