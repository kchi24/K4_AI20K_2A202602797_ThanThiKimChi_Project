"""
Master LangGraph: Kết nối Coordinator và 6 workflow nhánh kèm LangGraph Checkpointer (MemorySaver).
Hỗ trợ quản lý phiên làm việc đa lượt (Multi-turn conversations) qua thread_id.
"""

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


def route_workflow(state: LearningGraphState) -> str:
    """Điều hướng từ coordinator sang workflow tương ứng."""
    workflow = state.get("workflow", "qa")
    valid_workflows = {"plan", "tracking", "qa", "understanding", "recover", "reflect"}
    return workflow if workflow in valid_workflows else "qa"


# Checkpointer mặc định lưu trạng thái hội thoại nhiều lượt trong bộ nhớ
default_checkpointer = MemorySaver()


def create_agent(checkpointer: Any = default_checkpointer):
    """
    Khởi tạo và biên dịch StateGraph cho Multi-Agent system.
    Tích hợp Checkpointer để duy trì bộ nhớ phiên hội thoại nhiều lượt.
    """
    builder = StateGraph(LearningGraphState)

    # 1. Thêm các Node
    builder.add_node("coordinator", coordinator_node)
    builder.add_node("plan", plan_node)
    builder.add_node("tracking", tracking_node)
    builder.add_node("qa", qa_node)
    builder.add_node("understanding", understanding_node)
    builder.add_node("recover", recover_node)
    builder.add_node("reflect", reflect_node)

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
