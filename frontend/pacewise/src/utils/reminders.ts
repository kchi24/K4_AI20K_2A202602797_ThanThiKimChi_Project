import type {
  Course,
  LMSCourseData,
  Plan,
  PlanImpact,
  Reminder,
  ReminderState,
  StudySession,
  Task,
  TimeBlock,
} from '../types';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;
const APP_OFFSET = '+07:00';

interface BuildReminderInput {
  now: Date;
  plan: Plan | null;
  tasks: Task[];
  courses: Course[];
  courseData: Record<string, LMSCourseData>;
  sessions: StudySession[];
  planImpacts: PlanImpact[];
  studyBlockLeadMinutes?: number;
  digestHour?: number;
}

function localDateTime(date: string, clock: string): Date {
  return new Date(`${date}T${clock}:00${APP_OFFSET}`);
}

function dueDate(task: Task): Date {
  return task.dueAt ? new Date(task.dueAt) : localDateTime(task.deadline, '23:59');
}

function minutes(block: TimeBlock): number {
  const [startHour, startMinute] = block.start.split(':').map(Number);
  const [endHour, endMinute] = block.end.split(':').map(Number);
  return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
}

function submitted(task: Task): boolean {
  const state = task.submission?.state.toLowerCase();
  return task.status === 'done'
    || Boolean(task.submission?.submittedAt)
    || Boolean(task.submission?.attempts)
    || state === 'submitted'
    || state === 'graded';
}

function courseLabel(task: Task, courses: Course[]): string {
  return courses.find((course) => course.id === task.courseId)?.code ?? task.courseId;
}

function reminder(input: Omit<Reminder, 'scheduledAt' | 'expiresAt'> & { scheduledAt: Date; expiresAt: Date }): Reminder {
  return {
    ...input,
    scheduledAt: input.scheduledAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  };
}

function deadlineReminder(
  task: Task,
  courses: Course[],
  hoursBefore: 72 | 24 | 2,
  urgency: Reminder['urgency'],
): Reminder {
  const due = dueDate(task);
  const scheduledAt = new Date(due.getTime() - hoursBefore * HOUR);
  const nextThreshold = hoursBefore === 72 ? 24 : hoursBefore === 24 ? 2 : 0;
  const expiresAt = nextThreshold
    ? new Date(due.getTime() - nextThreshold * HOUR)
    : new Date(due.getTime() + 2 * HOUR);
  const course = courseLabel(task, courses);
  const title = hoursBefore === 2 ? `Khẩn: ${task.title}` : `${task.title} còn ${hoursBefore} giờ`;
  const message = hoursBefore === 72
    ? `${course}: bạn chưa bắt đầu hoặc lịch hiện tại chưa đủ ${Math.max(0, task.estimateMin - task.loggedMin)} phút còn lại.`
    : hoursBefore === 24
      ? `${course}: nhiệm vụ chưa hoàn thành. Hãy kiểm tra study block còn lại trước deadline.`
      : `${course}: LMS chưa ghi nhận bài nộp. Hãy nộp bài hoặc mở Phục hồi ngay.`;
  return reminder({
    id: `deadline-${hoursBefore}h:${task.id}:${due.toISOString()}`,
    kind: `deadline_${hoursBefore}h` as Reminder['kind'],
    title,
    message,
    scheduledAt,
    expiresAt,
    urgency,
    courseId: task.courseId,
    taskId: task.id,
    href: hoursBefore === 2 ? `/recover?taskId=${encodeURIComponent(task.id)}&courseId=${encodeURIComponent(task.courseId)}` : `/study/${encodeURIComponent(task.id)}`,
  });
}

