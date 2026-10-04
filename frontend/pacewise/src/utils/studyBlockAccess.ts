import type { TimeBlock } from '../types';

export const STUDY_BLOCK_EARLY_ACCESS_MINUTES = 5;

export type StudyBlockAccess =
  | { state: 'too_early'; opensAt: number; startsAt: number; endsAt: number }
  | { state: 'available'; opensAt: number; startsAt: number; endsAt: number }
  | { state: 'ended'; opensAt: number; startsAt: number; endsAt: number };

const inVietnam = (date: string, clock: string) => new Date(`${date}T${clock}:00+07:00`).getTime();

/** Gate a planned study block without hiding it from the historical calendar. */
export function studyBlockAccess(block: Pick<TimeBlock, 'date' | 'start' | 'end'>, now = Date.now()): StudyBlockAccess {
  const startsAt = inVietnam(block.date, block.start);
  const endsAt = inVietnam(block.date, block.end);
  const opensAt = startsAt - STUDY_BLOCK_EARLY_ACCESS_MINUTES * 60_000;

  if (now < opensAt) return { state: 'too_early', opensAt, startsAt, endsAt };
  if (now >= endsAt) return { state: 'ended', opensAt, startsAt, endsAt };
  return { state: 'available', opensAt, startsAt, endsAt };
}

export function minutesUntil(timestamp: number, now = Date.now()) {
  return Math.max(0, Math.ceil((timestamp - now) / 60_000));
}
