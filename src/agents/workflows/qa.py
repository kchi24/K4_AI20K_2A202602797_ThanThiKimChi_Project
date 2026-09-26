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
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.llm import get_agent_llm
from src.agents.prompts.study_support import STUDY_SUPPORT_SYSTEM_PROMPT
from src.agents.state import LearningGraphState
from src.agents.tools.qdrant_retriever import (
    record_disputed_evidence,
    search_course_materials,
)


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
    query_lower = query.lower()
    return any(kw in query_lower for kw in ACADEMIC_CHEATING_KEYWORDS)


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
    is_cheating = _detect_cheating_intent(query)

    # 3. Task 2.2: Truy xuất tài liệu học tập từ Qdrant Vector Store
    rag_result = search_course_materials(query=query, top_k=3, score_threshold=0.35)
    passages = rag_result.get("passages", [])
    is_insufficient = rag_result.get("insufficient_sources", False)

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
    except Exception as e:
        llm = None
        error_msg = str(e)

    # 4. Phân luồng 3 chế độ phản hồi
    if is_cheating:
        # Chế độ 2: guided_help
        user_prompt = (
            f"Sinh viên đang yêu cầu làm bài tập hộ hoặc hỏi đáp án để nộp: '{query}'.\n\n"
            f"QUY TẮC BẮT BUỘC:\n"
            f"- KHÔNG đưa ra đáp án trực tiếp / code hoàn chỉnh để nộp bài.\n"
            f"- Áp dụng phương pháp Socratic, hướng dẫn phương pháp giải từng bước thông qua một ví dụ tương tự.\n"
            f"- Khuyến khích sinh viên tự làm bước đầu tiên và gửi lại để nhận xét."
        )
        analysis_mode = "guided_help (Academic Integrity Triggered)"

    elif is_insufficient:
        # Chế độ 3: insufficient_sources
        user_prompt = (
            f"Thắc mắc của sinh viên: '{query}'.\n\n"
            f"HỆ THỐNG THÔNG BÁO:\n"
            f"Kho tài liệu học liệu môn học hiện tại không tìm thấy văn bản phù hợp hoặc độ tương đồng quá thấp (điểm cao nhất: {rag_result.get('top_score', 0.0)} < ngưỡng 0.35).\n"
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
        except Exception as e:
            response_text = f"[Lỗi kết nối Study Support Agent]: {e}"
    else:
        response_text = f"[Lỗi cấu hình LLM]: {error_msg}"

    return {
        "current_node": "qa",
        "response": response_text,
        "analysis": f"Study Support Agent phản hồi ở chế độ: {analysis_mode}",
        "retrieved_passages": passages,
        "source_refs": source_refs,
        "disputed_evidence": state.get("disputed_evidence", []),
        "audit_events": state.get("audit_events", []),
    }
