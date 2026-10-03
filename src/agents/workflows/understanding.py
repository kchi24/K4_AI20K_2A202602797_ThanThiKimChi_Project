"""
Workflow Understanding: Đánh giá mức độ thấu hiểu bài học của sinh viên theo Rubric.
Agent phụ trách: Understanding Agent.
"""

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.llm import get_agent_llm
from src.agents.prompts.understanding import UNDERSTANDING_SYSTEM_PROMPT
from src.agents.state import LearningGraphState
from src.agents.tools.rubric_evaluator import evaluate_closed_question, parse_approved_rubric
from src.agents.validators import build_pending_action, validate_assessment_result

VALID_STATUSES = {
    "chưa đủ bằng chứng",
    "còn nhầm lẫn",
    "đang hình thành",
    "đã thể hiện được",
}


def _normalize_status(val: str) -> str:
    """Chuẩn hóa trạng thái về đúng 1 trong 4 trạng thái định danh chuẩn."""
    text = (val or "").strip().lower()
    if "đã thể hiện" in text:
        return "đã thể hiện được"
    if "đang hình thành" in text:
        return "đang hình thành"
    if "nhầm lẫn" in text or "con nham lan" in text:
        return "còn nhầm lẫn"
    return "chưa đủ bằng chứng"


def _normalize_confidence(val: str) -> str:
    """Chuẩn hóa độ tin cậy về Cao / Trung bình / Thấp."""
    text = (val or "").strip().lower()
    if "cao" in text or "high" in text:
        return "Cao"
    if "thấp" in text or "thap" in text or "low" in text:
        return "Thấp"
    return "Trung bình"


def _extract_assessment_result(text: str, student_answer: str) -> dict[str, Any]:
    """
    Trích xuất kết quả đánh giá có cấu trúc gồm: status, confidence, evidence_quotes.
    """
    # 1. Thử parse từ khối ```json ... ```
    if "```json" in text:
        try:
            block = text.split("```json")[1].split("```")[0].strip()
            data = json.loads(block)
            if isinstance(data, dict):
                status = _normalize_status(str(data.get("status", "")))
                confidence = _normalize_confidence(str(data.get("confidence", "Trung bình")))
                quotes = data.get("evidence_quotes") or []
                if isinstance(quotes, str):
                    quotes = [quotes]
                cleaned_quotes = [str(q).strip() for q in quotes if str(q).strip()]
                return {
                    "status": status,
                    "confidence": confidence,
                    "evidence_quotes": cleaned_quotes,
                }
        except Exception:
            pass

    # 2. Thử parse từ các khối ``` chung
    if "```" in text:
        for chunk in text.split("```")[1::2]:
            try:
                data = json.loads(chunk.strip())
                if isinstance(data, dict) and ("status" in data or "evidence_quotes" in data):
                    return {
                        "status": _normalize_status(str(data.get("status", ""))),
                        "confidence": _normalize_confidence(str(data.get("confidence", "Trung bình"))),
                        "evidence_quotes": [
                            str(q).strip() for q in data.get("evidence_quotes", []) if str(q).strip()
                        ],
                    }
            except Exception:
                continue

    # 3. Fallback phân tích văn bản tự nhiên (Regex & Heuristic)
    text_lower = text.lower()
    status = "chưa đủ bằng chứng"
    for st in ["đã thể hiện được", "đang hình thành", "còn nhầm lẫn", "chưa đủ bằng chứng"]:
        if st in text_lower:
            status = st
            break

    confidence = "Trung bình"
    if "độ tin cậy: cao" in text_lower or "tin cậy: cao" in text_lower or "**cao**" in text_lower:
        confidence = "Cao"
    elif "độ tin cậy: thấp" in text_lower or "tin cậy: thấp" in text_lower:
        confidence = "Thấp"

    # Trích xuất các câu trích dẫn trong ngoặc kép
    raw_quotes = re.findall(r'["“]([^"”]{5,})["”]', text)
    evidence_quotes = [q.strip() for q in raw_quotes if len(q.strip()) > 5][:5]

    # Nếu không có trích dẫn từ bài trả lời nhưng có student_answer, trích đoạn ngắn làm bằng chứng
    if not evidence_quotes and student_answer and len(student_answer.strip()) > 10:
        evidence_quotes = [student_answer.strip()[:100]]

    return {
        "status": status,
        "confidence": confidence,
        "evidence_quotes": evidence_quotes,
    }


