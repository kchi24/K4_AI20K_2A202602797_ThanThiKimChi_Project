import type { Clock, Plan } from '../types';
import { DEMO_NOW, DEMO_TODAY, addDays, calendarWeekStart, toMin, weekdayOf } from './time';

export const WEEKLY_REFLECT_DEFAULT_OPEN: Clock = '20:00';
export const WEEKLY_REFLECT_GRACE_END: Clock = '09:00';

export interface WeeklyReflectionCycle {
  weekStart: string;
  weekEnd: string;
  effectiveWeekStart: string;
  opensAt: Clock;
  isOpen: boolean;
  isGracePeriod: boolean;
}

function latestSundayBlockEnd(plan: Plan | null, sunday: string): Clock | null {
  const ends = (plan?.blocks ?? [])
    .filter((block) => block.date === sunday)
    .map((block) => block.end)
    .sort((left, right) => toMin(right) - toMin(left));
  return ends[0] ?? null;
}

/** Resolve the fixed Monday-Sunday reflection period in Asia/Ho_Chi_Minh UI time. */
export function weeklyReflectionCycle(
  plan: Plan | null,
  date = DEMO_TODAY,
  time: Clock = DEMO_NOW,
): WeeklyReflectionCycle {
  const weekday = weekdayOf(date);
  const inMondayGrace = weekday === 0 && toMin(time) < toMin(WEEKLY_REFLECT_GRACE_END);
  const weekStart = inMondayGrace ? addDays(calendarWeekStart(date), -7) : calendarWeekStart(date);
  const weekEnd = addDays(weekStart, 6);
  const lastBlockEnd = latestSundayBlockEnd(plan, weekEnd);
  const opensAt = lastBlockEnd && toMin(lastBlockEnd) > toMin(WEEKLY_REFLECT_DEFAULT_OPEN)
    ? lastBlockEnd
    : WEEKLY_REFLECT_DEFAULT_OPEN;
  const isSundayWindow = weekday === 6 && date === weekEnd && toMin(time) >= toMin(opensAt);

  return {
    weekStart,
    weekEnd,
    effectiveWeekStart: addDays(weekStart, 7),
    opensAt,
    isOpen: inMondayGrace || isSundayWindow,
    isGracePeriod: inMondayGrace,
  };
}
