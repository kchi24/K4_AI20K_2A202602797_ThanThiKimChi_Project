from datetime import UTC, datetime

from src.agents.tools.schedule_calculator import (
    calculate_available_hours,
    check_deadline_slack,
    detect_schedule_conflicts,
)


def test_unavailable_different_day_is_not_subtracted():
    available = [{"day": "monday", "start": "18:00", "end": "20:00"}]
    unavailable = [{"day": "tuesday", "start": "18:00", "end": "19:00"}]
    assert calculate_available_hours(available, unavailable) == 2.0


def test_only_overlap_is_subtracted():
    available = [{"day": "monday", "start": "18:00", "end": "21:00"}]
    unavailable = [{"day": "monday", "start": "19:00", "end": "20:00"}]
    assert calculate_available_hours(available, unavailable) == 2.0


def test_overlapping_busy_slots_are_not_double_counted():
    available = [{"day": "monday", "start": "18:00", "end": "22:00"}]
    unavailable = [
        {"day": "monday", "start": "19:00", "end": "21:00"},
        {"day": "monday", "start": "20:00", "end": "21:30"},
    ]
    assert calculate_available_hours(available, unavailable) == 1.5


def test_numeric_unavailability_is_conservative():
    assert calculate_available_hours([{"hours": 4}], [{"hours": 1.5}]) == 2.5


def test_z_deadline_supports_timezone_aware_math():
    result = check_deadline_slack(
        "2026-09-29T12:00:00Z",
        2,
        current_time=datetime(2026, 9, 29, 8, 0, tzinfo=UTC),
    )
    assert result["hours_until_deadline"] == 4.0
    assert result["slack_hours"] == 2.0


def test_schedule_conflict_respects_day():
    slots = [
        {"id": "a", "day": "monday", "start_time": "09:00", "end_time": "10:00"},
        {"id": "b", "day": "tuesday", "start_time": "09:00", "end_time": "10:00"},
    ]
    assert detect_schedule_conflicts(slots) == []


def test_schedule_conflict_detected():
    slots = [
        {"id": "a", "day": "monday", "start_time": "09:00", "end_time": "10:30"},
        {"id": "b", "day": "monday", "start_time": "10:00", "end_time": "11:00"},
    ]
    assert len(detect_schedule_conflicts(slots)) == 1
