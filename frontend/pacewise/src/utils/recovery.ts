import type { AvailabilityDay, DiffItem, Drift, Plan, RecoveryOption, Task, TimeBlock, UnavailableSlot } from '../types';
import { freeIntervals, remainingDays, WEEK_END, type Interval } from './scheduler';
import { sortBlocks } from './progress';
import { addDays, diffDays, durationMin, formatDay, formatDuration, formatRange, isPast, toClock, uid } from './time';

const MAX_FILL_CHUNK = 120;

function freeBetween(from: string, to: string, blocks: TimeBlock[], availability: AvailabilityDay[], unavailable: UnavailableSlot[]) {
  const out: Interval[] = [];
  for (const d of remainingDays(to)) {
    if (diffDays(from, d) < 0) continue;
    out.push(...freeIntervals(d, availability, unavailable, blocks, 30));
  }
  return out;
}

function fill(taskId: string, needMin: number, slots: Interval[]) {
  const added: TimeBlock[] = [];
  let left = needMin;
  for (const s of slots) {
    let cur = s.start;
    while (left > 0 && s.end - cur >= Math.min(30, left)) {
      const chunk = Math.min(left, MAX_FILL_CHUNK, s.end - cur);
      added.push({ id: uid('rec'), taskId, date: s.date, start: toClock(cur), end: toClock(cur + chunk) });
      left -= chunk;
      cur += chunk + 10;
    }
    if (left <= 0) break;
  }
  return { added, placed: needMin - Math.max(0, left) };
}

const describe = (b: { date: string; start: string; end: string }) => `${formatDay(b.date, { relative: true })} ${formatRange(b.start, b.end)}`;

