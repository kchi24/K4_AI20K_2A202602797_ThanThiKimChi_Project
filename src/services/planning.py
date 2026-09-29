"""Deterministic, server-side study scheduling.

The LLM may propose milestones and explain trade-offs, but this module is the
single source of truth for positioned study blocks and feasibility numbers.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

MIN_SLOT_MINUTES = 30
MAX_BLOCK_MINUTES = 90
BREAK_MINUTES = 10


def _clock_to_minutes(value: str) -> int:
    hours, minutes = str(value).split(":", 1)
    return int(hours) * 60 + int(minutes)


def _minutes_to_clock(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


def _subtract(
    intervals: list[tuple[int, int]],
    blocked_start: int,
    blocked_end: int,
) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    for start, end in intervals:
        if blocked_end <= start or blocked_start >= end:
            result.append((start, end))
            continue
        if blocked_start > start:
            result.append((start, blocked_start))
        if blocked_end < end:
            result.append((blocked_end, end))
    return result


def _parse_deadline(value: Any, fallback: date) -> date:
    if not value:
        return fallback
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return fallback


def _ordered_intervals(
    intervals: list[tuple[int, int]],
    preferred: str,
) -> list[list[int]]:
    windows = {
        "morning": (0, 12 * 60),
        "afternoon": (12 * 60, 17 * 60),
        "evening": (17 * 60, 24 * 60),
    }
    preferred_start, preferred_end = windows.get(preferred, windows["evening"])
    parts: list[list[int]] = []
    for start, end in intervals:
        cursor = start
        for cut in (12 * 60, 17 * 60, end):
            if cursor < cut <= end:
                parts.append([cursor, cut])
                cursor = cut
    return sorted(
        parts,
        key=lambda item: (
            0 if preferred_start <= item[0] < preferred_end else 1,
            item[0],
        ),
    )


def _free_intervals(
    current: date,
    availability: list[dict[str, Any]],
    unavailable: list[dict[str, Any]],
    preferred: str,
) -> list[list[int]]:
    weekday = current.weekday()
    available = next(
        (item for item in availability if int(item.get("weekday", -1)) == weekday and item.get("enabled", True)),
        None,
    )
    if not available:
        return []
    try:
        intervals = [
            (
                _clock_to_minutes(str(available["start"])),
                _clock_to_minutes(str(available["end"])),
            )
        ]
    except (KeyError, TypeError, ValueError):
        return []
    if intervals[0][1] <= intervals[0][0]:
        return []
    for item in unavailable:
        if int(item.get("weekday", -1)) != weekday:
            continue
        try:
            intervals = _subtract(
                intervals,
                _clock_to_minutes(str(item["start"])),
                _clock_to_minutes(str(item["end"])),
            )
        except (KeyError, TypeError, ValueError):
            continue
    intervals = [item for item in intervals if item[1] - item[0] >= MIN_SLOT_MINUTES]
    return _ordered_intervals(intervals, preferred)


def build_plan_draft(
    plan_input: dict[str, Any],
    assignments: list[dict[str, Any]],
    *,
    timezone_name: str = "Asia/Ho_Chi_Minh",
    today: date | None = None,
) -> dict[str, Any]:
    """Create a canonical study plan using earliest-deadline-first scheduling."""
    current = today or datetime.now(ZoneInfo(timezone_name)).date()
    week_end = current + timedelta(days=6)
    assignments_by_id = {str(item.get("id")): item for item in assignments}
    selected: list[dict[str, Any]] = []
    for item in plan_input.get("tasks") or []:
        task_id = str(item.get("taskId") or "")
        assignment = assignments_by_id.get(task_id)
        remaining = max(0, int(item.get("remainingMin") or 0))
        if assignment and remaining:
            selected.append(
                {
                    "task_id": task_id,
                    "remaining": remaining,
                    "assignment": assignment,
                    "deadline": _parse_deadline(assignment.get("deadline"), week_end),
                }
            )
    selected.sort(key=lambda item: item["deadline"])

    availability = list(plan_input.get("availability") or [])
    unavailable = list(plan_input.get("unavailable") or [])
    preferred = str(plan_input.get("preferred") or "evening")
    free_by_day: dict[date, list[list[int]]] = {}
    for offset in range(7):
        day = current + timedelta(days=offset)
        free_by_day[day] = _free_intervals(day, availability, unavailable, preferred)

    available_minutes = sum(end - start for intervals in free_by_day.values() for start, end in intervals)
    blocks: list[dict[str, Any]] = []
    shortfalls: list[dict[str, Any]] = []
    for item in selected:
        remaining = item["remaining"]
        last_day = min(item["deadline"], week_end)
        day = current
        while day <= last_day and remaining > 0:
            for interval in free_by_day.get(day, []):
                while remaining > 0 and interval[1] - interval[0] >= min(MIN_SLOT_MINUTES, remaining):
                    duration = min(remaining, MAX_BLOCK_MINUTES, interval[1] - interval[0])
                    start = interval[0]
                    blocks.append(
                        {
                            "id": f"blk-{uuid4().hex[:12]}",
                            "taskId": item["task_id"],
                            "date": day.isoformat(),
                            "start": _minutes_to_clock(start),
                            "end": _minutes_to_clock(start + duration),
                        }
                    )
                    remaining -= duration
                    interval[0] = min(interval[1], interval[0] + duration + BREAK_MINUTES)
            day += timedelta(days=1)
        if remaining:
            shortfalls.append({"taskId": item["task_id"], "missingMin": remaining})

    required_minutes = sum(item["remaining"] for item in selected)
    deficit_minutes = sum(item["missingMin"] for item in shortfalls)
    first_assignment = selected[0]["assignment"] if selected else None
    reasons = [
        "Backend xếp lịch theo deadline gần nhất và không đặt study block sau hạn nộp.",
        "Mọi study block nằm trong quỹ thời gian rảnh và tránh các khoảng bận đã khai báo.",
        f"Mỗi study block tối đa {MAX_BLOCK_MINUTES} phút và có {BREAK_MINUTES} phút nghỉ giữa hai block.",
    ]
    if first_assignment:
        reasons.insert(0, f"Ưu tiên “{first_assignment.get('title', 'nhiệm vụ gần nhất')}” vì có deadline gần nhất.")
    assumptions = [
        "Lịch được tính cho bảy ngày kể từ hôm nay.",
        "Thời lượng còn lại do sinh viên xác nhận; hệ thống không tự thay đổi con số này.",
    ]
    return {
        "input": plan_input,
        "blocks": sorted(blocks, key=lambda item: (item["date"], item["start"])),
        "feasibility": {
            "availableMin": available_minutes,
            "requiredMin": required_minutes,
            "remainingMin": available_minutes - required_minutes,
            "feasible": deficit_minutes == 0,
            "deficitMin": deficit_minutes,
            "shortfalls": shortfalls,
        },
        "reasons": reasons,
        "assumptions": assumptions,
        "createdAt": datetime.now(ZoneInfo(timezone_name)).isoformat(),
    }
