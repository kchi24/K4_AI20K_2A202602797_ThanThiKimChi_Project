"""
Workflow Reflect: Phản tư và tổng kết tuần học.
Agent phụ trách: Reflection Agent.
"""

import json
import re

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.guardrails import normalize_text
from src.agents.llm import get_agent_llm
from src.agents.prompts.reflection import REFLECTION_SYSTEM_PROMPT
from src.agents.state import LearningGraphState
from src.agents.validators import build_pending_action


def reflect_node(state: LearningGraphState) -> dict:
    """
    Reflection Agent: Tổng kết tuần dựa trên dữ kiện khách quan và đề xuất 1 điều chỉnh cho tuần sau.
    """
    query = state.get("query") or ""
    if not query and state.get("messages"):
        last_msg = state["messages"][-1]
        query = last_msg.get("content", "") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")

    normalized_query = normalize_text(query)
    pending_action = state.get("pending_action") or {}
    if pending_action.get("workflow") == "reflect" and any(
        word in normalized_query for word in ("xac nhan", "dong y", "chap nhan", "confirm")
    ):
        return {
            "current_node": "reflect",
            "response": "Điều chỉnh cho tuần sau đã được xác nhận.",
            "reflection_draft": pending_action.get("payload"),
            "pending_action": None,
            "status": "completed",
            "student_decision": {"action": "confirmed", "workflow": "reflect"},
        }

    try:
        llm = get_agent_llm(temperature=0.3)
        messages = [
            SystemMessage(content=REFLECTION_SYSTEM_PROMPT),
            HumanMessage(
                content=(
                    f"Dữ liệu phản tư cuối tuần của sinh viên: '{query}'\n"
                    f"Chỉ số tiến độ: {json.dumps(state.get('progress_metrics') or {}, ensure_ascii=False)}\n"
                    f"Hồ sơ dài hạn: {json.dumps(state.get('learner_profile') or {}, ensure_ascii=False)}\n"
                    "Cuối phản hồi thêm JSON gồm effective, deviation_cause, adjustment, evidence."
                )
            ),
        ]
        res = llm.invoke(messages)
        response_text = res.content.strip()
    except Exception:
        response_text = "Mình chưa thể tổng hợp phản tư tự động lúc này; bạn có thể kiểm tra bản điều chỉnh tối thiểu bên dưới."

    progress_metrics = state.get("progress_metrics") or {}
    reflection_draft = {
        "effective": "",
        "deviation_cause": "",
        "adjustment": "Giữ một thay đổi nhỏ, cụ thể cho tuần sau.",
        "evidence": progress_metrics,
        "week_start": progress_metrics.get("week_start"),
        "week_end": progress_metrics.get("week_end"),
        "effective_week_start": progress_metrics.get("effective_week_start"),
    }
    json_match = re.search(r"```json\s*([\s\S]*?)```", response_text)
    if json_match:
        try:
            parsed = json.loads(json_match.group(1))
            if isinstance(parsed, dict):
                ai_fields = ("effective", "deviation_cause", "adjustment", "evidence")
                reflection_draft.update(
                    {key: parsed.get(key, reflection_draft[key]) for key in ai_fields}
                )
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    clean_response = re.sub(r"```json[\s\S]*?```", "", response_text).strip() or response_text
    pending = build_pending_action("reflect", "confirm_adjustment", reflection_draft)

    return {
        "current_node": "reflect",
        "response": clean_response + "\n\nHãy xác nhận trước khi áp dụng điều chỉnh cho tuần sau.",
        "analysis": "Reflection Agent đã tổng kết dựa trên dữ kiện khách quan và đưa ra 1 gợi ý điều chỉnh.",
        "reflection_draft": reflection_draft,
        "pending_action": pending,
        "status": "awaiting_student",
    }