/** Build up to three validated recovery options. Only options that respect availability and deadlines are returned. */
export function buildRecoveryOptions(
  plan: Plan,
  tasks: Task[],
  drift: Drift,
  availability: AvailabilityDay[],
  unavailable: UnavailableSlot[],
): RecoveryOption[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(drift.taskId)!;
  const today = remainingDays()[0];
  const options: RecoveryOption[] = [];

  // A — keep the deadline by using free time before it.
  const slotsA = freeBetween(today, drift.deadline, plan.blocks, availability, unavailable);
  const freeA = slotsA.reduce((s, i) => s + i.end - i.start, 0);
  const a = fill(task.id, drift.deficitMin, slotsA);
  if (a.placed > 0) {
    const full = a.placed >= drift.deficitMin;
    options.push({
      id: 'A',
      title: 'Giữ deadline',
      summary: `Thêm ${formatDuration(a.placed)} cho ${task.title} vào khung giờ còn trống trước deadline.`,
      changes: a.added.map((b) => `Thêm ${task.title} · ${describe(b)}`),
      impact: full
        ? `Bù đủ ${formatDuration(drift.deficitMin)}. Deadline ${formatDay(drift.deadline)} được giữ.`
        : `Chỉ bù được ${formatDuration(a.placed)}, còn thiếu ${formatDuration(drift.deficitMin - a.placed)}.`,
      time: `Thêm ${formatDuration(a.placed)} · thời gian dự phòng còn ${formatDuration(freeA - a.placed)}`,
      tradeoff: 'Dùng hết thời gian trống trước deadline, gần như không còn dự phòng nếu có việc phát sinh.',
      newBlocks: sortBlocks([...plan.blocks, ...a.added]),
      assumptions: [],
      fullyRecovers: full,
    });
  }

  // B — push one lower-priority block to after the deadline, then use the freed slot.
  const weight = { high: 0, medium: 1, low: 2 } as const;
  const candidates = tasks
    .filter((t) => t.id !== task.id && t.status !== 'done' && weight[t.priority] > weight[task.priority])
    .sort((x, y) => weight[y.priority] - weight[x.priority] || diffDays(x.deadline, y.deadline));
  for (const other of candidates) {
    const movable = sortBlocks(plan.blocks).find(
      (b) => b.taskId === other.id && !isPast(b.date, b.start) && diffDays(b.date, drift.deadline) >= 0,
    );
    if (!movable) continue;
    const lastDay = diffDays(other.deadline, WEEK_END) < 0 ? WEEK_END : other.deadline;
    const rest = plan.blocks.filter((b) => b.id !== movable.id);
    const dur = durationMin(movable.start, movable.end);
    const target = freeBetween(addDays(drift.deadline, 1), lastDay, rest, availability, unavailable).find((s) => s.end - s.start >= dur);
    if (!target) continue;
    const moved: TimeBlock = { ...movable, date: target.date, start: toClock(target.start), end: toClock(target.start + dur) };
    const afterMove = [...rest, moved];
    const slotsB = freeBetween(today, drift.deadline, afterMove, availability, unavailable);
    const freeB = slotsB.reduce((s, i) => s + i.end - i.start, 0);
    const b = fill(task.id, drift.deficitMin, slotsB);
    if (b.placed === 0) continue;
    const full = b.placed >= drift.deficitMin;
    const daysLeft = diffDays(moved.date, other.deadline);
    options.push({
      id: 'B',
      title: 'Giãn một task ít ưu tiên',
      summary: `Dời một buổi ${other.title} ra sau deadline của ${task.title} để lấy chỗ học bù.`,
      changes: [`Dời ${other.title} · ${describe(movable)} → ${describe(moved)}`, ...b.added.map((x) => `Thêm ${task.title} · ${describe(x)}`)],
      impact: full
        ? `Bù đủ ${formatDuration(drift.deficitMin)} cho ${task.title}. ${other.title} vẫn trước deadline ${formatDay(other.deadline)}.`
        : `Bù được ${formatDuration(b.placed)}, còn thiếu ${formatDuration(drift.deficitMin - b.placed)}.`,
      time: `Thêm ${formatDuration(b.placed)} · thời gian dự phòng còn ${formatDuration(freeB - b.placed)}`,
      tradeoff: `${other.title} (ưu tiên thấp hơn) làm muộn hơn, ${daysLeft <= 0 ? 'ngay trong ngày deadline' : `còn ${daysLeft} ngày trước deadline`}.`,
      newBlocks: sortBlocks([...afterMove, ...b.added]),
      assumptions: [],
      fullyRecovers: full,
    });
    break;
  }

  // C — keep everything as is.
  options.push({
    id: 'C',
    title: 'Giữ nguyên lịch',
    summary: 'Không thay đổi gì. Bạn tự sắp xếp thời gian bù nếu cần.',
    changes: ['Không có buổi học nào thay đổi'],
    impact: `${task.title} có thể thiếu khoảng ${formatDuration(drift.deficitMin)} trước deadline ${formatDay(drift.deadline)}.`,
    time: `Thiếu khoảng ${formatDuration(drift.deficitMin)}`,
    tradeoff: 'Không phải sắp xếp lại, nhưng nguy cơ trễ deadline cao hơn.',
    newBlocks: plan.blocks,
    assumptions: [],
    fullyRecovers: false,
  });

  return options;
}

export function diffBlocks(before: TimeBlock[], after: TimeBlock[]): DiffItem[] {
  const out: DiffItem[] = [];
  const afterById = new Map(after.map((b) => [b.id, b]));
  const beforeIds = new Set(before.map((b) => b.id));
  for (const b of before) {
    const a = afterById.get(b.id);
    const snap = { date: b.date, start: b.start, end: b.end };
    if (!a) out.push({ type: 'removed', taskId: b.taskId, before: snap });
    else if (a.date !== b.date || a.start !== b.start || a.end !== b.end)
      out.push({ type: 'moved', taskId: b.taskId, before: snap, after: { date: a.date, start: a.start, end: a.end } });
    else out.push({ type: 'unchanged', taskId: b.taskId, before: snap, after: snap });
  }
  for (const a of after) {
    if (!beforeIds.has(a.id)) out.push({ type: 'added', taskId: a.taskId, after: { date: a.date, start: a.start, end: a.end } });
  }
  const key = (d: DiffItem) => (d.after ?? d.before)!;
  return out.sort((x, y) => diffDays(key(y).date, key(x).date) || key(x).start.localeCompare(key(y).start));
}
