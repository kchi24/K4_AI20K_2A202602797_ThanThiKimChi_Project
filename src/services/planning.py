"""Deterministic, server-side study scheduling.

The LLM may propose milestones and explain trade-offs, but this module is the
single source of truth for positioned study blocks and feasibility numbers.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from math import ceil
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

MIN_SLOT_MINUTES = 30
MAX_BLOCK_MINUTES = 90
BREAK_MINUTES = 10
PRIORITY_WEIGHT = {"high": 0, "medium": 1, "low": 2}


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
    preferred: str | list[str],
) -> list[list[int]]:
    windows = {
        "morning": (0, 12 * 60),
        "afternoon": (12 * 60, 17 * 60),
        "evening": (17 * 60, 24 * 60),
    }
    raw_values = preferred if isinstance(preferred, list) else [preferred]
    preferred_values = {value for value in raw_values if value in windows}
    if not preferred_values:
        preferred_values = {"evening"}
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
            0
            if any(start <= item[0] < end for value, (start, end) in windows.items() if value in preferred_values)
            else 1,
            item[0],
        ),
    )


def _free_intervals(
    current: date,
    availability: list[dict[str, Any]],
    unavailable: list[dict[str, Any]],
    preferred: str | list[str],
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
        exact_date = str(item.get("date") or "")[:10]
        if exact_date and exact_date != current.isoformat():
            continue
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
    proposed_milestones: list[dict[str, Any]] | None = None,
    timezone_name: str = "Asia/Ho_Chi_Minh",
    today: date | None = None,
    window_days: int = 7,
) -> dict[str, Any]:
    """Create a canonical plan with deterministic risk-aware scheduling.

    The LLM may decompose work into milestones, but only this function positions
    blocks on the calendar. This keeps feasibility and deadline rules stable.
    """
    current = today or datetime.now(ZoneInfo(timezone_name)).date()
    planning_window_days = max(1, int(window_days))
    requested_week_start = _parse_deadline(plan_input.get("weekStart"), current)
    has_calendar_week = bool(plan_input.get("weekStart"))
    week_start = requested_week_start if has_calendar_week else current
    week_end = week_start + timedelta(days=planning_window_days - 1)
    schedule_start = max(current, week_start)
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
                    "priority": str(assignment.get("priority") or "medium"),
                }
            )
    selected.sort(
        key=lambda item: (
            item["deadline"],
            PRIORITY_WEIGHT.get(item["priority"], PRIORITY_WEIGHT["medium"]),
            -float((item["assignment"].get("assignment_group") or {}).get("weight") or 0),
            -float(item["assignment"].get("points_possible") or 0),
        )
    )
    for item in selected:
        days_until_deadline = max(0, (item["deadline"] - schedule_start).days)
        if days_until_deadline < planning_window_days:
            target = item["remaining"]
        else:
            # The look-ahead horizon may include work due after this planning
            # window. Schedule only a fair share instead of forcing the whole
            # assignment into the current window.
            proportional = ceil(
                item["remaining"] * planning_window_days / (days_until_deadline + 1)
            )
            target = min(item["remaining"], max(MIN_SLOT_MINUTES, ceil(proportional / 15) * 15))
        item["target"] = target

    selected_ids = {item["task_id"] for item in selected}
    milestones_by_task: dict[str, list[dict[str, Any]]] = {task_id: [] for task_id in selected_ids}
    generic_milestones: list[dict[str, Any]] = []
    for raw in proposed_milestones or []:
        milestone_id = str(raw.get("milestone_id") or raw.get("id") or "").strip()
        if not milestone_id:
            continue
        task_id = str(raw.get("task_id") or raw.get("taskId") or raw.get("assignment_id") or "").strip()
        normalized = {
            "milestoneId": milestone_id,
            "title": str(raw.get("title") or milestone_id),
            "deliverable": str(raw.get("deliverable") or ""),
            "estimatedMin": max(15, int(raw.get("estimated_minutes") or raw.get("estimatedMin") or 60)),
            "dependsOn": [str(value) for value in (raw.get("depends_on") or raw.get("dependsOn") or [])],
        }
        if task_id in milestones_by_task:
            milestones_by_task[task_id].append(normalized)
        else:
            generic_milestones.append(normalized)

    # Old agent responses did not carry task_id. They are still useful when a
    # student is planning one assignment; otherwise deterministic task-level
    # milestones avoid attaching AI output to the wrong course.
    if len(selected) == 1 and generic_milestones:
        milestones_by_task[selected[0]["task_id"]].extend(generic_milestones)

    planning_milestones: list[dict[str, Any]] = []
    for item in selected:
        task_milestones = milestones_by_task[item["task_id"]]
        if not task_milestones:
            task_milestones = [{
                "milestoneId": f"{item['task_id']}:complete",
                "title": f"Hoàn thành {item['assignment'].get('title', 'nhiệm vụ')}",
                "deliverable": "Nhiệm vụ sẵn sàng nộp",
                "estimatedMin": item["target"],
                "dependsOn": [],
            }]
        remaining_target = item["target"]
        for index, milestone in enumerate(task_milestones):
            if remaining_target <= 0:
                break
            requested = milestone["estimatedMin"]
            allocated = remaining_target if index == len(task_milestones) - 1 else min(remaining_target, requested)
            planning_milestones.append({
                **milestone,
                "taskId": item["task_id"],
                "targetMin": allocated,
                "deadline": item["deadline"].isoformat(),
            })
            remaining_target -= allocated
        if remaining_target > 0:
            planning_milestones.append({
                "milestoneId": f"{item['task_id']}:finish",
                "taskId": item["task_id"],
                "title": f"Hoàn thiện {item['assignment'].get('title', 'nhiệm vụ')}",
                "deliverable": "Nhiệm vụ sẵn sàng nộp",
                "estimatedMin": remaining_target,
                "targetMin": remaining_target,
                "dependsOn": [planning_milestones[-1]["milestoneId"]] if planning_milestones else [],
                "deadline": item["deadline"].isoformat(),
            })

    availability = list(plan_input.get("availability") or [])
    unavailable = list(plan_input.get("unavailable") or [])
    preferred_raw = plan_input.get("preferred") or ["evening"]
    preferred = (
        [str(value) for value in preferred_raw]
        if isinstance(preferred_raw, list)
        else str(preferred_raw)
    )
    free_by_day: dict[date, list[list[int]]] = {}
    planning_day_count = max(0, (week_end - schedule_start).days + 1)
    for offset in range(planning_day_count):
        day = schedule_start + timedelta(days=offset)
        free_by_day[day] = _free_intervals(day, availability, unavailable, preferred)

    available_minutes = sum(end - start for intervals in free_by_day.values() for start, end in intervals)
    blocks: list[dict[str, Any]] = []
    shortfalls: list[dict[str, Any]] = []
    for item in selected:
        task_milestones = [value for value in planning_milestones if value["taskId"] == item["task_id"]]
        remaining = item["target"]
        last_day = min(item["deadline"], week_end)
        day = schedule_start
        milestone_index = 0
        milestone_remaining = task_milestones[0]["targetMin"] if task_milestones else remaining
        while day <= last_day and remaining > 0:
            for interval in free_by_day.get(day, []):
                while remaining > 0 and interval[1] - interval[0] >= min(MIN_SLOT_MINUTES, remaining):
                    while milestone_index < len(task_milestones) and milestone_remaining <= 0:
                        milestone_index += 1
                        milestone_remaining = task_milestones[milestone_index]["targetMin"] if milestone_index < len(task_milestones) else remaining
                    duration = min(remaining, milestone_remaining, MAX_BLOCK_MINUTES, interval[1] - interval[0])
                    start = interval[0]
                    milestone = task_milestones[milestone_index] if milestone_index < len(task_milestones) else None
                    blocks.append(
                        {
                            "id": f"blk-{uuid4().hex[:12]}",
                            "taskId": item["task_id"],
                            "milestoneId": milestone["milestoneId"] if milestone else None,
                            "milestoneTitle": milestone["title"] if milestone else None,
                            "date": day.isoformat(),
                            "start": _minutes_to_clock(start),
                            "end": _minutes_to_clock(start + duration),
                        }
                    )
                    remaining -= duration
                    milestone_remaining -= duration
                    interval[0] = min(interval[1], interval[0] + duration + BREAK_MINUTES)
            day += timedelta(days=1)
        if remaining:
            shortfalls.append({"taskId": item["task_id"], "missingMin": remaining})

    required_minutes = sum(item["target"] for item in selected)
    deficit_minutes = sum(item["missingMin"] for item in shortfalls)
    uncovered_tasks = []
    for assignment in assignments:
        task_id = str(assignment.get("id") or "")
        submission_state = str((assignment.get("submission") or {}).get("workflow_state") or "").lower()
        deadline = _parse_deadline(assignment.get("deadline"), week_end + timedelta(days=7))
        if (
            task_id
            and task_id not in selected_ids
            and submission_state not in {"submitted", "graded"}
            and 0 <= (deadline - schedule_start).days <= 13
        ):
            uncovered_tasks.append({
                "taskId": task_id,
                "title": str(assignment.get("title") or task_id),
                "deadline": deadline.isoformat(),
            })
    first_assignment = selected[0]["assignment"] if selected else None
    reasons = [
        "Backend ưu tiên deadline gần, mức độ quan trọng và trọng số bài; không đặt study block sau hạn nộp.",
        "Mọi study block nằm trong quỹ thời gian rảnh và tránh các khoảng bận đã khai báo.",
        f"Mỗi study block tối đa {MAX_BLOCK_MINUTES} phút và có {BREAK_MINUTES} phút nghỉ giữa hai block.",
    ]
    if first_assignment:
        reasons.insert(0, f"Ưu tiên “{first_assignment.get('title', 'nhiệm vụ gần nhất')}” vì có deadline gần nhất.")
    assumptions = [
        f"Lịch được tính trong tuần {week_start.isoformat()} đến {week_end.isoformat()} và không xếp block vào ngày đã qua.",
        "Thời lượng còn lại do sinh viên xác nhận; hệ thống không tự thay đổi con số này.",
    ]
    return {
        "input": plan_input,
        "weekStart": week_start.isoformat(),
        "weekEnd": week_end.isoformat(),
        "planningTargets": [
            {
                "taskId": item["task_id"],
                "targetMin": item["target"],
                "remainingMin": item["remaining"],
            }
            for item in selected
        ],
        "priorityOrder": [
            {
                "rank": index + 1,
                "taskId": item["task_id"],
                "title": str(item["assignment"].get("title") or item["task_id"]),
                "deadline": item["deadline"].isoformat(),
                "priority": item["priority"],
                "assignmentGroupWeight": float(
                    (item["assignment"].get("assignment_group") or {}).get("weight") or 0
                ),
                "pointsPossible": float(item["assignment"].get("points_possible") or 0),
            }
            for index, item in enumerate(selected)
        ],
        "milestones": planning_milestones,
        "blocks": sorted(blocks, key=lambda item: (item["date"], item["start"])),
        "feasibility": {
            "availableMin": available_minutes,
            "requiredMin": required_minutes,
            "remainingMin": available_minutes - required_minutes,
            "feasible": deficit_minutes == 0,
            "deficitMin": deficit_minutes,
            "shortfalls": shortfalls,
            "uncoveredTasks": uncovered_tasks,
        },
        "reasons": reasons,
        "assumptions": assumptions,
        "createdAt": datetime.now(ZoneInfo(timezone_name)).isoformat(),
    }
