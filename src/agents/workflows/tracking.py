"""
Workflow Tracking: Theo dõi tiến độ học tập và phát hiện nguy cơ trễ hạn.
Sử dụng các Tool tính toán định lượng (không cần LLM agent riêng).
"""

from src.agents.state import LearningGraphState
from src.agents.tools.schedule_calculator import (
    calculate_available_hours,
    check_deadline_slack,
)


def tracking_node(state: LearningGraphState) -> dict:
    """
    Tính sai số thời gian thực tế, slack time và cập nhật nguy cơ.
    """
    availability = state.get("availability") or []
    unavailable_slots = state.get("unavailable_slots") or []
    assignments = state.get("assignments") or []

    available_hours = calculate_available_hours(availability, unavailable_slots)

    risk_signals = []
    slack_results = []
    for assign in assignments:
        dl = assign.get("deadline") or assign.get("due_at")
        est = assign.get("estimated_hours") or assign.get("expected_hours") or 5.0
        if dl:
            slack_info = check_deadline_slack(dl, est)
            slack_results.append(slack_info)
            if slack_info["is_at_risk"]:
                risk_signals.append({
                    "assignment_id": assign.get("id"),
                    "title": assign.get("title", "Bài tập"),
                    "risk_level": slack_info["risk_level"],
                    "slack_hours": slack_info["slack_hours"],
                    "message": slack_info["message"],
                })

    progress_metrics = {
        "available_hours_remaining": available_hours,
        "active_assignments_count": len(assignments),
        "slack_evaluations": slack_results,
    }

    if risk_signals:
        summary_resp = (
            f"[Cảnh báo tiến độ Tracking] Phát hiện {len(risk_signals)} bài tập có nguy cơ trễ hạn! "
            f"Quỹ thời gian rảnh còn lại: {available_hours:.1f} giờ."
        )
    else:
        summary_resp = (
            f"[Tracking System] Tiến độ an toàn. Quỹ thời gian rảnh khả dụng: {available_hours:.1f} giờ."
        )

    return {
        "current_node": "tracking",
        "progress_metrics": progress_metrics,
        "risk_signals": risk_signals,
        "response": summary_resp,
        "analysis": f"Tracking Tool đã tính toán slack và quỹ thời gian ({available_hours:.1f}h).",
    }

