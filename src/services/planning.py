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
DEFAULT_PERSONAL_PRIORITY = 2
SCHEDULING_BUFFER_MINUTES = 15


def _clock_to_minutes(value: str) -> int:
    hours, minutes = str(value).split(":", 1)
    return int(hours) * 60 + int(minutes)


def _minutes_to_clock(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


def _ceil_minutes(value: int, increment: int = 15) -> int:
    """Round a minute-of-day value up to a calendar-friendly boundary."""
    return min(24 * 60, ((value + increment - 1) // increment) * increment)


def _personal_priority(value: Any) -> int:
    """Normalize the learner-owned priority without trusting arbitrary scores."""
    try:
        return min(4, max(1, int(value)))
    except (TypeError, ValueError):
        return DEFAULT_PERSONAL_PRIORITY


def _fallback_milestones(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Create task-aware safe milestones when the LLM is unavailable.

    These are intentionally based on the assignment type/title and never
    invent subject-matter content or solve graded work.
    """
    assignment = item["assignment"]
    task_id = item["task_id"]
    title = str(assignment.get("title") or "nhiệm vụ")
    folded = title.casefold()
    rubric = assignment.get("rubric") or {}
    source_refs = [f"assignment:{task_id}"]
    if rubric.get("id"):
        source_refs.append(f"rubric:{rubric['id']}")

    if any(value in folded for value in ("quiz", "kiểm tra", "giữa kỳ", "cuối kỳ", "exam")):
        steps = [
            ("Xác định phạm vi cần ôn", "Danh sách chủ đề và tiêu chí cần đạt", 25),
            ("Ôn học liệu liên quan", "Ghi chú ngắn cho từng chủ đề", 45),
            ("Tự kiểm tra và rà soát", "Danh sách phần còn chưa chắc", 30),
        ]
    elif any(value in folded for value in ("video", "bài giảng", "lecture")):
        steps = [
            ("Xem học liệu và ghi chú", "Ghi chú các ý chính", 70),
            ("Tóm tắt và xác định câu hỏi", "Bản tóm tắt cùng câu hỏi cần làm rõ", 30),
        ]
    elif any(value in folded for value in ("project", "dự án", "lập trình", "code", "dashboard")):
        steps = [
            ("Đọc yêu cầu và rubric", "Checklist yêu cầu cần đáp ứng", 15),
            ("Thiết kế phương án thực hiện", "Bản thiết kế hoặc danh sách bước triển khai", 20),
            ("Thực hiện phần chính", "Bản nháp sản phẩm có thể kiểm tra", 40),
            ("Kiểm thử và đối chiếu rubric", "Sản phẩm đã rà soát, sẵn sàng nộp", 25),
        ]
    else:
        steps = [
            ("Đọc yêu cầu và tiêu chí", "Checklist yêu cầu cần hoàn thành", 20),
            ("Thực hiện bản nháp", "Bản nháp có thể kiểm tra", 55),
            ("Rà soát và chuẩn bị nộp", "Nhiệm vụ sẵn sàng nộp", 25),
        ]

    target = max(MIN_SLOT_MINUTES, int(item["target"]))
    if target <= MAX_BLOCK_MINUTES:
        return [
            {
                "milestoneId": f"{task_id}:complete",
                "title": f"Hoàn thành {title}",
                "deliverable": "Nhiệm vụ sẵn sàng nộp",
                "estimatedMin": target,
                "dependsOn": [],
                "sourceRefs": source_refs,
            }
        ]
    milestones: list[dict[str, Any]] = []
    allocated = 0
    for index, (step_title, deliverable, percentage) in enumerate(steps):
        remaining = target - allocated
        minutes = remaining if index == len(steps) - 1 else max(60, round(target * percentage / 100 / 15) * 15)
        minutes = min(remaining, minutes)
        if minutes <= 0:
            continue
        milestone_id = f"{task_id}:step-{index + 1}"
        milestones.append(
            {
                "milestoneId": milestone_id,
                "title": f"{step_title}: {title}",
                "deliverable": deliverable,
                "estimatedMin": minutes,
                "dependsOn": [milestones[-1]["milestoneId"]] if milestones else [],
                "sourceRefs": source_refs,
            }
        )
        allocated += minutes
    return milestones


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
    preferred_ranges: list[tuple[int, int]] | None = None,
) -> list[list[int]]:
    windows = {
        "late_night": (0, 5 * 60),
        "morning": (5 * 60, 12 * 60),
        "afternoon": (12 * 60, 17 * 60),
        "evening": (17 * 60, 24 * 60),
    }
    raw_values = preferred if isinstance(preferred, list) else [preferred]
    preferred_values = {value for value in raw_values if value in windows}
    if not preferred_values:
        preferred_values = {"evening"}
    parts: list[list[int]] = []
    exact_ranges = preferred_ranges or []
    for start, end in intervals:
        cursor = start
        cuts = sorted(
            {
                5 * 60,
                12 * 60,
                17 * 60,
                end,
                *(value for pair in exact_ranges for value in pair),
            }
        )
        for cut in cuts:
            if cursor < cut <= end:
                parts.append([cursor, cut])
                cursor = cut
    return sorted(
        parts,
        key=lambda item: (
            0
            if any(start <= item[0] and item[1] <= end for start, end in exact_ranges)
            else 1,
            0
            if any(start <= item[0] < end for value, (start, end) in windows.items() if value in preferred_values)
            else 1,
            item[0],
        ),
    )


def _self_study_ranges(
    current: date,
    slots: list[dict[str, Any]],
) -> list[tuple[int, int]]:
    """Return learner-declared study windows that apply to one calendar day."""
    ranges: list[tuple[int, int]] = []
    for item in slots:
        if str(item.get("category") or "") != "self_study":
            continue
        exact_date = str(item.get("date") or "")[:10]
        if exact_date and exact_date != current.isoformat():
            continue
        if int(item.get("weekday", -1)) != current.weekday():
            continue
        try:
            start = _clock_to_minutes(str(item["start"]))
            end = _clock_to_minutes(str(item["end"]))
        except (KeyError, TypeError, ValueError):
            continue
        if end - start >= MIN_SLOT_MINUTES:
            ranges.append((start, end))
    return ranges


def _merge_ranges(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return [(start, end) for start, end in merged]


def _inside_self_study_window(
    current: date,
    interval: list[int],
    slots: list[dict[str, Any]],
) -> bool:
    return any(
        start <= interval[0] and interval[1] <= end
        for start, end in _self_study_ranges(current, slots)
    )


def _free_intervals(
    current: date,
    availability: list[dict[str, Any]],
    unavailable: list[dict[str, Any]],
    preferred: str | list[str],
) -> list[list[int]]:
    weekday = current.weekday()
    preferred_ranges = _self_study_ranges(current, unavailable)
    available = next(
        (item for item in availability if int(item.get("weekday", -1)) == weekday and item.get("enabled", True)),
        None,
    )
    intervals: list[tuple[int, int]] = []
    if available:
        try:
            intervals.append(
                (
                    _clock_to_minutes(str(available["start"])),
                    _clock_to_minutes(str(available["end"])),
                )
            )
        except (KeyError, TypeError, ValueError):
            pass
    # A positioned self-study slot is an explicit declaration that the learner
    # can study then. It therefore extends general availability, including on a
    # weekend that is disabled in the recurring weekly profile.
    intervals = _merge_ranges([*intervals, *preferred_ranges])
    if not intervals:
        return []
    for item in unavailable:
        exact_date = str(item.get("date") or "")[:10]
        if exact_date and exact_date != current.isoformat():
            continue
        if int(item.get("weekday", -1)) != weekday:
            continue
        try:
            if str(item.get("category") or "") == "self_study":
                continue
            intervals = _subtract(
                intervals,
                _clock_to_minutes(str(item["start"])),
                _clock_to_minutes(str(item["end"])),
            )
        except (KeyError, TypeError, ValueError):
            continue
    intervals = [item for item in intervals if item[1] - item[0] >= MIN_SLOT_MINUTES]
    return _ordered_intervals(intervals, preferred, preferred_ranges)


def build_plan_draft(
    plan_input: dict[str, Any],
    assignments: list[dict[str, Any]],
    *,
    proposed_milestones: list[dict[str, Any]] | None = None,
    timezone_name: str = "Asia/Ho_Chi_Minh",
    today: date | None = None,
    now: datetime | None = None,
    window_days: int = 7,
) -> dict[str, Any]:
    """Create a canonical plan with deterministic risk-aware scheduling.

    The LLM may decompose work into milestones, but only this function positions
    blocks on the calendar. This keeps feasibility and deadline rules stable.
    """
    timezone = ZoneInfo(timezone_name)
    current_time = now.astimezone(timezone) if now else datetime.now(timezone)
    current = today or current_time.date()
    schedule_floor_minute = (
        _ceil_minutes(
            current_time.hour * 60
            + current_time.minute
            + SCHEDULING_BUFFER_MINUTES
        )
        if now is not None or today is None
        else 0
    )
    planning_window_days = max(1, int(window_days))
    requested_week_start = _parse_deadline(plan_input.get("weekStart"), current)
    has_calendar_week = bool(plan_input.get("weekStart"))
    week_start = requested_week_start if has_calendar_week else current
    commitment_end = week_start + timedelta(days=planning_window_days - 1)
    requested_horizon_end = _parse_deadline(
        plan_input.get("horizonEnd"), commitment_end
    )
    horizon_end = max(commitment_end, requested_horizon_end)
    schedule_start = max(current, week_start)
    assignments_by_id = {str(item.get("id")): item for item in assignments}
    weekly_goals = [
        {
            "id": str(item.get("id") or f"goal-{index + 1}"),
            "title": str(item.get("title") or "").strip(),
            "taskIds": [str(value) for value in item.get("taskIds") or []],
            "confirmed": bool(item.get("confirmed", True)),
        }
        for index, item in enumerate(plan_input.get("weeklyGoals") or [])
        if str(item.get("title") or "").strip()
    ]
    goal_by_task = {
        task_id: goal["id"]
        for goal in weekly_goals
        for task_id in goal["taskIds"]
    }
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
                    "deadline": _parse_deadline(assignment.get("deadline"), horizon_end),
                    "priority": str(assignment.get("priority") or "medium"),
                    "personal_priority": _personal_priority(item.get("personalPriority")),
                    "weekly_goal_id": str(
                        item.get("weeklyGoalId")
                        or goal_by_task.get(task_id)
                        or ""
                    ),
                }
            )
    selected.sort(
        key=lambda item: (
            item["deadline"],
            PRIORITY_WEIGHT.get(item["priority"], PRIORITY_WEIGHT["medium"]),
            -item["personal_priority"],
            -float((item["assignment"].get("assignment_group") or {}).get("weight") or 0),
            -float(item["assignment"].get("points_possible") or 0),
        )
    )
    horizon_days = max(1, (horizon_end - schedule_start).days + 1)
    for item in selected:
        days_until_deadline = max(0, (item["deadline"] - schedule_start).days)
        if item["deadline"] <= horizon_end:
            target = item["remaining"]
        else:
            # The look-ahead horizon may include work due after this planning
            # window. Schedule only a fair share instead of forcing the whole
            # assignment into the current window.
            proportional = ceil(
                item["remaining"] * horizon_days / (days_until_deadline + 1)
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
            "sourceRefs": [
                str(value)
                for value in (raw.get("source_refs") or raw.get("sourceRefs") or [])
                if str(value).strip()
            ],
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
            task_milestones = _fallback_milestones(item)
        remaining_target = item["target"]
        for index, milestone in enumerate(task_milestones):
            if remaining_target <= 0:
                break
            requested = milestone["estimatedMin"]
            allocated = remaining_target if index == len(task_milestones) - 1 else min(remaining_target, requested)
            planning_milestones.append({
                **milestone,
                "taskId": item["task_id"],
                "weeklyGoalId": item["weekly_goal_id"] or None,
                "targetMin": allocated,
                "deadline": item["deadline"].isoformat(),
            })
            remaining_target -= allocated
        if remaining_target > 0:
            planning_milestones.append({
                "milestoneId": f"{item['task_id']}:finish",
                "taskId": item["task_id"],
                "weeklyGoalId": item["weekly_goal_id"] or None,
                "title": f"Hoàn thiện {item['assignment'].get('title', 'nhiệm vụ')}",
                "deliverable": "Nhiệm vụ sẵn sàng nộp",
                "estimatedMin": remaining_target,
                "targetMin": remaining_target,
                "dependsOn": [planning_milestones[-1]["milestoneId"]] if planning_milestones else [],
                "sourceRefs": [],
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
    # Student-positioned blocks are explicit constraints. Preserve every valid
    # block, reserve its interval, and schedule only the remaining workload.
    selected_by_id = {item["task_id"]: item for item in selected}
    pinned_minutes: dict[str, int] = {task_id: 0 for task_id in selected_by_id}
    pinned_blocks: list[dict[str, Any]] = []
    history_blocks: list[dict[str, Any]] = []
    for raw in plan_input.get("pinnedBlocks") or []:
        task_id = str(raw.get("taskId") or "")
        selected_item = selected_by_id.get(task_id)
        if not selected_item:
            continue
        try:
            block_date = date.fromisoformat(str(raw.get("date") or "")[:10])
            start_minute = _clock_to_minutes(str(raw.get("start")))
            end_minute = _clock_to_minutes(str(raw.get("end")))
        except (TypeError, ValueError):
            continue
        if block_date < schedule_start or (
            block_date == current and end_minute <= schedule_floor_minute
        ):
            if week_start <= block_date <= commitment_end:
                history_blocks.append(
                    {
                        "id": str(raw.get("id") or f"blk-{uuid4().hex[:12]}"),
                        "taskId": task_id,
                        "milestoneId": raw.get("milestoneId"),
                        "milestoneTitle": raw.get("milestoneTitle"),
                        "date": block_date.isoformat(),
                        "start": _minutes_to_clock(start_minute),
                        "end": _minutes_to_clock(end_minute),
                        "status": "history",
                    }
                )
            continue
        if (
            block_date > horizon_end
            or block_date > selected_item["deadline"]
            or end_minute <= start_minute
        ):
            continue
        free_before_pin = _free_intervals(block_date, availability, unavailable, preferred)
        if not any(start_minute >= free_start and end_minute <= free_end for free_start, free_end in free_before_pin):
            continue
        normalized = {
            "id": str(raw.get("id") or f"blk-{uuid4().hex[:12]}"),
            "taskId": task_id,
            "milestoneId": raw.get("milestoneId"),
            "milestoneTitle": raw.get("milestoneTitle"),
            "date": block_date.isoformat(),
            "start": _minutes_to_clock(start_minute),
            "end": _minutes_to_clock(end_minute),
            "status": "confirmed" if block_date <= commitment_end else "tentative",
        }
        pinned_blocks.append(normalized)
        pinned_minutes[task_id] += end_minute - start_minute
        unavailable.append({
            "date": block_date.isoformat(),
            "weekday": block_date.weekday(),
            "start": normalized["start"],
            "end": normalized["end"],
        })
    free_by_day: dict[date, list[list[int]]] = {}
    planning_day_count = max(0, (horizon_end - schedule_start).days + 1)
    for offset in range(planning_day_count):
        day = schedule_start + timedelta(days=offset)
        free_by_day[day] = _free_intervals(day, availability, unavailable, preferred)
    # In production the current day starts after "now" plus a small preparation
    # buffer. Tests that pass only ``today`` keep the full deterministic day.
    if schedule_floor_minute:
        free_by_day[current] = [
            [max(start, schedule_floor_minute), end]
            for start, end in free_by_day.get(current, [])
            if end - max(start, schedule_floor_minute) >= MIN_SLOT_MINUTES
        ]

    available_minutes = (
        sum(end - start for intervals in free_by_day.values() for start, end in intervals)
        + sum(pinned_minutes.values())
    )
    blocks: list[dict[str, Any]] = [*history_blocks, *pinned_blocks]
    shortfalls: list[dict[str, Any]] = []
    for item in selected:
        task_milestones = [value for value in planning_milestones if value["taskId"] == item["task_id"]]
        remaining = max(0, item["target"] - pinned_minutes.get(item["task_id"], 0))
        last_day = min(item["deadline"], horizon_end)
        milestone_index = 0
        milestone_remaining = task_milestones[0]["targetMin"] if task_milestones else remaining
        candidate_intervals = [
            (day, interval_order, interval)
            for day, intervals in free_by_day.items()
            if schedule_start <= day <= last_day
            for interval_order, interval in enumerate(intervals)
        ]
        # Explicit self-study windows are learner intent, not busy time. Use
        # them across the whole horizon before generic availability, then keep
        # chronological order inside each group.
        candidate_intervals.sort(
            key=lambda value: (
                0 if _inside_self_study_window(value[0], value[2], unavailable) else 1,
                value[0],
                value[1],
            )
        )
        for day, _, interval in candidate_intervals:
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
                        "status": "confirmed" if day <= commitment_end else "tentative",
                    }
                )
                remaining -= duration
                milestone_remaining -= duration
                interval[0] = min(interval[1], interval[0] + duration + BREAK_MINUTES)
            if remaining <= 0:
                break
        if remaining:
            shortfalls.append({"taskId": item["task_id"], "missingMin": remaining})

    required_minutes = sum(item["target"] for item in selected)
    deficit_minutes = sum(item["missingMin"] for item in shortfalls)
    uncovered_tasks = []
    for assignment in assignments:
        task_id = str(assignment.get("id") or "")
        submission_state = str((assignment.get("submission") or {}).get("workflow_state") or "").lower()
        deadline = _parse_deadline(assignment.get("deadline"), horizon_end)
        if (
            task_id
            and task_id not in selected_ids
            and submission_state not in {"submitted", "graded"}
            and schedule_start <= deadline <= horizon_end
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
        (
            f"Lịch cam kết được tính đến {commitment_end.isoformat()}; "
            f"các block đến {horizon_end.isoformat()} là dự kiến và không có block nào nằm trong quá khứ."
        ),
        "Thời lượng còn lại do sinh viên xác nhận; hệ thống không tự thay đổi con số này.",
    ]
    return {
        "input": plan_input,
        "weekStart": week_start.isoformat(),
        "weekEnd": commitment_end.isoformat(),
        "horizonEnd": horizon_end.isoformat(),
        "scheduleStart": schedule_start.isoformat(),
        "weeklyGoals": weekly_goals,
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
                "personalPriority": item["personal_priority"],
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
        "createdAt": current_time.isoformat(),
    }
