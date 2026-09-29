"""
Workflow Q&A: Hỏi đáp kiến thức học tập dựa trên tài liệu học liệu và liêm chính học thuật.
Agent phụ trách: Study Support Agent.
Tích hợp:
- Truy xuất RAG từ Qdrant Vector Store (Task 2.1, 2.2).
- Trích dẫn học liệu chính xác [Tên tài liệu, Trang X, Đoạn Y].
- Phân định 3 chế độ: grounded_answer, guided_help, insufficient_sources.
- Xử lý khiếu nại trích dẫn và cờ disputed_evidence (Task 2.3).
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.guardrails import evaluate_guardrails
from src.agents.llm import get_agent_llm
from src.agents.prompts.study_support import STUDY_SUPPORT_SYSTEM_PROMPT
from src.agents.state import LearningGraphState
from src.agents.tools.qdrant_retriever import (
    record_disputed_evidence,
    search_course_materials,
)
from src.agents.validators import validate_citations


def _state_resource_passages(
    state: LearningGraphState,
    query: str,
    top_k: int = 3,
) -> list[dict[str, Any]]:
    """Search LMS-scoped content already authorized and loaded by the backend."""
    query_terms = Counter(re.findall(r"\w+", query.casefold()))
    ranked: list[tuple[int, dict[str, Any]]] = []
    course_code = str(state.get("course_code") or state.get("course_id") or "")
    for index, item in enumerate(state.get("learning_resources") or []):
        if str(item.get("course_code") or "") != course_code:
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        content_terms = Counter(re.findall(r"\w+", content.casefold()))
        overlap = sum((query_terms & content_terms).values())
        ranked.append(
            (
                overlap,
                {
                    "citation": item["citation"],
                    "content": content,
                    "document_title": item["document_title"],
                    "course_code": course_code,
                    "page": int(item.get("page", 1)),
                    "paragraph": int(item.get("paragraph", index + 1)),
                    "score": round(min(0.95, 0.72 + overlap * 0.03), 4),
                },
            )
        )
    return [
        item
        for overlap, item in sorted(ranked, key=lambda row: row[0], reverse=True)[:top_k]
        if overlap
    ]

ACADEMIC_CHEATING_KEYWORDS = [
    "giải hộ",
    "giải giúp mình bài này",
    "làm hộ",
    "làm bài tập hộ",
    "cho mình đáp án",
    "cho em đáp án",
    "viết code hoàn chỉnh để nộp",
    "làm bài thi",
    "nộp lấy điểm",
    "giải bài tập để nộp",
    "đáp án câu",
]

DISPUTE_KEYWORDS = [
    "trích dẫn sai",
    "khiếu nại",
    "nhầm trang",
    "sai nguồn",
    "tài liệu lỗi thời",
    "dispute",
    "sai đoạn",
    "khiếu nại trích dẫn",
]


def _detect_cheating_intent(query: str) -> bool:
    """Kiểm tra xem sinh viên có đang yêu cầu giải hộ bài tập / thi cử để nộp điểm hay không."""
    return bool(evaluate_guardrails(query)["is_homework_cheat_attempt"])


def _detect_dispute_intent(query: str, request: dict[str, Any] | None = None) -> tuple[bool, str, str]:
    """
    Kiểm tra xem sinh viên có đang khiếu nại trích dẫn hay không.
    Trả về: (is_dispute, citation, reason)
    """
    if request and request.get("action") == "dispute_citation":
        return True, request.get("citation", ""), request.get("reason", "Khiếu nại qua API")

    query_lower = query.lower()
    is_dispute = any(kw in query_lower for kw in DISPUTE_KEYWORDS)
    if not is_dispute:
        return False, "", ""

    # Trích xuất citation từ query nếu có dạng [Tài liệu, Trang X, Đoạn Y]
    citation_match = re.search(r"\[([^\]]+)\]", query)
    citation = f"[{citation_match.group(1)}]" if citation_match else "[Trích dẫn được phản ánh trong câu hỏi]"
    reason = query

    return True, citation, reason


def qa_node(state: LearningGraphState) -> dict[str, Any]:
    """
    Study Support Agent Node:
    Thực thi truy xuất RAG học liệu, bảo vệ liêm chính học thuật và ghi nhận khiếu nại trích dẫn.
    """
    query = state.get("query") or ""
    if not query and state.get("messages"):
        last_msg = state["messages"][-1]
        query = last_msg.get("content", "") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")

    guardrail = state.get("security_flags") or evaluate_guardrails(query)
    if guardrail.get("is_injection_attempt"):
        return {
            "current_node": "qa",
            "response": "Mình không thể làm theo chỉ dẫn nhằm thay đổi quy tắc hệ thống hoặc tiết lộ thông tin nội bộ. Bạn có thể đặt câu hỏi về nội dung môn học.",
            "analysis": "blocked_prompt_injection",
            "security_flags": guardrail,
            "retrieved_passages": [],
            "source_refs": [],
        }

    # 1. Task 2.3: Xử lý khiếu nại trích dẫn (Disputed Evidence)
    is_dispute, disputed_citation, dispute_reason = _detect_dispute_intent(query, state.get("request"))
    if is_dispute:
        dispute_res = record_disputed_evidence(
            state=state,
            citation=disputed_citation,
            reason=dispute_reason,
            student_note=query,
        )
        response_text = (
            f"### 📋 TIẾP NHẬN PHẢN HỒI KHIẾU NẠI TRÍCH DẪN\n\n"
            f"Chào bạn, Study Support Agent đã ghi nhận ý kiến đóng góp của bạn về trích dẫn **{disputed_citation}**.\n\n"
            f"- **Mã khiếu nại:** `{dispute_res['dispute']['dispute_id']}`\n"
            f"- **Lý do phản ánh:** {dispute_reason}\n"
            f"- **Trạng thái:** Đã đánh dấu cờ `flagged_for_review` và chuyển thông tin tới Giảng viên phụ trách môn học để đối soát phiên bản giáo trình.\n\n"
            f"Trong thời gian này, mình sẽ tạm thời không sử dụng đoạn trích dẫn này làm căn cứ chính. Nếu bạn có câu hỏi học thuật khác, cứ gửi cho mình nhé!"
        )
        return {
            "current_node": "qa",
            "response": response_text,
            "analysis": f"Đã ghi nhận khiếu nại trích dẫn {disputed_citation} vào state['disputed_evidence'].",
            "disputed_evidence": state.get("disputed_evidence", []),
            "audit_events": state.get("audit_events", []),
        }

    # 2. Kiểm tra Liêm chính học thuật (Chế độ guided_help)
    is_cheating = bool(guardrail.get("is_homework_cheat_attempt"))
    if is_cheating:
        return {
            "current_node": "qa",
            "response": (
                "Mình không thể tạo đáp án hoặc bài hoàn chỉnh để nộp. "
                "Hãy gửi phần bạn đã thử và nói rõ bước đang vướng; mình sẽ kiểm tra lập luận, "
                "giải thích khái niệm liên quan và gợi ý bước tiếp theo bằng một ví dụ tương tự."
            ),
            "analysis": "guided_help (Academic Integrity Triggered)",
            "security_flags": guardrail,
            "retrieved_passages": [],
            "source_refs": [],
        }

    # 3. Task 2.2: Truy xuất tài liệu học tập từ Qdrant Vector Store
    request_context = state.get("request") or {}
    course_code = str(
        state.get("course_code") or state.get("course_id") or request_context.get("course_code") or ""
    ).strip()
    rag_result = search_course_materials(
        query=query,
        top_k=3,
        score_threshold=0.72,
        course_code=course_code or None,
        institution_id=str(state.get("institution_id") or "") or None,
        course_id=str(state.get("course_id") or "") or None,
    )
    passages = rag_result.get("passages", [])
    is_insufficient = rag_result.get("insufficient_sources", False)
    if is_insufficient:
        passages = _state_resource_passages(state, query)
        if passages:
            rag_result = {
                "passages": passages,
                "insufficient_sources": False,
                "top_score": passages[0]["score"],
            }
            is_insufficient = False

    source_refs = [
        {
            "citation": p["citation"],
            "document_title": p["document_title"],
            "course_code": p["course_code"],
            "page": p["page"],
            "paragraph": p["paragraph"],
            "score": p["score"],
        }
        for p in passages
    ]

    # Khởi tạo LLM
    try:
        llm = get_agent_llm(temperature=0.2)
    except Exception:
        llm = None

    # 4. Phân luồng 3 chế độ phản hồi
    if is_insufficient:
        # Chế độ 3: insufficient_sources
        user_prompt = (
            f"Thắc mắc của sinh viên: '{query}'.\n\n"
            f"HỆ THỐNG THÔNG BÁO:\n"
            f"Kho tài liệu học liệu môn học hiện tại không tìm thấy văn bản phù hợp hoặc độ tương đồng quá thấp (điểm cao nhất: {rag_result.get('top_score', 0.0)} < ngưỡng 0.72).\n"
            f"YÊU CẦU: Phản hồi theo chế độ 'insufficient_sources'. Trung thực thừa nhận kho học liệu môn học chưa đủ dữ kiện chứng minh 100%, gợi ý từ khóa học thuật cần tra cứu và khuyến khích sinh viên gặp giảng viên trong giờ Office Hour."
        )
        analysis_mode = "insufficient_sources (Low similarity or missing context)"

    else:
        # Chế độ 1: grounded_answer (Có tài liệu đối chứng)
        context_docs = "\n\n".join(
            [f"--- Đoạn trích dẫn: {p['citation']} ---\n{p['content']}" for p in passages]
        )
        user_prompt = (
            f"Thắc mắc của sinh viên: '{query}'\n\n"
            f"HỌC LIỆU ĐƯỢC TRUY XUẤT TỪ QDRANT VECTOR STORE:\n"
            f"{context_docs}\n\n"
            f"YÊU CẦU BẮT BUỘC:\n"
            f"1. Trả lời chính xác, súc tích và có chiều sâu học thuật dựa trên các đoạn học liệu trên.\n"
            f"2. BẮT BUỘC trích dẫn nguồn chuẩn xác theo định dạng: [Tên tài liệu, Trang X, Đoạn Y] ngay tại các luận điểm hoặc cuối câu trả lời.\n"
            f"3. Nếu có phân loại hay công thức, hãy trình bày rõ ràng, dễ hiểu."
        )
        analysis_mode = f"grounded_answer (Qdrant RAG: {len(passages)} passages, top score {rag_result.get('top_score', 0.0)})"

    # 5. Gọi LLM để sinh câu trả lời
    if llm:
        try:
            messages = [
                SystemMessage(content=STUDY_SUPPORT_SYSTEM_PROMPT),
                HumanMessage(content=user_prompt),
            ]
            res = llm.invoke(messages)
            response_text = res.content.strip()
        except Exception:
            response_text = "Mình chưa thể tạo câu trả lời lúc này. Hãy thử lại sau."
    else:
        response_text = "Mình chưa thể tạo câu trả lời lúc này. Hãy thử lại sau."

    citation_check = validate_citations(response_text, passages) if passages else {
        "valid": False,
        "citations": [],
        "valid_citations": [],
        "invalid_citations": [],
        "coverage": 0.0,
    }
    if passages and not citation_check["valid"]:
        response_text = "Mình chưa thể xác nhận câu trả lời sinh tự động. Các đoạn học liệu liên quan:\n\n" + "\n\n".join(
            f"- {passage['content'][:300]} {passage['citation']}" for passage in passages
        )
        citation_check = validate_citations(response_text, passages)

    return {
        "current_node": "qa",
        "response": response_text,
        "analysis": f"Study Support Agent phản hồi ở chế độ: {analysis_mode}",
        "retrieved_passages": passages,
        "source_refs": source_refs,
        "disputed_evidence": state.get("disputed_evidence", []),
        "audit_events": state.get("audit_events", []),
        "security_flags": guardrail,
        "output": {"citation_validation": citation_check},
    }
