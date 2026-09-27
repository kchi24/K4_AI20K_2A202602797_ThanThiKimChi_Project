import type { Drift, Plan, StudySession, Task, TimeBlock } from '../types';
import { DEMO_NOW, DEMO_TODAY, WEEK_START, addDays, daysUntil, diffDays, durationMin, formatDuration, isPast, toMin } from './time';

const DRIFT_THRESHOLD_MIN = 60;

export const remainingOf = (t: Task) => Math.max(0, t.estimateMin - t.loggedMin);

export function sortBlocks(blocks: TimeBlock[]) {
  return [...blocks].sort((a, b) => diffDays(b.date, a.date) || toMin(a.start) - toMin(b.start));
}

/** Tasks whose logged time is well below what the saved plan expected by now. */
export function detectDrift(plan: Plan | null, tasks: Task[]): Drift[] {
  if (!plan) return [];
  const out: Drift[] = [];
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const mine = plan.blocks.filter((b) => b.taskId === t.id);
    const expected = mine.filter((b) => isPast(b.date, b.end)).reduce((s, b) => s + durationMin(b.start, b.end), 0);
    const futurePlanned = mine.filter((b) => !isPast(b.date, b.end)).reduce((s, b) => s + durationMin(b.start, b.end), 0);
    const behind = expected - t.loggedMin;
    // Drift = behind the plan so far AND the rest of the plan no longer covers the remaining work.
    const shortfall = remainingOf(t) - futurePlanned;
    if (behind >= DRIFT_THRESHOLD_MIN && shortfall > 0) {
      out.push({ taskId: t.id, expectedMin: expected, loggedMin: t.loggedMin, deficitMin: shortfall, deadline: t.deadline });
    }
  }
  return out.sort((a, b) => b.deficitMin - a.deficitMin);
}

export interface NextAction {
  task: Task;
  block: TimeBlock;
  reason: string;
}

export function nextAction(plan: Plan | null, tasks: Task[], drifts: Drift[]): NextAction | null {
  if (!plan) return null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const upcoming = sortBlocks(plan.blocks).find((b) => {
    const t = byId.get(b.taskId);
    return t && t.status !== 'done' && !isPast(b.date, b.end);
  });
  if (!upcoming) return null;
  const task = byId.get(upcoming.taskId)!;
  const d = daysUntil(task.deadline);
  const first = d <= 0 ? 'Deadline là hôm nay' : `Deadline còn ${d} ngày`;
  const drift = drifts.find((x) => x.taskId === task.id);
  let second: string;
  if (task.loggedMin === 0) second = 'bạn chưa có phiên học nào cho task này';
  else if (drift) second = `task này đang trễ khoảng ${formatDuration(drift.deficitMin)} so với kế hoạch`;
  else second = `còn khoảng ${formatDuration(remainingOf(task))} cần hoàn thành`;
  return { task, block: upcoming, reason: `${first} và ${second}.` };
}

export function isInWeek(date: string) {
  const d = diffDays(WEEK_START, date);
  return d >= 0 && d <= 6;
}

export function weekStats(tasks: Task[], sessions: StudySession[], plan: Plan | null) {
  const weekTasks = tasks.filter((t) => isInWeek(t.deadline) || t.status !== 'done');
  const done = weekTasks.filter((t) => t.status === 'done').length;
  const weekSessions = sessions.filter((s) => isInWeek(s.date));
  const studiedMin = weekSessions.reduce((s, x) => s + x.minutes, 0);
  const plannedMin = plan ? plan.blocks.reduce((s, b) => s + durationMin(b.start, b.end), 0) : 0;
  const plannedUntilNow = plan
    ? plan.blocks.filter((b) => isPast(b.date, b.end)).reduce((s, b) => s + durationMin(b.start, b.end), 0)
    : 0;
  return {
    total: weekTasks.length,
    done,
    remaining: weekTasks.length - done,
    sessionCount: weekSessions.length,
    studiedMin,
    plannedMin,
    plannedUntilNow,
  };
}

export const todayLabel = () => ({ date: DEMO_TODAY, time: DEMO_NOW, tomorrow: addDays(DEMO_TODAY, 1) });
