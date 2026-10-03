from datetime import UTC, datetime

from app.db import Base
from app.extended_api import CourseActivityRequest, create_course_activity
from app.models import Assignment, CalendarEvent, Course, CourseContent, Enrollment, Resource, User
from app.security import hash_password
from app.year_schedule_seed import COURSE_SCHEDULES, seed_2026_demo_calendars
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session


def _database() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = Session(engine)
    student = User(
        email="student@canvas.local",
        full_name="Demo Student",
        password_hash=hash_password("demo123"),
        role="student",
        avatar_color="#2563eb",
    )
    teacher = User(
        email="teacher@canvas.local",
        full_name="Demo Teacher",
        password_hash=hash_password("demo123"),
        role="instructor",
        avatar_color="#7c3aed",
    )
    db.add_all([student, teacher])
    for schedule in COURSE_SCHEDULES:
        course = Course(code=schedule.code, name=schedule.code, term="2026", color="#2563eb")
        db.add(course)
        db.flush()
        db.add(Enrollment(user_id=student.id, course_id=course.id, role="student", progress=0))
        db.add(Enrollment(user_id=teacher.id, course_id=course.id, role="instructor", progress=100))
    db.commit()
    return db


def test_year_schedule_covers_2026_and_is_idempotent() -> None:
    with _database() as db:
        seed_2026_demo_calendars(db)
        counts = {
            "events": db.scalar(select(func.count(CalendarEvent.id))),
            "assignments": db.scalar(select(func.count(Assignment.id))),
            "videos": db.scalar(select(func.count(Resource.id)).where(Resource.kind == "video")),
            "quizzes": db.scalar(select(func.count(CourseContent.id)).where(CourseContent.kind == "quiz")),
        }
        starts = db.scalars(select(CalendarEvent.starts_at).order_by(CalendarEvent.starts_at)).all()

        assert counts["events"] == 486
        assert counts["assignments"] == 33
        assert counts["videos"] == 36
        assert counts["quizzes"] == 45
        assert starts[0].replace(tzinfo=UTC).year == 2026
        assert starts[-1].replace(tzinfo=UTC).year == 2026
        assert {value.month for value in starts} == set(range(1, 13))
        assert any("Thi giữa kỳ" in item for item in db.scalars(select(CalendarEvent.title)))
        assert any("Thi cuối kỳ" in item for item in db.scalars(select(CalendarEvent.title)))
        assignment_counts = {
            code: db.scalar(
                select(func.count(Assignment.id))
                .join(Course, Course.id == Assignment.course_id)
                .where(Course.code == code)
            )
            for code in ("CS101", "DS201", "PM102")
        }
        assert assignment_counts == {"CS101": 10, "DS201": 11, "PM102": 12}
        online_classes = db.scalars(
            select(CalendarEvent).where(CalendarEvent.event_kind == "class_session")
        ).all()
        assert online_classes
        assert all(item.join_url for item in online_classes)
        assert all(item.attendance_status == "scheduled" for item in online_classes)

        teacher = db.scalar(select(User).where(User.email == "teacher@canvas.local"))
        assert teacher is not None
        q4_titles = db.scalars(
            select(CalendarEvent.title).where(
                CalendarEvent.user_id == teacher.id,
                CalendarEvent.starts_at >= datetime(2026, 10, 1, tzinfo=UTC),
                CalendarEvent.starts_at < datetime(2027, 1, 1, tzinfo=UTC),
            )
        ).all()
        assert any("Ca học online" in title for title in q4_titles)
        assert any("Video tháng" in title for title in q4_titles)
        assert any("Quiz tháng" in title for title in q4_titles)
        assert any("Thi giữa kỳ học kỳ 1" in title for title in q4_titles)
        assert any("Thi cuối kỳ" in title for title in q4_titles)

        seed_2026_demo_calendars(db)

        assert db.scalar(select(func.count(CalendarEvent.id))) == counts["events"]
        assert db.scalar(select(func.count(Assignment.id))) == counts["assignments"]
        assert db.scalar(select(func.count(Resource.id)).where(Resource.kind == "video")) == counts["videos"]
        assert db.scalar(select(func.count(CourseContent.id)).where(CourseContent.kind == "quiz")) == counts["quizzes"]


def test_instructor_can_add_full_activity_set_to_an_existing_course() -> None:
    with _database() as db:
        teacher = db.scalar(select(User).where(User.email == "teacher@canvas.local"))
        course = db.scalar(select(Course).where(Course.code == "CS101"))
        assert teacher is not None and course is not None
        base = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)

        activity_specs = (
            ("class_session", "Online class", 2),
            ("lecture_video", "Lecture video", 1),
            ("quiz", "Weekly quiz", 1),
            ("assignment", "Homework", 1),
            ("midterm", "Midterm exam", 1),
            ("final_exam", "Final exam", 1),
        )
        for index, (activity_type, title, repeat_count) in enumerate(activity_specs):
            starts_at = base.replace(day=base.day + index)
            create_course_activity(
                course.id,
                CourseActivityRequest(
                    user_id=teacher.id,
                    activity_type=activity_type,
                    title=title,
                    starts_at=starts_at,
                    ends_at=(
                        None
                        if activity_type == "assignment"
                        else starts_at.replace(hour=11)
                    ),
                    repeat_count=repeat_count,
                    source_url="https://example.test/video" if activity_type == "lecture_video" else "",
                    points_possible=20,
                ),
                db,
            )

        assert db.scalar(select(func.count(CalendarEvent.id))) == 12
        assert db.scalar(select(func.count(Resource.id)).where(Resource.kind == "video")) == 1
        assert db.scalar(select(func.count(Assignment.id))) == 1
        assert db.scalar(select(func.count(CourseContent.id)).where(CourseContent.kind == "quiz")) == 3
        online = db.scalars(
            select(CalendarEvent).where(CalendarEvent.event_kind == "class_session")
        ).all()
        assert len(online) == 4
        assert all(item.join_url for item in online)
