from datetime import date

from src.services.planning import build_plan_draft


def test_scheduler_respects_busy_time_and_deadline():
    result = build_plan_draft(
        {
            "goal": "Finish assignment",
            "tasks": [{"taskId": "a1", "remainingMin": 120}],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "21:30"}],
            "unavailable": [{"weekday": 0, "start": "18:00", "end": "19:00", "label": "Class"}],
            "preferred": "evening",
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-09-28T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )
    assert result["feasibility"]["feasible"] is True
    assert result["blocks"][0]["start"] == "19:00"
    assert all(block["date"] == "2026-09-28" for block in result["blocks"])


def test_scheduler_accepts_multiple_preferred_study_periods():
    result = build_plan_draft(
        {
            "goal": "Study outside the morning",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [{"weekday": 0, "enabled": True, "start": "08:00", "end": "20:00"}],
            "unavailable": [],
            "preferred": ["afternoon", "evening"],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-09-28T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )

    assert result["feasibility"]["feasible"] is True
    assert result["blocks"][0]["start"] == "12:00"


def test_scheduler_places_blocks_in_the_selected_next_calendar_week():
    result = build_plan_draft(
        {
            "goal": "Prepare next week",
            "weekStart": "2026-10-05",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [
                {"weekday": weekday, "enabled": True, "start": "18:00", "end": "20:00"}
                for weekday in range(7)
            ],
            "unavailable": [],
            "preferred": ["evening"],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-10-06T23:59:00+07:00"}],
        today=date(2026, 10, 3),
    )

    assert result["weekStart"] == "2026-10-05"
    assert result["weekEnd"] == "2026-10-11"
    assert result["blocks"][0]["date"] == "2026-10-05"


def test_scheduler_supports_a_two_week_window_for_recovery_only():
    result = build_plan_draft(
        {
            "goal": "Recover across current and following week",
            "weekStart": "2026-09-28",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [
                {"weekday": 0, "enabled": True, "start": "18:00", "end": "19:00"}
            ],
            "unavailable": [],
            "preferred": ["evening"],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-10-11"}],
        today=date(2026, 10, 3),
        window_days=14,
    )

    assert result["weekStart"] == "2026-09-28"
    assert result["weekEnd"] == "2026-10-11"
    assert result["blocks"][0]["date"] == "2026-10-05"


def test_scheduler_does_not_place_current_week_blocks_in_past_days():
    result = build_plan_draft(
        {
            "goal": "Finish the current week",
            "weekStart": "2026-09-28",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [
                {"weekday": weekday, "enabled": True, "start": "18:00", "end": "20:00"}
                for weekday in range(7)
            ],
            "unavailable": [],
            "preferred": ["evening"],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-10-04T23:59:00+07:00"}],
        today=date(2026, 10, 3),
    )

    assert result["blocks"][0]["date"] == "2026-10-03"


def test_scheduler_reports_shortfall_instead_of_crossing_deadline():
    result = build_plan_draft(
        {
            "goal": "Finish assignment",
            "tasks": [{"taskId": "a1", "remainingMin": 180}],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "19:00"}],
            "unavailable": [],
            "preferred": "evening",
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-09-28T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )
    assert result["feasibility"]["feasible"] is False
    assert result["feasibility"]["shortfalls"] == [{"taskId": "a1", "missingMin": 120}]


def test_scheduler_uses_weekly_target_for_deadline_beyond_window():
    result = build_plan_draft(
        {
            "goal": "Make progress without overloading this week",
            "tasks": [{"taskId": "a1", "remainingMin": 600}],
            "availability": [
                {"weekday": weekday, "enabled": True, "start": "18:00", "end": "20:00"}
                for weekday in range(7)
            ],
            "unavailable": [],
            "preferred": "evening",
        },
        [{"id": "a1", "title": "Large assignment", "deadline": "2026-10-10T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )
    target = result["planningTargets"][0]
    assert target["remainingMin"] == 600
    assert target["targetMin"] == 330
    assert result["feasibility"]["requiredMin"] == 330
    assert result["feasibility"]["feasible"] is True


def test_scheduler_respects_exact_date_busy_slot_only_once():
    result = build_plan_draft(
        {
            "goal": "Avoid an LMS exam",
            "tasks": [{"taskId": "a1", "remainingMin": 120}],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "21:00"}],
            "unavailable": [{"weekday": 0, "date": "2026-09-28", "start": "18:00", "end": "19:00"}],
            "preferred": "evening",
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-10-05T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )
    assert result["blocks"][0]["start"] == "19:00"


def test_scheduler_turns_agent_milestones_into_canonical_blocks():
    result = build_plan_draft(
        {
            "goal": "Complete the report",
            "tasks": [{"taskId": "a1", "remainingMin": 120}],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "21:00"}],
            "unavailable": [],
            "preferred": "evening",
        },
        [{"id": "a1", "title": "Report", "deadline": "2026-09-28T23:59:00+07:00"}],
        proposed_milestones=[
            {"milestone_id": "M1", "title": "Outline", "estimated_minutes": 45},
            {"milestone_id": "M2", "title": "Draft", "estimated_minutes": 75, "depends_on": ["M1"]},
        ],
        today=date(2026, 9, 28),
    )

    assert [item["title"] for item in result["milestones"]] == ["Outline", "Draft"]
    assert {block["milestoneTitle"] for block in result["blocks"]} == {"Outline", "Draft"}
    assert sum(item["targetMin"] for item in result["milestones"]) == 120


def test_scheduler_reports_near_deadlines_omitted_from_the_draft():
    result = build_plan_draft(
        {
            "goal": "Plan selected work",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "20:00"}],
            "unavailable": [],
            "preferred": "evening",
        },
        [
            {"id": "a1", "title": "Selected", "deadline": "2026-09-28T23:59:00+07:00"},
            {"id": "a2", "title": "Not selected", "deadline": "2026-10-02T23:59:00+07:00"},
        ],
        today=date(2026, 9, 28),
    )

    assert result["feasibility"]["feasible"] is True
    assert result["feasibility"]["uncoveredTasks"] == [
        {"taskId": "a2", "title": "Not selected", "deadline": "2026-10-02"}
    ]


def test_scheduler_uses_priority_when_deadlines_are_equal():
    result = build_plan_draft(
        {
            "goal": "Protect the highest-risk work",
            "tasks": [
                {"taskId": "low", "remainingMin": 60},
                {"taskId": "high", "remainingMin": 60},
            ],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "20:30"}],
            "unavailable": [],
            "preferred": "evening",
        },
        [
            {"id": "low", "title": "Low priority", "priority": "low", "deadline": "2026-09-28"},
            {"id": "high", "title": "High priority", "priority": "high", "deadline": "2026-09-28"},
        ],
        today=date(2026, 9, 28),
    )

    assert result["blocks"][0]["taskId"] == "high"
    assert [item["taskId"] for item in result["priorityOrder"]] == ["high", "low"]