function localDateKey(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDeadlineReminders(
  result: Reminder[],
  task: Task,
  courses: Course[],
  plan: Plan | null,
  now: Date,
): void {
  if (submitted(task)) return;
  const due = dueDate(task);
  if (due.getTime() < now.getTime() - 2 * HOUR) return;

  const remaining = Math.max(0, task.estimateMin - task.loggedMin);
  const futurePlanned = (plan?.blocks ?? [])
    .filter((block) => block.taskId === task.id)
    .filter((block) => {
      const startsAt = localDateTime(block.date, block.start);
      return startsAt >= now && startsAt < due;
    })
    .reduce((sum, block) => sum + minutes(block), 0);

  if (task.loggedMin === 0 || futurePlanned < remaining) {
    result.push(deadlineReminder(task, courses, 72, 'normal'));
  }
  if (task.status !== 'done') result.push(deadlineReminder(task, courses, 24, 'urgent'));
  result.push(deadlineReminder(task, courses, 2, 'critical'));
}

function addStudyBlockReminders(
  result: Reminder[],
  plan: Plan | null,
  tasks: Task[],
  sessions: StudySession[],
  leadMinutes: number,
  now: Date,
): void {
  if (!plan) return;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const sessionMinutes = new Map<string, number>();
  sessions.forEach((session) => sessionMinutes.set(session.taskId, (sessionMinutes.get(session.taskId) ?? 0) + session.minutes));

  plan.blocks.forEach((block) => {
    const task = taskById.get(block.taskId);
    if (!task || submitted(task)) return;
    const startsAt = localDateTime(block.date, block.start);
    const endsAt = localDateTime(block.date, block.end);
    if (endsAt.getTime() < now.getTime() - 2 * DAY || startsAt.getTime() > now.getTime() + 15 * DAY) return;
    result.push(reminder({
      id: `study-block:${block.id}:${startsAt.toISOString()}`,
      kind: 'study_block',
      title: `Sắp đến ca học: ${task.title}`,
      message: `Bắt đầu lúc ${block.start}, kéo dài ${minutes(block)} phút.`,
      scheduledAt: new Date(startsAt.getTime() - leadMinutes * MINUTE),
      expiresAt: new Date(startsAt.getTime() + 15 * MINUTE),
      urgency: 'normal',
      courseId: task.courseId,
      taskId: task.id,
      href: `/study/${encodeURIComponent(task.id)}/session?blockId=${encodeURIComponent(block.id)}`,
    }));

    if (endsAt > now) return;
    const expectedThroughBlock = plan.blocks
      .filter((item) => item.taskId === task.id && localDateTime(item.date, item.end) <= endsAt)
      .reduce((sum, item) => sum + minutes(item), 0);
    const actual = Math.max(task.loggedMin, sessionMinutes.get(task.id) ?? 0);
    if (actual + 10 >= expectedThroughBlock) return;
    result.push(reminder({
      id: `missed-block:${block.id}:${endsAt.toISOString()}`,
      kind: 'missed_block',
      title: `Ca học đã bị lỡ: ${task.title}`,
      message: `Tiến độ thiếu ${expectedThroughBlock - actual} phút so với kế hoạch. Mở Phục hồi để xếp lại trước deadline.`,
      scheduledAt: endsAt,
      expiresAt: new Date(endsAt.getTime() + 48 * HOUR),
      urgency: 'urgent',
      courseId: task.courseId,
      taskId: task.id,
      href: `/recover?taskId=${encodeURIComponent(task.id)}&courseId=${encodeURIComponent(task.courseId)}`,
    }));
  });
}

function eventRule(kind: string): { leadMinutes: number; reminderKind: Reminder['kind']; urgency: Reminder['urgency']; label: string }[] {
  if (kind === 'class') return [{ leadMinutes: 10, reminderKind: 'online_class', urgency: 'normal', label: 'Buổi học tại lớp' }];
  if (kind === 'class_session') return [{ leadMinutes: 10, reminderKind: 'online_class', urgency: 'normal', label: 'Buổi học online' }];
  if (kind === 'quiz') return [{ leadMinutes: 30, reminderKind: 'quiz', urgency: 'urgent', label: 'Quiz' }];
  if (kind === 'midterm' || kind === 'final_exam') {
    return [
      { leadMinutes: 24 * 60, reminderKind: 'exam_24h', urgency: 'urgent', label: kind === 'midterm' ? 'Thi giữa kỳ' : 'Thi cuối kỳ' },
      { leadMinutes: 60, reminderKind: 'exam_60m', urgency: 'critical', label: kind === 'midterm' ? 'Thi giữa kỳ' : 'Thi cuối kỳ' },
    ];
  }
  return [];
}

function addLmsEventReminders(result: Reminder[], courseData: Record<string, LMSCourseData>, now: Date): void {
  Object.values(courseData).forEach((data) => {
    (data.calendarItems ?? []).forEach((item) => {
      if (item.type !== 'event') return;
      const startsAt = new Date(item.starts_at);
      if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < now.getTime() - DAY || startsAt.getTime() > now.getTime() + 15 * DAY) return;
      eventRule(item.event_kind).forEach((rule) => {
        result.push(reminder({
          id: `${rule.reminderKind}:${item.id}:${startsAt.toISOString()}`,
          kind: rule.reminderKind,
          title: `${rule.label}: ${item.title}`,
          message: `Bắt đầu lúc ${startsAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}.`,
          scheduledAt: new Date(startsAt.getTime() - rule.leadMinutes * MINUTE),
          expiresAt: new Date(startsAt.getTime() + 15 * MINUTE),
          urgency: rule.urgency,
          courseId: item.course_id == null ? undefined : String(item.course_id),
          href: '/plan',
        }));
      });
    });
  });
}

