from datetime import date, datetime
from zoneinfo import ZoneInfo

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


def test_scheduler_prioritizes_student_defined_self_study_window():
    result = build_plan_draft(
        {
            "goal": "Use my protected study habit",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [{"weekday": 0, "enabled": True, "start": "08:00", "end": "22:00"}],
            "unavailable": [
                {
                    "weekday": 0,
                    "date": "2026-09-28",
                    "start": "20:00",
                    "end": "21:30",
                    "category": "self_study",
                }
            ],
            "preferred": ["morning", "evening"],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-09-28T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )

    assert result["blocks"][0]["start"] == "20:00"


def test_scheduler_supports_explicit_late_night_preference_and_sleep_constraint():
    result = build_plan_draft(
        {
            "goal": "Study before my 02:00 bedtime",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [{"weekday": 0, "enabled": True, "start": "00:00", "end": "24:00"}],
            "unavailable": [
                {"weekday": 0, "start": "02:00", "end": "10:00", "category": "sleep"}
            ],
            "preferred": ["late_night"],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-09-28T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )

    assert result["blocks"][0]["start"] == "00:00"
    assert result["blocks"][0]["end"] == "01:00"


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


def test_scheduler_preserves_valid_pinned_block_and_schedules_remainder():
    result = build_plan_draft(
        {
            "goal": "Keep my chosen study time",
            "weekStart": "2026-09-28",
            "tasks": [{"taskId": "a1", "remainingMin": 120}],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "21:00"}],
            "unavailable": [],
            "preferred": "evening",
            "pinnedBlocks": [
                {
                    "id": "student-choice",
                    "taskId": "a1",
                    "date": "2026-09-28",
                    "start": "18:00",
                    "end": "19:00",
                }
            ],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-09-28T23:59:00+07:00"}],
        today=date(2026, 9, 28),
    )

    assert result["feasibility"]["feasible"] is True
    assert result["blocks"][0]["id"] == "student-choice"
    assert result["blocks"][0]["start"] == "18:00"
    assert result["blocks"][1]["start"] == "19:00"
    assert sum(
        int(block["end"].split(":")[0]) * 60
        + int(block["end"].split(":")[1])
        - int(block["start"].split(":")[0]) * 60
        - int(block["start"].split(":")[1])
        for block in result["blocks"]
    ) == 120


def test_scheduler_starts_after_current_time_with_preparation_buffer():
    result = build_plan_draft(
        {
            "goal": "Continue the current week",
            "weekStart": "2026-09-28",
            "horizonEnd": "2026-10-11",
            "tasks": [{"taskId": "a1", "remainingMin": 60, "personalPriority": 3}],
            "availability": [
                {"weekday": weekday, "enabled": True, "start": "08:00", "end": "20:00"}
                for weekday in range(7)
            ],
            "unavailable": [],
            "preferred": ["afternoon", "evening"],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-10-04T23:59:00+07:00"}],
        now=datetime(2026, 10, 2, 16, 7, tzinfo=ZoneInfo("Asia/Ho_Chi_Minh")),
    )

    assert result["scheduleStart"] == "2026-10-02"
    assert result["blocks"][0]["date"] == "2026-10-02"
    assert result["blocks"][0]["start"] >= "16:30"
    assert result["blocks"][0]["status"] == "confirmed"


def test_replanning_keeps_past_blocks_as_read_only_history():
    result = build_plan_draft(
        {
            "goal": "Replan without rewriting history",
            "weekStart": "2026-09-28",
            "horizonEnd": "2026-10-11",
            "tasks": [{"taskId": "a1", "remainingMin": 60}],
            "availability": [
                {"weekday": weekday, "enabled": True, "start": "08:00", "end": "20:00"}
                for weekday in range(7)
            ],
            "unavailable": [],
            "preferred": "afternoon",
            "pinnedBlocks": [
                {"id": "past", "taskId": "a1", "date": "2026-09-30", "start": "09:00", "end": "10:00"}
            ],
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-10-04"}],
        now=datetime(2026, 10, 2, 16, 7, tzinfo=ZoneInfo("Asia/Ho_Chi_Minh")),
    )

    history = next(block for block in result["blocks"] if block["id"] == "past")
    future = [block for block in result["blocks"] if block["id"] != "past"]
    assert history["status"] == "history"
    assert all(block["date"] >= "2026-10-02" for block in future)


def test_scheduler_marks_next_week_blocks_as_tentative():
    result = build_plan_draft(
        {
            "goal": "Use the two-week forecast",
            "weekStart": "2026-09-28",
            "horizonEnd": "2026-10-11",
            "tasks": [{"taskId": "a1", "remainingMin": 180}],
            "availability": [
                {"weekday": 0, "enabled": True, "start": "18:00", "end": "20:00"},
                {"weekday": 6, "enabled": True, "start": "18:00", "end": "19:00"},
            ],
            "unavailable": [],
            "preferred": "evening",
        },
        [{"id": "a1", "title": "Assignment", "deadline": "2026-10-11"}],
        today=date(2026, 10, 4),
    )

    assert result["weekEnd"] == "2026-10-04"
    assert result["horizonEnd"] == "2026-10-11"
    assert {block["status"] for block in result["blocks"]} == {"confirmed", "tentative"}


def test_scheduler_keeps_personal_priority_separate_from_academic_weight():
    result = build_plan_draft(
        {
            "goal": "Respect the learner choice",
            "tasks": [
                {"taskId": "academic", "remainingMin": 60, "personalPriority": 1},
                {"taskId": "personal", "remainingMin": 60, "personalPriority": 4},
            ],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "21:00"}],
            "unavailable": [],
            "preferred": "evening",
        },
        [
            {"id": "academic", "title": "Heavy group", "priority": "medium", "deadline": "2026-09-28", "assignment_group": {"weight": 60}},
            {"id": "personal", "title": "Learner focus", "priority": "medium", "deadline": "2026-09-28", "assignment_group": {"weight": 20}},
        ],
        today=date(2026, 9, 28),
    )

    assert [item["taskId"] for item in result["priorityOrder"]] == ["personal", "academic"]
    assert result["priorityOrder"][0]["personalPriority"] == 4
    assert result["priorityOrder"][1]["assignmentGroupWeight"] == 60


def test_scheduler_preserves_confirmed_goals_and_grounding_refs():
    result = build_plan_draft(
        {
            "goal": "Finish the project",
            "weeklyGoals": [{"id": "goal-1", "title": "Finish CS101", "taskIds": ["a1"], "confirmed": True}],
            "tasks": [{"taskId": "a1", "remainingMin": 60, "weeklyGoalId": "goal-1"}],
            "availability": [{"weekday": 0, "enabled": True, "start": "18:00", "end": "20:00"}],
            "unavailable": [],
            "preferred": "evening",
        },
        [{"id": "a1", "title": "Mini project", "deadline": "2026-09-28", "rubric": {"id": 7}}],
        today=date(2026, 9, 28),
    )

    assert result["weeklyGoals"][0]["confirmed"] is True
    assert result["milestones"][0]["weeklyGoalId"] == "goal-1"
    assert result["milestones"][0]["sourceRefs"] == ["assignment:a1", "rubric:7"]
