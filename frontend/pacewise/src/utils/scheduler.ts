import type {
  AvailabilityDay,
  Feasibility,
  PlanDraft,
  PlanInput,
  PreferredTime,
  Task,
  TimeBlock,
  UnavailableSlot,
} from '../types';
import {
  DEMO_NOW,
  DEMO_TODAY,
  WEEK_START,
  addDays,
  diffDays,
  formatDay,
  formatDuration,
  toClock,
  toMin,
  uid,
  weekdayOf,
} from './time';

export interface Interval {
  date: string;
  start: number;
  end: number;
}

const MIN_SLOT = 30;
const MAX_CHUNK = 90;
const BREAK = 10;
export const WEEK_END = addDays(WEEK_START, 6);

function subtract(list: [number, number][], s: number, e: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of list) {
    if (e <= a || s >= b) {
      out.push([a, b]);
      continue;
    }
    if (s > a) out.push([a, s]);
    if (e < b) out.push([e, b]);
  }
  return out;
}

/** Free study intervals on a date: availability − unavailable − already planned blocks − past time. */
export function freeIntervals(
  date: string,
  availability: AvailabilityDay[],
  unavailable: UnavailableSlot[],
  taken: TimeBlock[],
  minLength = 1,
): Interval[] {
  const w = weekdayOf(date);
  const day = availability.find((a) => a.weekday === w);
  if (!day || !day.enabled || toMin(day.end) <= toMin(day.start)) return [];
  let list: [number, number][] = [[toMin(day.start), toMin(day.end)]];
  for (const u of unavailable.filter((x) => x.weekday === w)) list = subtract(list, toMin(u.start), toMin(u.end));
  for (const b of taken.filter((x) => x.date === date)) list = subtract(list, toMin(b.start), toMin(b.end));
  if (date === DEMO_TODAY) list = subtract(list, 0, toMin(DEMO_NOW));
  if (diffDays(DEMO_TODAY, date) < 0) return [];
  return list.filter(([a, b]) => b - a >= minLength).map(([start, end]) => ({ date, start, end }));
}

export function remainingDays(until = WEEK_END) {
  const days: string[] = [];
  for (let d = DEMO_TODAY; diffDays(d, until) >= 0; d = addDays(d, 1)) days.push(d);
  return days;
}

export function totalAvailable(availability: AvailabilityDay[], unavailable: UnavailableSlot[]) {
  return remainingDays().reduce(
    (sum, d) => sum + freeIntervals(d, availability, unavailable, []).reduce((s, i) => s + i.end - i.start, 0),
    0,
  );
}

const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 } as const;
const PREF_WINDOW: Record<PreferredTime, [number, number]> = {
  morning: [0, 720],
  afternoon: [720, 1020],
  evening: [1020, 1440],
};

/** Split intervals at 12:00 and 17:00 and put the preferred part of the day first. */
function orderByPreference(list: Interval[], pref: PreferredTime): Interval[] {
  const parts: Interval[] = [];
  for (const i of list) {
    let cur = i.start;
    for (const cut of [720, 1020, i.end]) {
      if (cut > cur && cut <= i.end) {
        parts.push({ date: i.date, start: cur, end: cut });
        cur = cut;
      }
    }
  }
  const [ps, pe] = PREF_WINDOW[pref];
  const score = (x: Interval) => (x.start >= ps && x.start < pe ? 0 : 1);
  return parts.sort((a, b) => score(a) - score(b) || a.start - b.start);
}

export interface ScheduleResult {
  blocks: TimeBlock[];
  feasibility: Feasibility;
}

