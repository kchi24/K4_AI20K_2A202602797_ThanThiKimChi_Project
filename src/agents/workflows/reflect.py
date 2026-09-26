"""
Workflow Reflect: Phản tư và tổng kết tuần học.
Agent phụ trách: Reflection Agent.
"""

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.llm import get_agent_llm
from src.agents.prompts.reflection import REFLECTION_SYSTEM_PROMPT
from src.agents.state import LearningGraphState


def reflect_node(state: LearningGraphState) -> dict:
    """
    Reflection Agent: Tổng kết tuần dựa trên dữ kiện khách quan và đề xuất 1 điều chỉnh cho tuần sau.
    """
    query = state.get("query") or ""
    if not query and state.get("messages"):
        last_msg = state["messages"][-1]
        query = last_msg.get("content", "") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")

    try:
        llm = get_agent_llm(temperature=0.3)
        messages = [
            SystemMessage(content=REFLECTION_SYSTEM_PROMPT),
            HumanMessage(content=f"Dữ liệu phản tư cuối tuần của sinh viên: '{query}'"),
        ]
        res = llm.invoke(messages)
        response_text = res.content.strip()
    except Exception as e:
        response_text = f"[Lỗi kết nối Reflection Agent]: {e}"

    return {
        "current_node": "reflect",
        "response": response_text,
        "analysis": "Reflection Agent đã tổng kết dựa trên dữ kiện khách quan và đưa ra 1 gợi ý điều chỉnh.",
    }