function addPlanImpactReminders(result: Reminder[], impacts: PlanImpact[]): void {
  impacts
    .filter((impact) => ['schedule_conflict', 'deadline_earlier', 'assignment_added'].includes(impact.kind))
    .forEach((impact) => {
      const detectedAt = new Date(impact.detectedAt);
      result.push(reminder({
        id: `lms-change:${impact.id}`,
        kind: 'lms_change',
        title: impact.title,
        message: `${impact.message} Hãy xem bản đề xuất Phục hồi trước khi thay đổi kế hoạch.`,
        scheduledAt: Number.isNaN(detectedAt.getTime()) ? new Date() : detectedAt,
        expiresAt: new Date((Number.isNaN(detectedAt.getTime()) ? Date.now() : detectedAt.getTime()) + 14 * DAY),
        urgency: impact.kind === 'deadline_earlier' ? 'critical' : 'urgent',
        courseId: impact.courseId,
        taskId: impact.taskId,
        href: `/recover?impactId=${encodeURIComponent(impact.id)}${impact.taskId ? `&taskId=${encodeURIComponent(impact.taskId)}` : ''}`,
      }));
    });
}

function addEveningDigest(result: Reminder[], now: Date, digestHour: number): void {
  const today = localDateKey(now);
  const scheduledAt = localDateTime(today, `${String(digestHour).padStart(2, '0')}:00`);
  const horizon = new Date(scheduledAt.getTime() + 28 * HOUR);
  const candidates = result.filter((item) => {
    const at = new Date(item.scheduledAt);
    return item.urgency === 'normal' && at > scheduledAt && at <= horizon;
  });
  if (!candidates.length) return;
  const preview = candidates.slice(0, 2).map((item) => item.title).join('; ');
  result.push(reminder({
    id: `evening-digest:${today}`,
    kind: 'evening_digest',
    title: `Tóm tắt ngày mai · ${candidates.length} việc cần chú ý`,
    message: `${preview}${candidates.length > 2 ? `; và ${candidates.length - 2} việc khác` : ''}.`,
    scheduledAt,
    expiresAt: new Date(scheduledAt.getTime() + 4 * HOUR),
    urgency: 'normal',
    href: '/plan',
  }));
}

export function buildReminders({
  now,
  plan,
  tasks,
  courses,
  courseData,
  sessions,
  planImpacts,
  studyBlockLeadMinutes = 15,
  digestHour = 20,
}: BuildReminderInput): Reminder[] {
  const result: Reminder[] = [];
  tasks.forEach((task) => addDeadlineReminders(result, task, courses, plan, now));
  addStudyBlockReminders(result, plan, tasks, sessions, studyBlockLeadMinutes, now);
  addLmsEventReminders(result, courseData, now);
  addPlanImpactReminders(result, planImpacts);
  addEveningDigest(result, now, digestHour);
  return [...new Map(result.map((item) => [item.id, item])).values()]
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}

export function activeReminders(reminders: Reminder[], now: Date): Reminder[] {
  const at = now.getTime();
  return reminders
    .filter((item) => new Date(item.scheduledAt).getTime() <= at && new Date(item.expiresAt).getTime() >= at)
    .sort((left, right) => {
      const rank = { critical: 0, urgent: 1, normal: 2 };
      return rank[left.urgency] - rank[right.urgency] || left.scheduledAt.localeCompare(right.scheduledAt);
    });
}

/** Enforce the proactive-notification cap without hiding reminders from the in-app centre. */
export function selectBrowserDeliveries(
  reminders: Reminder[],
  state: ReminderState,
  now: Date,
): Reminder[] {
  if (!state.preferences.enabled || !state.preferences.browserEnabled) return [];
  const today = localDateKey(now);
  const deliveredToday = Object.values(state.deliveredAt)
    .filter((value) => localDateKey(new Date(value)) === today)
    .length;
  const available = Math.max(0, state.preferences.dailyCap - deliveredToday);
  if (!available) return [];
  return activeReminders(reminders, now)
    .filter((item) => !state.deliveredAt[item.id])
    .slice(0, available);
}