/** Deterministic scheduler: earliest deadline first, then priority. Never places work after a deadline. */
export function schedule(input: PlanInput, tasks: Task[]): ScheduleResult {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const selected = input.tasks
    .filter((x) => x.remainingMin > 0 && byId.has(x.taskId))
    .map((x) => ({ ...x, task: byId.get(x.taskId)! }))
    .sort(
      (a, b) =>
        diffDays(b.task.deadline, a.task.deadline) || PRIORITY_WEIGHT[a.task.priority] - PRIORITY_WEIGHT[b.task.priority],
    );

  const free = new Map<string, Interval[]>();
  for (const d of remainingDays()) {
    free.set(d, orderByPreference(freeIntervals(d, input.availability, input.unavailable, [], MIN_SLOT), input.preferred));
  }
  const availableMin = [...free.values()].flat().reduce((s, i) => s + i.end - i.start, 0);

  const blocks: TimeBlock[] = [];
  const shortfalls: Feasibility['shortfalls'] = [];
  for (const item of selected) {
    let left = item.remainingMin;
    const lastDay = diffDays(item.task.deadline, WEEK_END) < 0 ? WEEK_END : item.task.deadline;
    for (const d of remainingDays(lastDay)) {
      const slots = free.get(d) ?? [];
      for (const slot of slots) {
        while (left > 0 && slot.end - slot.start >= Math.min(MIN_SLOT, left)) {
          const chunk = Math.min(left, MAX_CHUNK, slot.end - slot.start);
          blocks.push({ id: uid('blk'), taskId: item.taskId, date: d, start: toClock(slot.start), end: toClock(slot.start + chunk) });
          left -= chunk;
          slot.start = Math.min(slot.end, slot.start + chunk + BREAK);
        }
        if (left <= 0) break;
      }
      if (left <= 0) break;
    }
    if (left > 0) shortfalls.push({ taskId: item.taskId, missingMin: left });
  }

  const requiredMin = selected.reduce((s, x) => s + x.remainingMin, 0);
  const deficitMin = shortfalls.reduce((s, x) => s + x.missingMin, 0);
  blocks.sort((a, b) => diffDays(b.date, a.date) || toMin(a.start) - toMin(b.start));
  return {
    blocks,
    feasibility: {
      availableMin,
      requiredMin,
      remainingMin: availableMin - requiredMin,
      feasible: deficitMin === 0,
      deficitMin,
      shortfalls,
    },
  };
}

export function explainPlan(input: PlanInput, result: ScheduleResult, tasks: Task[]): Pick<PlanDraft, 'reasons' | 'assumptions'> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const chosen = input.tasks.map((x) => byId.get(x.taskId)).filter(Boolean) as Task[];
  const earliest = [...chosen].sort((a, b) => diffDays(b.deadline, a.deadline))[0];
  const prefLabel = { morning: 'buổi sáng', afternoon: 'buổi chiều', evening: 'buổi tối' }[input.preferred];
  const reasons = [
    earliest ? `Deadline gần: “${earliest.title}” hạn ${formatDay(earliest.deadline)} nên được xếp trước.` : '',
    `Phù hợp thời gian rảnh: mọi buổi học nằm trong khung giờ bạn khai báo${
      input.unavailable.length ? `, tránh ${input.unavailable.map((u) => `“${u.label}”`).join(', ')}` : ''
    }.`,
    `Không vượt quỹ thời gian: dùng ${formatDuration(result.feasibility.requiredMin)} trên ${formatDuration(
      result.feasibility.availableMin,
    )}, còn ${formatDuration(Math.max(0, result.feasibility.remainingMin))} dự phòng.`,
    `Ưu tiên ${prefLabel} như bạn chọn khi còn chỗ; mỗi buổi tối đa ${MAX_CHUNK} phút.`,
  ].filter(Boolean);
  const assumptions = input.tasks
    .map((x) => {
      const t = byId.get(x.taskId);
      if (!t) return '';
      return t.estimateIsAssumption ? `Giả định ${t.title} cần khoảng ${formatDuration(x.remainingMin)} (PaceWise ước lượng từ mô tả bài).` : '';
    })
    .filter(Boolean);
  assumptions.push('Chưa tính thời gian di chuyển; giữa hai buổi liên tiếp có 10 phút nghỉ.');
  return { reasons, assumptions };
}

export function validateBlockEdit(
  block: TimeBlock,
  others: TimeBlock[],
  availability: AvailabilityDay[],
): { error?: string; warning?: string } {
  const s = toMin(block.start);
  const e = toMin(block.end);
  if (!block.start || !block.end) return { error: 'Nhập đủ giờ bắt đầu và kết thúc.' };
  if (e <= s) return { error: 'Giờ kết thúc phải sau giờ bắt đầu.' };
  const clash = others.find((o) => o.id !== block.id && o.date === block.date && toMin(o.start) < e && s < toMin(o.end));
  if (clash) return { error: `Khung giờ này trùng với buổi ${clash.start}–${clash.end}.` };
  const day = availability.find((a) => a.weekday === weekdayOf(block.date));
  if (!day?.enabled || s < toMin(day.start) || e > toMin(day.end)) {
    return { warning: 'Khung giờ này nằm ngoài thời gian rảnh bạn đã khai báo.' };
  }
  return {};
}
