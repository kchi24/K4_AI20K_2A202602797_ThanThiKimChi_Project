import pytest

from src.agents.graph import agent


@pytest.mark.asyncio
async def test_agent_basic_flow(mock_llm):
    config = {"configurable": {"thread_id": "test-basic-flow"}}
    result = await agent.ainvoke({"query": "Hello"}, config=config)
    assert "response" in result
    assert result["workflow"] == "qa"
    assert result["current_node"] == "qa"
    assert result["response"] == "Mocked study-support response"


@pytest.mark.asyncio
async def test_agent_state_structure(mock_llm):
    config = {"configurable": {"thread_id": "test-state-structure"}}
    result = await agent.ainvoke({"query": "Test query"}, config=config)
    assert isinstance(result, dict)
    assert "query" in result
    assert isinstance(result["retrieved_passages"], list)
    assert isinstance(result["source_refs"], list)
