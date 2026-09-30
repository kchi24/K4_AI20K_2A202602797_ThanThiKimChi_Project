import type { Clock, Weekday } from '../types';

const runtimeNow = new Date();
const localDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const monday = new Date(runtimeNow);
monday.setHours(0, 0, 0, 0);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

/** Runtime clock aliases retained to avoid breaking existing domain helpers. */
export const DEMO_TODAY = localDate(runtimeNow);
export const DEMO_NOW: Clock = `${String(runtimeNow.getHours()).padStart(2, '0')}:${String(runtimeNow.getMinutes()).padStart(2, '0')}`;
export const WEEK_START = localDate(monday);
export const TIMEZONE_LABEL = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';

const WEEKDAY_LONG = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export const toMin = (c: Clock) => {
  const [h, m] = c.split(':').map(Number);
  return h * 60 + m;
};
export const toClock = (min: number): Clock => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
export const durationMin = (start: Clock, end: Clock) => toMin(end) - toMin(start);

function parse(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(date: string, n: number) {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string) {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}
/** 0 = Monday */
export function weekdayOf(date: string): Weekday {
  return ((parse(date).getUTCDay() + 6) % 7) as Weekday;
}
export const weekDates = (weekStart = WEEK_START) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

export const weekdayName = (w: Weekday) => WEEKDAY_LONG[w];
export const weekdayShort = (w: Weekday) => WEEKDAY_SHORT[w];

export function formatDM(date: string) {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}
export function formatDay(date: string, opts: { relative?: boolean; short?: boolean } = {}) {
  if (opts.relative) {
    const delta = diffDays(DEMO_TODAY, date);
    if (delta === 0) return 'Hôm nay';
    if (delta === 1) return 'Ngày mai';
    if (delta === -1) return 'Hôm qua';
  }
  const w = weekdayOf(date);
  return `${opts.short ? WEEKDAY_SHORT[w] : WEEKDAY_LONG[w]} ${formatDM(date)}`;
}
export const formatRange = (start: Clock, end: Clock) => `${start}–${end}`;
export const formatDeadline = (date: string) => `${formatDay(date)}, 23:59`;

export function formatDuration(min: number) {
  const sign = min < 0 ? '−' : '';
  const v = Math.abs(Math.round(min));
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (h === 0) return `${sign}${m} phút`;
  if (m === 0) return `${sign}${h} giờ`;
  return `${sign}${h} giờ ${m} phút`;
}
export const formatHours = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h).replace('.', ',')} giờ`;
};

export function daysUntil(date: string) {
  return diffDays(DEMO_TODAY, date);
}

/** Return whether the supplied date/time has passed in the user's local clock. */
export function isPast(date: string, clock: Clock) {
  const d = diffDays(DEMO_TODAY, date);
  if (d < 0) return true;
  if (d > 0) return false;
  return toMin(clock) <= toMin(DEMO_NOW);
}

export function formatTimer(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
}

export function nowStamp() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
