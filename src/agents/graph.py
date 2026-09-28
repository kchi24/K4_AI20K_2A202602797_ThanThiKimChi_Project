"""
Master LangGraph: Kết nối Coordinator và 6 workflow nhánh kèm LangGraph Checkpointer (MemorySaver).
Hỗ trợ quản lý phiên làm việc đa lượt (Multi-turn conversations) qua thread_id.
"""

import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from src.agents.state import LearningGraphState
from src.agents.workflows.coordinator import coordinator_node
from src.agents.workflows.plan import plan_node
from src.agents.workflows.qa import qa_node
from src.agents.workflows.recover import recover_node
from src.agents.workflows.reflect import reflect_node
from src.agents.workflows.tracking import tracking_node
from src.agents.workflows.understanding import understanding_node
from src.config import Settings
from src.observability import observe_agent_node


def route_workflow(state: LearningGraphState) -> str:
    """Điều hướng từ coordinator sang workflow tương ứng."""
    workflow = state.get("workflow", "qa")
    valid_workflows = {"plan", "tracking", "qa", "understanding", "recover", "reflect"}
    return workflow if workflow in valid_workflows else "qa"


# Checkpointer mặc định lưu trạng thái hội thoại nhiều lượt trong bộ nhớ
default_checkpointer = MemorySaver()


def instrument_node(name: str, node: Callable[[LearningGraphState], dict[str, Any]]):
    """Attach privacy-safe latency/status telemetry to every workflow node."""

    def wrapped(state: LearningGraphState) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            result = node(state)
            outcome = "ok"
            duration = time.perf_counter() - started
            observe_agent_node(name, outcome, duration)
            node_events = result.get("audit_events") or []
            return result | {
                "audit_events": [
                    *node_events,
                    {
                        "event": "AGENT_NODE_COMPLETED",
                        "node": name,
                        "workflow": result.get("current_node", name),
                        "outcome": outcome,
                        "latency_ms": round(duration * 1000, 2),
                        "timestamp": datetime.now(UTC).isoformat(),
                    }
                ]
            }
        except Exception as exc:
            observe_agent_node(name, "error", time.perf_counter() - started)
            exc.add_note(f"agent_node={name}")
            raise

    return wrapped


def create_agent(checkpointer: Any = default_checkpointer):
    """
    Khởi tạo và biên dịch StateGraph cho Multi-Agent system.
    Tích hợp Checkpointer để duy trì bộ nhớ phiên hội thoại nhiều lượt.
    """
    builder = StateGraph(LearningGraphState)

    # 1. Thêm các Node
    builder.add_node("coordinator", instrument_node("coordinator", coordinator_node))
    builder.add_node("plan", instrument_node("plan", plan_node))
    builder.add_node("tracking", instrument_node("tracking", tracking_node))
    builder.add_node("qa", instrument_node("qa", qa_node))
    builder.add_node("understanding", instrument_node("understanding", understanding_node))
    builder.add_node("recover", instrument_node("recover", recover_node))
    builder.add_node("reflect", instrument_node("reflect", reflect_node))

    # 2. Đặt điểm bắt đầu
    builder.set_entry_point("coordinator")

    # 3. Thêm cạnh rẽ nhánh từ coordinator
    builder.add_conditional_edges(
        "coordinator",
        route_workflow,
        {
            "plan": "plan",
            "tracking": "tracking",
            "qa": "qa",
            "understanding": "understanding",
            "recover": "recover",
            "reflect": "reflect",
        },
    )

    # 4. Các workflow nhánh kết thúc tại END
    builder.add_edge("plan", END)
    builder.add_edge("tracking", END)
    builder.add_edge("qa", END)
    builder.add_edge("understanding", END)
    builder.add_edge("recover", END)
    builder.add_edge("reflect", END)

    if checkpointer is not None:
        return builder.compile(checkpointer=checkpointer)
    return builder.compile()


# Instance agent chính dùng cho API và CLI (được trang bị Checkpointer)
agent = create_agent()
checkpointer = default_checkpointer


def _postgres_checkpoint_url(database_url: str) -> str:
    return database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@asynccontextmanager
async def runtime_agent(settings: Settings):
    """Use durable Postgres state in deployed environments and memory in local tests."""
    if settings.use_postgres_checkpoint and settings.database_url.startswith("postgresql"):
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        async with AsyncPostgresSaver.from_conn_string(
            _postgres_checkpoint_url(settings.database_url)
        ) as postgres_checkpointer:
            await postgres_checkpointer.setup()
            yield create_agent(postgres_checkpointer)
        return
    yield agent
