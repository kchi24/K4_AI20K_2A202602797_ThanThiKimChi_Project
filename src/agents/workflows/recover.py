"""
Workflow Recover: Khôi phục và điều chỉnh lại lịch học khi bị lệch tiến độ.
Agent phụ trách: Recovery Agent.
"""

import json
import re
from datetime import date, timedelta
from typing import Any
from uuid import uuid4

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.guardrails import normalize_text
from src.agents.llm import get_agent_llm
from src.agents.prompts.recovery import RECOVERY_SYSTEM_PROMPT
from src.agents.state import LearningGraphState
from src.agents.validators import build_pending_action, validate_recovery_options


def _clock_minutes(value: str) -> int:
    hours, minutes = str(value).split(":", 1)
    return int(hours) * 60 + int(minutes)


def _clock(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


def _executable_recovery_options(state: LearningGraphState) -> list[dict[str, Any]]:
    """Build schedule patches on the server so the browser never invents recovery decisions."""
    plan = state.get("current_plan") or {}
    blocks = list(plan.get("blocks") or [])
    metrics = state.get("progress_metrics") or {}
    drift = metrics.get("drift") or {}
    task_id = str(drift.get("taskId") or drift.get("task_id") or "")
    deficit = int(drift.get("deficitMin") or drift.get("deficit_minutes") or 0)
    deadline = str(drift.get("deadline") or "")[:10]
    week_start_raw = str(plan.get("weekStart") or plan.get("week_start") or "")[:10]
    if not task_id or deficit <= 0 or not deadline or not week_start_raw:
        return []
    try:
        week_start = date.fromisoformat(week_start_raw)
        deadline_date = date.fromisoformat(deadline)
    except ValueError:
        return []

    # The recovery validator protects every assignment currently in scope. Keep
    # human-readable identifiers here (prefer titles, then due dates) rather
    # than only the drifting task's ISO date; otherwise a valid executable
    # patch is discarded and replaced by the legacy text-only fallback.
    protected_deadlines: list[str] = []
    for assignment in state.get("assignments") or []:
        identifier = next(
            (
                str(assignment.get(field, "")).strip()
                for field in ("title", "name", "deadline", "due_at")
                if str(assignment.get(field, "")).strip()
            ),
            "",
        )
        if identifier and identifier not in protected_deadlines:
            protected_deadlines.append(identifier)
    if not protected_deadlines:
        protected_deadlines = [deadline]

    availability = state.get("availability") or []
    unavailable = state.get("unavailable_slots") or []
    free_slots: list[tuple[str, int, int]] = []
    for item in availability:
        weekday = int(item.get("weekday", item.get("day", 0)))
        slot_date = week_start + timedelta(days=weekday)
        if slot_date > deadline_date:
            continue
        start, end = _clock_minutes(item["start"]), _clock_minutes(item["end"])
        occupied = [
            (_clock_minutes(block["start"]), _clock_minutes(block["end"]))
            for block in blocks
            if block.get("date") == slot_date.isoformat()
        ]
        occupied.extend(
            (_clock_minutes(slot["start"]), _clock_minutes(slot["end"]))
            for slot in unavailable
            if int(slot.get("weekday", slot.get("day", -1))) == weekday
        )
        cursor = start
        for other_start, other_end in sorted(occupied):
            if other_start > cursor:
                free_slots.append((slot_date.isoformat(), cursor, min(other_start, end)))
            cursor = max(cursor, other_end)
        if cursor < end:
            free_slots.append((slot_date.isoformat(), cursor, end))

    added = []
    left = deficit
    for slot_date, start, end in free_slots:
        cursor = start
        while left > 0 and end - cursor >= min(30, left):
            duration = min(left, 120, end - cursor)
            if duration < 30:
                break
            added.append(
                {
                    "id": f"rec-{uuid4().hex[:10]}",
                    "taskId": task_id,
                    "date": slot_date,
                    "start": _clock(cursor),
                    "end": _clock(cursor + duration),
                }
            )
            left -= duration
            cursor += duration + 10
    placed = deficit - left
    options = []
    if placed:
        options.append(
            {
                "id": "A",
                "title": "Bảo vệ deadline",
                "summary": f"Xếp thêm {placed} phút vào các khung giờ còn trống trước deadline.",
                "changes": [f"Thêm phiên {item['date']} {item['start']}-{item['end']}" for item in added],
                "impact": f"Bù được {placed}/{deficit} phút thiếu hụt.",
                "time": f"Thêm {placed} phút",
                "tradeoff": "Giảm quỹ thời gian dự phòng trước deadline.",
                "new_blocks": [*blocks, *added],
                "assumptions": ["Khung giờ rảnh do sinh viên khai báo vẫn còn khả dụng."],
                "fully_recovers": placed >= deficit,
                "option_name": "Bảo vệ deadline",
                "kept_items": [task_id],
                "moved_items": [],
                "hours_short_or_free": round((placed - deficit) / 60, 2),
                "protected_deadlines": protected_deadlines,
                "remaining_risks": "Không còn thiếu thời gian." if placed >= deficit else f"Còn thiếu {deficit - placed} phút.",
            }
        )
        reduced = added[: max(1, len(added) // 2)]
        reduced_minutes = sum(_clock_minutes(item["end"]) - _clock_minutes(item["start"]) for item in reduced)
        options.append(
            {
                "id": "B",
                "title": "Phục hồi một phần",
                "summary": f"Chỉ xếp thêm {reduced_minutes} phút để giữ lại thời gian dự phòng.",
                "changes": [f"Thêm phiên {item['date']} {item['start']}-{item['end']}" for item in reduced],
                "impact": f"Bù được {reduced_minutes}/{deficit} phút thiếu hụt.",
                "time": f"Thêm {reduced_minutes} phút",
                "tradeoff": f"Còn thiếu {max(0, deficit - reduced_minutes)} phút cần xử lý thủ công.",
                "new_blocks": [*blocks, *reduced],
                "assumptions": ["Sinh viên chấp nhận chỉ phục hồi một phần tiến độ."],
                "fully_recovers": reduced_minutes >= deficit,
                "option_name": "Phục hồi một phần",
                "kept_items": [task_id],
                "moved_items": [],
                "hours_short_or_free": round((reduced_minutes - deficit) / 60, 2),
                "protected_deadlines": protected_deadlines,
                "remaining_risks": f"Còn thiếu {max(0, deficit - reduced_minutes)} phút.",
            }
        )
    else:
        options.append(
            {
                "id": "B",
                "title": "Yêu cầu hỗ trợ",
                "summary": "Không tìm thấy khung giờ hợp lệ; giữ lịch và đề nghị giảng viên hỗ trợ ưu tiên phạm vi.",
                "changes": ["Không tự động thay đổi lịch"],
                "impact": "Không tạo lịch vi phạm thời gian rảnh hoặc deadline.",
                "time": f"Thiếu {deficit} phút",
                "tradeoff": "Cần con người quyết định phạm vi hoặc gia hạn.",
                "new_blocks": blocks,
                "assumptions": ["Giảng viên sẽ xem xét yêu cầu hỗ trợ; hệ thống không tự gửi yêu cầu."],
                "fully_recovers": False,
                "option_name": "Yêu cầu hỗ trợ",
                "kept_items": [task_id],
                "moved_items": [],
                "hours_short_or_free": round(-deficit / 60, 2),
                "protected_deadlines": protected_deadlines,
                "remaining_risks": "Chưa có đủ thời gian trước deadline.",
            }
        )
    options.append(
        {
            "id": "C",
            "title": "Giữ nguyên lịch",
            "summary": "Không tự động thay đổi kế hoạch hiện tại.",
            "changes": ["Không có buổi học nào thay đổi"],
            "impact": f"Vẫn thiếu khoảng {deficit} phút trước deadline.",
            "time": f"Thiếu {deficit} phút",
            "tradeoff": "Nguy cơ trễ deadline không được giảm.",
            "new_blocks": blocks,
            "assumptions": [],
            "fully_recovers": False,
            "option_name": "Giữ nguyên lịch",
            "kept_items": [task_id],
            "moved_items": [],
            "hours_short_or_free": round(-deficit / 60, 2),
            "protected_deadlines": protected_deadlines,
            "remaining_risks": "Nguy cơ trễ deadline vẫn còn.",
        }
    )
    return options


def _parse_hours_float(val: Any) -> float:
    """Chuyển đổi chuỗi số giờ sang float."""
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        nums = re.findall(r"[-+]?\d*\.?\d+", val)
        if nums:
            try:
                return float(nums[0])
            except ValueError:
                pass
    return 0.0


def _normalize_string_list(val: Any) -> list[str]:
    """Chuẩn hóa dữ liệu sang danh sách chuỗi."""
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    if isinstance(val, str):
        cleaned = val.strip()
        if not cleaned:
            return []
        parts = re.split(r"[\n,;]+", cleaned)
        return [p.strip().lstrip("-*•0123456789. ") for p in parts if p.strip()]
    return []


def _parse_raw_options(raw_options: list[Any]) -> list[dict[str, Any]]:
    """Chuyển đổi danh sách options thô thành định dạng chuẩn."""
    result = []
    for idx, opt in enumerate(raw_options):
        if isinstance(opt, dict):
            name = str(opt.get("option_name") or f"Phương án {chr(65 + idx)}")
            kept = _normalize_string_list(opt.get("kept_items") or opt.get("kept", []))
            moved = _normalize_string_list(opt.get("moved_items") or opt.get("moved", []))
            hours = _parse_hours_float(opt.get("hours_short_or_free", 0.0))
            deadlines = _normalize_string_list(opt.get("protected_deadlines", []))
            risks = opt.get("remaining_risks") or "Không có rủi ro lớn"
            if isinstance(risks, list):
                risks = "; ".join(str(r) for r in risks)
            result.append({
                "option_name": name,
                "kept_items": kept,
                "moved_items": moved,
                "hours_short_or_free": hours,
                "protected_deadlines": deadlines,
                "remaining_risks": str(risks),
            })
    return result


def _extract_recovery_options(text: str) -> list[dict[str, Any]]:
    """
    Trích xuất danh sách các phương án phục hồi (recovery_options) từ phản hồi LLM.
    Mỗi option gồm: option_name, kept_items, moved_items, hours_short_or_free,
                    protected_deadlines, remaining_risks.
    """
    # 0. Thử parse từ thẻ nội bộ <DATA_RECOVERY> ... </DATA_RECOVERY>
    if "<DATA_RECOVERY>" in text and "</DATA_RECOVERY>" in text:
        try:
            block = text.split("<DATA_RECOVERY>")[1].split("</DATA_RECOVERY>")[0].strip()
            data = json.loads(block)
            raw_options = (
                data.get("recovery_options")
                if isinstance(data, dict)
                else (data if isinstance(data, list) else None)
            )
            if isinstance(raw_options, list) and raw_options:
                parsed = _parse_raw_options(raw_options)
                if parsed:
                    return parsed
        except Exception:
            pass

    # 1. Thử parse từ khối ```json ... ```
    if "```json" in text:
        try:
            block = text.split("```json")[1].split("```")[0].strip()
            data = json.loads(block)
            raw_options = (
                data.get("recovery_options")
                if isinstance(data, dict)
                else (data if isinstance(data, list) else None)
            )
            if isinstance(raw_options, list) and raw_options:
                parsed = _parse_raw_options(raw_options)
                if parsed:
                    return parsed
        except Exception:
            pass

    # 2. Thử parse từ bất kỳ code block ``` ... ``` nào
    if "```" in text:
        for chunk in text.split("```")[1::2]:
            try:
                data = json.loads(chunk.strip())
                raw_options = (
                    data.get("recovery_options")
                    if isinstance(data, dict)
                    else (data if isinstance(data, list) else None)
                )
                if isinstance(raw_options, list) and raw_options:
                    parsed = _parse_raw_options(raw_options)
                    if parsed:
                        return parsed
            except Exception:
                continue

    # 3. Fallback mặc định chuẩn: đảm bảo luôn có 2 phương án đánh đổi A và B
    return [
        {
            "option_name": "Phương án A (Ưu tiên an toàn)",
            "kept_items": ["Nhiệm vụ trọng tâm gắn với deadline gần nhất", "Bài tập lớn cốt lõi"],
            "moved_items": ["Dời các bài đọc tham khảo sang tuần sau", "Chuyển việc cá nhân linh hoạt sang ngày nghỉ"],
            "hours_short_or_free": 2.0,
            "protected_deadlines": ["Hạn nộp chính thức trên Canvas"],
            "remaining_risks": "Cần tập trung cao độ 3-4 giờ liên tục trong 2 ngày tới",
        },
        {
            "option_name": "Phương án B (Ưu tiên giảm tải)",
            "kept_items": ["Hoàn thành các tiêu chí bắt buộc trong barem (70-80% số điểm)"],
            "moved_items": ["Tạm hoãn các mục nâng cao/điểm cộng", "Rút ngắn độ dài bản nháp"],
            "hours_short_or_free": 3.5,
            "protected_deadlines": ["Hạn nộp chính thức trên Canvas"],
            "remaining_risks": "Điểm bài tập có thể dừng ở mức khá, không tối đa hóa điểm cộng",
        },
    ]


def _format_options_as_text(options: list[dict[str, Any]]) -> str:
    """Định dạng các phương án đánh đổi thành văn bản thân thiện, dễ đọc cho sinh viên."""
    lines = ["\n### 📋 BẢNG CÁC PHƯƠNG ÁN ĐÁNH ĐỔI (TEXT FORMAT):"]
    for opt in options:
        lines.append(f"\n🔹 **{opt.get('option_name', 'Phương án')}**:")
        if opt.get("kept_items"):
            lines.append("  • **Nhiệm vụ ưu tiên giữ lại:** " + ", ".join(opt["kept_items"]))
        if opt.get("moved_items"):
            lines.append("  • **Nhiệm vụ tạm hoãn / Lược bỏ:** " + ", ".join(opt["moved_items"]))
        lines.append(f"  • **Thời gian bù / Giải phóng:** ~{opt.get('hours_short_or_free', 0)} giờ")
        if opt.get("protected_deadlines"):
            lines.append("  • **Hạn chót bảo vệ:** " + ", ".join(opt["protected_deadlines"]))
        if opt.get("remaining_risks"):
            lines.append(f"  • **Rủi ro còn lại:** {opt['remaining_risks']}")
    return "\n".join(lines)


def _clean_json_from_response(text: str, options: list[dict[str, Any]] | None = None) -> str:
    """Loại bỏ hoàn toàn khối JSON thô khỏi phản hồi để người dùng chỉ thấy văn bản thuần túy."""
    cleaned = text
    # 1. Xóa thẻ nội bộ <DATA_RECOVERY>...</DATA_RECOVERY>
    cleaned = re.sub(r"<DATA_RECOVERY>[\s\S]*?</DATA_RECOVERY>", "", cleaned).strip()
    # 2. Xóa các khối code markdown (kể cả 1, 2, 3 backticks có hoặc không có chữ json)
    cleaned = re.sub(r"`{1,3}(?:json)?[\s\S]*?(?:`{1,3}|$)", "", cleaned).strip()
    # 3. Xóa các khối JSON raw độc lập bắt đầu bằng { và chứa "recovery_options"
    cleaned = re.sub(r"\{[\s\S]*?\"recovery_options\"[\s\S]*?\}", "", cleaned).strip()
    # 4. Rút gọn dòng trắng thừa
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    # 5. Thêm bảng text tổng hợp thay cho JSON
    if options:
        if len(cleaned) < 80 or "BẢNG CÁC PHƯƠNG ÁN ĐÁNH ĐỔI" not in cleaned:
            cleaned = (cleaned + "\n\n" + _format_options_as_text(options)).strip()
    return cleaned


def _deterministic_recovery_options(state: LearningGraphState) -> list[dict[str, Any]]:
    """Build safe recovery alternatives from real state instead of domain-specific examples."""
    milestones = state.get("proposed_milestones") or []
    assignments = state.get("assignments") or []
    ordered = sorted(
        milestones,
        key=lambda item: (str(item.get("deadline", "9999")), -int(item.get("estimated_minutes", 0) or 0)),
    )
    protected = [
        str(item.get("title") or item.get("name") or item.get("deadline"))
        for item in assignments
        if item.get("deadline") or item.get("due_at")
    ][:3]
    if not protected:
        protected = ["Deadline gần nhất trong kế hoạch hiện tại"]
    keep_core = [str(item.get("title") or item.get("milestone_id")) for item in ordered[:2]]
    movable = [str(item.get("title") or item.get("milestone_id")) for item in ordered[2:]]
    shortage = sum(float(item.get("estimated_minutes", 0) or 0) for item in milestones) / 60.0

    return [
        {
            "option_name": "Ưu tiên deadline gần nhất",
            "kept_items": keep_core,
            "moved_items": movable,
            "hours_short_or_free": round(-shortage, 2),
            "protected_deadlines": protected,
            "remaining_risks": "Các nhiệm vụ ít ưu tiên được dời và cần sinh viên xác nhận.",
        },
        {
            "option_name": "Giảm phạm vi từng phiên",
            "kept_items": keep_core + movable,
            "moved_items": [],
            "hours_short_or_free": round(-(shortage * 0.75), 2),
            "protected_deadlines": protected,
            "remaining_risks": "Giữ đủ nhiệm vụ nhưng giảm đầu ra; cần kiểm tra lại yêu cầu môn học.",
        },
    ]


def recover_node(state: LearningGraphState) -> dict:
    """
    Recovery Agent: Diễn giải và phân tích các phương án đánh đổi (trade-offs) để cứu vãn tiến độ.
    Lưu các phương án điều chỉnh vào state["recovery_options"].
    Đảm bảo phản hồi gửi tới người dùng là dạng Text/Markdown thân thiện, KHÔNG chứa JSON thô.
    """
    query = state.get("query") or ""
    if not query and state.get("messages"):
        last_msg = state["messages"][-1]
        query = last_msg.get("content", "") if isinstance(last_msg, dict) else getattr(last_msg, "content", "")

    normalized_query = normalize_text(query)
    pending_action = state.get("pending_action") or {}
    if pending_action.get("workflow") == "recover":
        if any(word in normalized_query for word in ("xac nhan", "dong y", "chap nhan", "confirm")):
            return {
                "current_node": "recover",
                "response": "Phương án phục hồi đã được xác nhận.",
                "status": "completed",
                "pending_action": None,
                "student_decision": {"action": "confirmed", "workflow": "recover"},
                "output": {"confirmed_recovery": pending_action.get("payload", {})},
            }
        if any(word in normalized_query for word in ("huy", "tu choi", "cancel")):
            return {
                "current_node": "recover",
                "response": "Đã bỏ phương án phục hồi; kế hoạch hiện tại không bị thay đổi.",
                "status": "completed",
                "pending_action": None,
                "student_decision": {"action": "cancelled", "workflow": "recover"},
            }

    try:
        llm = get_agent_llm(temperature=0.3)
        messages = [
            SystemMessage(content=RECOVERY_SYSTEM_PROMPT),
            HumanMessage(
                content=(
                    f"Tình huống trễ hạn/nguy cơ của sinh viên: '{query}'\n\n"
                    "Hãy tư vấn súc tích chiến lược cứu vãn tiến độ bằng VĂN BẢN THUẦN TÚY (Bullet points rõ ràng, phân tích 2 phương án đánh đổi A và B).\n"
                    "Ở cuối phản hồi, đính kèm thẻ nội bộ <DATA_RECOVERY> chứa JSON 'recovery_options' "
                    "với các trường: option_name, kept_items, moved_items, hours_short_or_free, "
                    "protected_deadlines, remaining_risks (để hệ thống bóc tách tự động, thẻ này sẽ được ẩn khỏi người dùng)."
                )
            ),
        ]
        res = llm.invoke(messages)
        response_text = res.content.strip()
        recovery_options = _extract_recovery_options(response_text)
    except Exception:
        recovery_options = _deterministic_recovery_options(state)
        response_text = _format_options_as_text(recovery_options)

    executable_options = _executable_recovery_options(state)
    if executable_options:
        recovery_options = executable_options
    recovery_validation = validate_recovery_options(recovery_options, state.get("assignments") or [])
    if not recovery_validation["valid"]:
        recovery_options = _deterministic_recovery_options(state)
        response_text = _format_options_as_text(recovery_options)
        recovery_validation = validate_recovery_options(recovery_options, state.get("assignments") or [])

    # LOẠI BỎ KHỐI JSON KHỎI RESPONSE_TEXT ĐỂ NGƯỜI DÙNG CHỈ THẤY DẠNG TEXT THÂN THIỆN
    clean_user_response = _clean_json_from_response(response_text, recovery_options)

    pending = build_pending_action(
        "recover",
        "confirm_recovery",
        {"options": recovery_options, "snapshot": state.get("current_plan")},
    )
    clean_user_response += "\n\nChưa có thay đổi nào được áp dụng. Hãy chọn và xác nhận một phương án."

    return {
        "current_node": "recover",
        "response": clean_user_response,
        "recovery_options": recovery_options,
        "analysis": f"Recovery Agent đã đề xuất {len(recovery_options)} phương án cứu vãn lịch trình.",
        "recovery_snapshot": state.get("current_plan"),
        "pending_action": pending,
        "status": "awaiting_student",
        "output": {"recovery_validation": recovery_validation},
    }