def understanding_node(state: LearningGraphState) -> dict:
    """
    Understanding Agent: Phân tích câu trả lời mở qua 4 khía cạnh theo rubric.
    Bóc tách kết quả đánh giá lưu vào state["assessment_result"].
    """
    query = state.get("query") or ""
    if not query and state.get("messages"):
        last_msg = state["messages"][-1]
        query = last_msg.get("content", "") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")

    request = state.get("request") or {}
    approved_rubric = parse_approved_rubric(state.get("approved_rubric"))
    if request.get("question_type") == "closed" and request.get("correct_answer") is not None:
        closed_result = evaluate_closed_question(query, str(request["correct_answer"]))
        status = "đã thể hiện được" if closed_result["is_correct"] else "còn nhầm lẫn"
        assessment_result = {
            "status": status,
            "confidence": "Cao",
            "evidence_quotes": [query],
            "dimensions": {"concept": status},
            "closed_question": closed_result,
        }
        return {
            "current_node": "understanding",
            "response": closed_result["feedback"],
            "assessment_result": assessment_result,
            "analysis": "Câu đóng được chấm bằng quy tắc xác định trước.",
            "status": "completed",
        }

    rubric_context = json.dumps(approved_rubric, ensure_ascii=False, indent=2)
    learner_context = json.dumps(
        {
            "mastery": state.get("mastery_profile") or {},
            "known_misconceptions": state.get("misconceptions") or [],
        },
        ensure_ascii=False,
    )
    try:
        llm = get_agent_llm(temperature=0.2)
        messages = [
            SystemMessage(content=UNDERSTANDING_SYSTEM_PROMPT),
            HumanMessage(
                content=(
                    f"Câu trả lời/nội dung sinh viên nộp để kiểm tra mức hiểu: '{query}'\n\n"
                    f"RUBRIC ĐÃ ĐƯỢC DUYỆT:\n{rubric_context}\n\n"
                    f"HỒ SƠ HỌC TẬP DÀI HẠN (không thay thế bằng chứng hiện tại):\n{learner_context}\n\n"
                    "Hãy đánh giá chi tiết theo 4 khía cạnh rubric và đính kèm khối JSON ```json ở cuối bài "
                    "với các trường: status, confidence, evidence_quotes."
                )
            ),
        ]
        res = llm.invoke(messages)
        response_text = res.content.strip()
    except Exception:
        response_text = "Mình chưa đủ dữ kiện để đánh giá lúc này; kết quả sẽ được chuyển cho giảng viên xem lại."

    assessment_result = _extract_assessment_result(response_text, student_answer=query)
    assessment_result["rubric_criteria"] = [item["criterion_id"] for item in approved_rubric]
    quality = validate_assessment_result(assessment_result, approved_rubric)

    # Loại bỏ khối JSON thô để sinh viên chỉ nhìn thấy nhận xét dạng text/markdown
    clean_response = re.sub(r"```json[\s\S]*?```", "", response_text).strip()
    if not clean_response:
        clean_response = response_text

    pending_action = None
    status = "completed"
    if quality["requires_instructor_review"]:
        pending_action = build_pending_action(
            "understanding",
            "instructor_review",
            {"assessment_result": assessment_result, "reasons": quality["reasons"]},
        )
        status = "awaiting_teacher"
        clean_response += "\n\nKết quả này chưa đủ điều kiện kết luận và đã được đưa vào hàng chờ giảng viên."

    return {
        "current_node": "understanding",
        "response": clean_response,
        "assessment_result": assessment_result,
        "analysis": (
            f"Đánh giá mức hiểu bài: '{assessment_result['status']}' "
            f"(Độ tin cậy: {assessment_result['confidence']}). Không ghi điểm số."
        ),
        "status": status,
        "pending_action": pending_action,
        "output": {"assessment_validation": quality},
    }

