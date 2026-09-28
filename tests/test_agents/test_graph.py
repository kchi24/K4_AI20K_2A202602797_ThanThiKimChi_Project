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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "expected_node"),
    [
        ("Lập kế hoạch tuần và chia nhỏ milestone", "plan"),
        ("Kiểm tra tiến độ và thời gian thực tế", "tracking"),
        ("Giải thích khái niệm trong bài học", "qa"),
        ("Kiểm tra hiểu bài theo rubric", "understanding"),
        ("Mình trễ deadline, hãy cứu lịch", "recover"),
        ("Phản tư và tổng kết cuối tuần", "reflect"),
    ],
)
async def test_graph_routes_all_workflows(mock_llm, query, expected_node):
    config = {"configurable": {"thread_id": f"route-{expected_node}"}}
    result = await agent.ainvoke({"query": query}, config=config)
    assert result["current_node"] == expected_node
    assert any(event["node"] == expected_node for event in result["audit_events"])


@pytest.mark.asyncio
async def test_graph_preserves_workflow_audit_events(mock_llm):
    config = {"configurable": {"thread_id": "audit-citation-dispute"}}
    result = await agent.ainvoke(
        {"query": "Trích dẫn sai [Giáo trình, Trang 2, Đoạn 1]"},
        config=config,
    )
    assert any(event["event"] == "CITATION_DISPUTED" for event in result["audit_events"])
