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
