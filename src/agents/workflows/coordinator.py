"""
Coordinator Node: Tiếp nhận state, phân loại ý định người dùng bằng LLM và chọn workflow kế tiếp.
"""

import json
from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.llm import get_agent_llm
from src.agents.prompts.coordinator import COORDINATOR_SYSTEM_PROMPT
from src.agents.state import LearningGraphState


def coordinator_node(state: LearningGraphState) -> dict:
    """
    Node phân loại và điều phối chính của Multi-Agent.
    Sử dụng LLM để xác định chính xác 1 trong 6 workflows:
    plan | tracking | qa | understanding | recover | reflect.
    """
    query = state.get("query") or ""
    if not query and state.get("messages"):
        last_msg = state["messages"][-1]
        query = last_msg.get("content", "") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")

    workflow = "qa"
    reasoning = "Mặc định hỏi đáp học tập."

    has_existing_milestones = bool(state.get("proposed_milestones"))
    context_note = f" (Ngữ cảnh: Phiên học đã có {len(state.get('proposed_milestones') or [])} milestones)" if has_existing_milestones else ""

    try:
        llm = get_agent_llm(temperature=0.0)
        messages = [
            SystemMessage(content=COORDINATOR_SYSTEM_PROMPT),
            HumanMessage(content=f"Yêu cầu của sinh viên: '{query}'{context_note}"),
        ]
        res = llm.invoke(messages)
        content = res.content.strip()

        # Làm sạch định dạng Markdown JSON nếu có
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        data = json.loads(content)
        detected_workflow = data.get("workflow", "").lower()
        if detected_workflow in {"plan", "tracking", "qa", "understanding", "recover", "reflect"}:
            workflow = detected_workflow
            reasoning = data.get("reasoning", "")
    except Exception:
        # Fallback heuristic nếu LLM gặp sự cố mạng/json parse
        q_lower = query.lower()
        if any(k in q_lower for k in ["tiểu luận", "kế hoạch", "plan", "milestone", "chia việc", "bắt đầu từ đâu", "bài tập lớn", "dời milestone", "sửa milestone", "thời lượng", "mốc", "lộ trình"]):
            workflow = "plan"
            reasoning = "Heuristic: Sinh viên cần lên kế hoạch hoặc điều chỉnh mốc milestone."
        elif any(k in q_lower for k in ["tiến độ", "tracking", "đã học", "hoàn thành"]):
            workflow = "tracking"
            reasoning = "Heuristic: Báo cáo tiến độ học tập."
        elif any(k in q_lower for k in ["hiểu bài", "quiz", "rubric", "kiểm tra"]):
            workflow = "understanding"
            reasoning = "Heuristic: Đánh giá mức độ hiểu bài."
        elif any(k in q_lower for k in ["trễ", "cứu", "đổi lịch", "recover", "quá tải"]):
            workflow = "recover"
            reasoning = "Heuristic: Xử lý rủi ro / dời lịch."
        elif any(k in q_lower for k in ["tổng kết", "cuối tuần", "phản tư", "reflect"]):
            workflow = "reflect"
            reasoning = "Heuristic: Tổng kết phản tư cuối tuần."

    return {
        "workflow": workflow,
        "current_node": "coordinator",
        "analysis": reasoning,
    }
