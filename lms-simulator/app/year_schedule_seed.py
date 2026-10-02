"""Deterministic 2026 learning calendars for demo learners and instructors.

The calendar deliberately keeps each visible entry to a concise title. Detailed
duration and source metadata remain in the LMS records so PaceWise can build a
multi-course plan without turning the calendar into a wall of text.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Assignment,
    CalendarEvent,
    Course,
    CourseContent,
    Enrollment,
    QuizQuestion,
    Resource,
    Submission,
    User,
)

LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
PRIMARY_STUDENT_EMAIL = "student@canvas.local"
CALENDAR_USER_EMAILS = (PRIMARY_STUDENT_EMAIL, "teacher@canvas.local")
SEED_MARKER = "pacewise-2026-v1"


@dataclass(frozen=True)
class CourseSchedule:
    code: str
    class_weekday: int
    class_start: time
    class_minutes: int
    video_minutes: int
    quiz_minutes: int
    midterm_minutes: int
    final_minutes: int
    topics: tuple[str, ...]


COURSE_SCHEDULES = (
    CourseSchedule(
        code="CS101",
        class_weekday=0,
        class_start=time(8, 0),
        class_minutes=90,
        video_minutes=40,
        quiz_minutes=20,
        midterm_minutes=90,
        final_minutes=120,
        topics=("Biến và kiểu dữ liệu", "Hàm", "Vòng lặp", "Cấu trúc dữ liệu"),
    ),
    CourseSchedule(
        code="DS201",
        class_weekday=2,
        class_start=time(13, 30),
        class_minutes=120,
        video_minutes=50,
        quiz_minutes=25,
        midterm_minutes=90,
        final_minutes=120,
        topics=("Làm sạch dữ liệu", "Phân tích mô tả", "Trực quan hóa", "Dashboard"),
    ),
    CourseSchedule(
        code="PM102",
        class_weekday=4,
        class_start=time(9, 0),
        class_minutes=90,
        video_minutes=35,
        quiz_minutes=15,
        midterm_minutes=75,
        final_minutes=90,
        topics=("Project charter", "Quản trị rủi ro", "Lập kế hoạch sprint", "Retrospective"),
    ),
)


def _local_datetime(day: date, at: time) -> datetime:
    return datetime.combine(day, at, tzinfo=LOCAL_TZ).astimezone(UTC)


def _weekly_dates(weekday: int) -> list[date]:
    current = date(2026, 1, 1)
    current += timedelta(days=(weekday - current.weekday()) % 7)
    result: list[date] = []
    while current <= date(2026, 12, 31):
        result.append(current)
        current += timedelta(days=7)
    return result


def _event_key(event: CalendarEvent) -> tuple[int | None, str, datetime]:
    starts_at = event.starts_at
    if starts_at.tzinfo is None:
        starts_at = starts_at.replace(tzinfo=UTC)
    return event.course_id, event.title, starts_at.astimezone(UTC).replace(microsecond=0)


def _add_event(
    db: Session,
    existing: set[tuple[int | None, str, datetime]],
    *,
    user_id: int,
    course_id: int,
    title: str,
    starts_at: datetime,
    minutes: int,
    kind: str,
) -> None:
    starts_at = starts_at.astimezone(UTC).replace(microsecond=0)
    key = course_id, title, starts_at
    if key in existing:
        return
    event = CalendarEvent(
        user_id=user_id,
        course_id=course_id,
        title=title,
        description=f"{SEED_MARKER}; kind={kind}; duration_minutes={minutes}",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(minutes=minutes),
        event_kind=kind,
        attendance_status="scheduled" if kind == "class_session" else None,
    )
    db.add(event)
    db.flush()
    if kind == "class_session":
        event.join_url = f"/api/calendar/events/{event.id}/join"
    existing.add(key)


def _seed_classes(
    db: Session,
    existing_events: set[tuple[int | None, str, datetime]],
    student: User,
    course: Course,
    schedule: CourseSchedule,
) -> None:
    for week_index, day in enumerate(_weekly_dates(schedule.class_weekday)):
        topic = schedule.topics[week_index % len(schedule.topics)]
        _add_event(
            db,
            existing_events,
            user_id=student.id,
            course_id=course.id,
            title=f"[{course.code}] Ca học online: {topic} · {schedule.class_minutes} phút",
            starts_at=_local_datetime(day, schedule.class_start),
            minutes=schedule.class_minutes,
            kind="class_session",
        )


def _seed_monthly_videos_and_quizzes(
    db: Session,
    existing_events: set[tuple[int | None, str, datetime]],
    student: User,
    course: Course,
    schedule: CourseSchedule,
) -> None:
    resources = {
        item.title
        for item in db.scalars(select(Resource).where(Resource.course_id == course.id)).all()
    }
    quiz_titles = {
        item.title
        for item in db.scalars(
            select(CourseContent).where(
                CourseContent.course_id == course.id,
                CourseContent.kind == "quiz",
            )
        ).all()
    }

    for month in range(1, 13):
        topic = schedule.topics[(month - 1) % len(schedule.topics)]
        video_title = f"Video tháng {month:02d}: {topic} · {schedule.video_minutes} phút"
        if video_title not in resources:
            db.add(
                Resource(
                    course_id=course.id,
                    title=video_title,
                    kind="video",
                    source_url=f"/mock-videos/{course.code.lower()}-2026-{month:02d}.mp4",
                )
            )
            resources.add(video_title)
        video_day = date(2026, month, 5)
        _add_event(
            db,
            existing_events,
            user_id=student.id,
            course_id=course.id,
            title=f"[{course.code}] {video_title}",
            starts_at=_local_datetime(video_day, time(19, 0)),
            minutes=schedule.video_minutes,
            kind="lecture_video",
        )

        quiz_title = f"Quiz tháng {month:02d} · {schedule.quiz_minutes} phút"
        quiz_start = _local_datetime(date(2026, month, 20), time(20, 0))
        if quiz_title not in quiz_titles:
            quiz = CourseContent(
                course_id=course.id,
                kind="quiz",
                title=quiz_title,
                body=f"Kiểm tra ngắn về {topic}. Thời lượng {schedule.quiz_minutes} phút.",
                due_at=quiz_start + timedelta(minutes=schedule.quiz_minutes),
                points_possible=10,
                published=True,
            )
            db.add(quiz)
            db.flush()
            db.add(
                QuizQuestion(
                    quiz_id=quiz.id,
                    prompt=f"Khái niệm nào phù hợp nhất với chủ đề {topic}?",
                    options_json='["A", "B", "C", "D"]',
                    correct_answer="A",
                    points=1,
                    position=1,
                )
            )
            quiz_titles.add(quiz_title)
        _add_event(
            db,
            existing_events,
            user_id=student.id,
            course_id=course.id,
            title=f"[{course.code}] {quiz_title}",
            starts_at=quiz_start,
            minutes=schedule.quiz_minutes,
            kind="quiz",
        )


def _seed_homework(
    db: Session,
    student: User | None,
    course: Course,
    schedule: CourseSchedule,
) -> None:
    existing = {
        item.title: item
        for item in db.scalars(select(Assignment).where(Assignment.course_id == course.id)).all()
    }
    specs = (
        (1, date(2026, 3, 29), 10.0),
        (2, date(2026, 6, 28), 12.0),
        (3, date(2026, 9, 27), 15.0),
        (4, date(2026, 12, 27), 20.0),
    )
    for quarter, due_day, points in specs:
        topic = schedule.topics[(quarter - 1) % len(schedule.topics)]
        title = f"BTVN 2026 Q{quarter}: {topic}"
        assignment = existing.get(title)
        if assignment is None:
            due_at = _local_datetime(due_day, time(23, 59))
            assignment = Assignment(
                course_id=course.id,
                title=title,
                description=(
                    f"Bài tập về nhà chủ đề {topic}. Hạn nộp {due_day:%d/%m/%Y} lúc 23:59. "
                    f"Thời gian dự kiến {int(points * 12)} phút."
                ),
                due_at=due_at,
                points_possible=points,
                published=True,
            )
            db.add(assignment)
            db.flush()
            existing[title] = assignment

        # Keep the demo workspace useful in October: Q1/Q2 are completed,
        # Q3 is visibly overdue, and Q4 remains upcoming for planning.
        if student is not None and quarter <= 2 and not db.scalar(
            select(Submission).where(
                Submission.assignment_id == assignment.id,
                Submission.user_id == student.id,
            )
        ):
            db.add(
                Submission(
                    assignment_id=assignment.id,
                    user_id=student.id,
                    submitted_at=assignment.due_at - timedelta(hours=4),
                    workflow_state="submitted",
                    score=round(points * 0.85, 2),
                    late=False,
                )
            )

    # A dense Q4 term makes the October-to-December planning and recovery
    # workflow realistic without flooding the rest of the demo year.
    q4_specs = (
        ("T10.1", date(2026, 10, 11), 12.0, 0),
        ("T10.2", date(2026, 10, 25), 15.0, 1),
        ("T11.1", date(2026, 11, 8), 15.0, 2),
        ("T11.2", date(2026, 11, 22), 18.0, 3),
        ("T12.1", date(2026, 12, 6), 18.0, 0),
        ("T12.2", date(2026, 12, 27), 20.0, 1),
    )
    for label, due_day, points, topic_index in q4_specs:
        topic = schedule.topics[topic_index]
        title = f"BTVN 2026 {label}: {topic}"
        if title in existing:
            continue
        assignment = Assignment(
            course_id=course.id,
            title=title,
            description=(
                f"Bài tập về nhà chủ đề {topic}. Hạn nộp {due_day:%d/%m/%Y} lúc 23:59. "
                f"Thời gian dự kiến {int(points * 12)} phút."
            ),
            due_at=_local_datetime(due_day, time(23, 59)),
            points_possible=points,
            published=True,
        )
        db.add(assignment)
        existing[title] = assignment

    # Keep each demo course measurably different so switching courses in
    # PaceWise can be verified from task totals and completion metrics.
    course_specific_specs = {
        "DS201": (
            ("Case study: Phân tích dữ liệu bán hàng", date(2026, 11, 29), 24.0, False),
        ),
        "PM102": (
            ("Workshop: Risk response", date(2026, 9, 30), 10.0, True),
            ("Đồ án: Sprint review", date(2026, 12, 20), 25.0, False),
        ),
    }
    for title, due_day, points, completed in course_specific_specs.get(course.code, ()):
        assignment = existing.get(title)
        if assignment is None:
            assignment = Assignment(
                course_id=course.id,
                title=title,
                description=(
                    f"Hoạt động riêng của môn {course.code}. Hạn nộp {due_day:%d/%m/%Y} lúc 23:59. "
                    f"Thời gian dự kiến {int(points * 12)} phút."
                ),
                due_at=_local_datetime(due_day, time(23, 59)),
                points_possible=points,
                published=True,
            )
            db.add(assignment)
            db.flush()
            existing[title] = assignment
        if completed and student is not None and not db.scalar(
            select(Submission).where(
                Submission.assignment_id == assignment.id,
                Submission.user_id == student.id,
            )
        ):
            db.add(
                Submission(
                    assignment_id=assignment.id,
                    user_id=student.id,
                    submitted_at=assignment.due_at - timedelta(hours=6),
                    workflow_state="submitted",
                    score=round(points * 0.9, 2),
                    late=False,
                )
            )


def _seed_exams(
    db: Session,
    existing_events: set[tuple[int | None, str, datetime]],
    calendar_user: User,
    course: Course,
    schedule: CourseSchedule,
    course_index: int,
) -> None:
    exams = (
        (
            "Thi giữa kỳ",
            date(2026, 6, 15 + course_index * 2),
            time(8, 0),
            schedule.midterm_minutes,
            30.0,
        ),
        (
            "Thi cuối kỳ",
            date(2026, 12, 14 + course_index * 2),
            time(8, 0),
            schedule.final_minutes,
            50.0,
        ),
    )
    existing_quizzes = {
        item.title
        for item in db.scalars(
            select(CourseContent).where(
                CourseContent.course_id == course.id,
                CourseContent.kind == "quiz",
            )
        ).all()
    }
    for label, exam_day, starts, minutes, points in exams:
        title = f"{label} 2026 · {minutes} phút"
        exam_start = _local_datetime(exam_day, starts)
        if title not in existing_quizzes:
            exam = CourseContent(
                course_id=course.id,
                kind="quiz",
                title=title,
                body=f"{label} môn {course.code}. Thời lượng {minutes} phút.",
                due_at=exam_start + timedelta(minutes=minutes),
                points_possible=points,
                published=True,
            )
            db.add(exam)
            db.flush()
            db.add(
                QuizQuestion(
                    quiz_id=exam.id,
                    prompt=f"Câu hỏi tổng hợp {label.lower()} môn {course.code}.",
                    options_json='["A", "B", "C", "D"]',
                    correct_answer="A",
                    points=points,
                    position=1,
                )
            )
            existing_quizzes.add(title)
        _add_event(
            db,
            existing_events,
            user_id=calendar_user.id,
            course_id=course.id,
            title=f"[{course.code}] {title}",
            starts_at=exam_start,
            minutes=minutes,
            kind="midterm" if label == "Thi giữa kỳ" else "final_exam",
        )


def _seed_q4_term_events(
    db: Session,
    existing_events: set[tuple[int | None, str, datetime]],
    calendar_user: User,
    course: Course,
    schedule: CourseSchedule,
    course_index: int,
) -> None:
    kickoff_times = (time(8, 0), time(10, 0), time(13, 30))
    _add_event(
        db,
        existing_events,
        user_id=calendar_user.id,
        course_id=course.id,
        title=f"[{course.code}] Ca học online mở đầu học kỳ · {schedule.class_minutes} phút",
        starts_at=_local_datetime(date(2026, 10, 1), kickoff_times[course_index]),
        minutes=schedule.class_minutes,
        kind="class_session",
    )
    _add_event(
        db,
        existing_events,
        user_id=calendar_user.id,
        course_id=course.id,
        title=f"[{course.code}] Ca học online tổng kết năm 2026 · {schedule.class_minutes} phút",
        starts_at=_local_datetime(date(2026, 12, 31), kickoff_times[course_index]),
        minutes=schedule.class_minutes,
        kind="class_session",
    )

    exam_day = date(2026, 11, 9 + course_index * 2)
    exam_start = _local_datetime(exam_day, time(8, 0))
    title = f"Thi giữa kỳ học kỳ 1 năm 2026 · {schedule.midterm_minutes} phút"
    existing_quiz = db.scalar(
        select(CourseContent).where(
            CourseContent.course_id == course.id,
            CourseContent.kind == "quiz",
            CourseContent.title == title,
        )
    )
    if existing_quiz is None:
        exam = CourseContent(
            course_id=course.id,
            kind="quiz",
            title=title,
            body=(
                f"Thi giữa kỳ học kỳ 1 môn {course.code}. "
                f"Thời lượng {schedule.midterm_minutes} phút."
            ),
            due_at=exam_start + timedelta(minutes=schedule.midterm_minutes),
            points_possible=30,
            published=True,
        )
        db.add(exam)
        db.flush()
        db.add(
            QuizQuestion(
                quiz_id=exam.id,
                prompt=f"Câu hỏi tổng hợp giữa kỳ học kỳ 1 môn {course.code}.",
                options_json='["A", "B", "C", "D"]',
                correct_answer="A",
                points=30,
                position=1,
            )
        )
    _add_event(
        db,
        existing_events,
        user_id=calendar_user.id,
        course_id=course.id,
        title=f"[{course.code}] {title}",
        starts_at=exam_start,
        minutes=schedule.midterm_minutes,
        kind="midterm",
    )


def _normalize_seeded_events(events: list[CalendarEvent]) -> None:
    """Migrate existing v1 events without creating duplicate calendar rows."""

    for event in events:
        if not event.description.startswith(SEED_MARKER):
            continue
        kind = next(
            (
                token.split("=", 1)[1].strip()
                for token in event.description.split(";")
                if token.strip().startswith("kind=")
            ),
            "institutional",
        )
        event.event_kind = kind
        if kind == "class_session":
            if "Ca học:" in event.title:
                event.title = event.title.replace("Ca học:", "Ca học online:", 1)
            event.join_url = event.join_url or f"/api/calendar/events/{event.id}/join"
            event.attendance_status = event.attendance_status or "scheduled"


def seed_2026_demo_calendars(db: Session) -> None:
    """Seed repeatable 2026 calendars for the demo student and instructor."""

    student = db.scalar(select(User).where(User.email == PRIMARY_STUDENT_EMAIL))
    calendar_users = db.scalars(select(User).where(User.email.in_(CALENDAR_USER_EMAILS))).all()
    if not calendar_users:
        return
    courses = {
        item.code: item
        for item in db.scalars(
            select(Course).where(Course.code.in_(tuple(item.code for item in COURSE_SCHEDULES)))
        ).all()
    }

    for course_index, schedule in enumerate(COURSE_SCHEDULES):
        course = courses.get(schedule.code)
        if course is None:
            continue
        course.term = "Lịch học demo toàn năm 2026"
        _seed_homework(db, student, course, schedule)

    for calendar_user in calendar_users:
        enrolled_course_ids = set(
            db.scalars(
                select(Enrollment.course_id).where(Enrollment.user_id == calendar_user.id)
            ).all()
        )
        user_events = db.scalars(
            select(CalendarEvent).where(CalendarEvent.user_id == calendar_user.id)
        ).all()
        _normalize_seeded_events(user_events)
        existing_events = {_event_key(item) for item in user_events}

        for course_index, schedule in enumerate(COURSE_SCHEDULES):
            course = courses.get(schedule.code)
            if course is None or course.id not in enrolled_course_ids:
                continue
            _seed_classes(db, existing_events, calendar_user, course, schedule)
            _seed_monthly_videos_and_quizzes(
                db,
                existing_events,
                calendar_user,
                course,
                schedule,
            )
            _seed_exams(
                db,
                existing_events,
                calendar_user,
                course,
                schedule,
                course_index,
            )
            _seed_q4_term_events(
                db,
                existing_events,
                calendar_user,
                course,
                schedule,
                course_index,
            )

    db.commit()
