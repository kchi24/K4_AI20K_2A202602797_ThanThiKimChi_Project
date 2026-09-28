import type { AvailabilityDay, Plan, StudySession, UnavailableSlot } from '../types';
import { WEEK_START } from '../utils/time';

export const defaultAvailability: AvailabilityDay[] = [
  { weekday: 0, enabled: true, start: '14:00', end: '18:00' },
  { weekday: 1, enabled: true, start: '14:00', end: '17:00' },
  { weekday: 2, enabled: true, start: '19:00', end: '21:30' },
  { weekday: 3, enabled: true, start: '14:00', end: '17:00' },
  { weekday: 4, enabled: true, start: '09:00', end: '12:00' },
  { weekday: 5, enabled: false, start: '09:00', end: '11:00' },
  { weekday: 6, enabled: true, start: '14:00', end: '17:00' },
];

export const defaultUnavailable: UnavailableSlot[] = [
  { id: 'un-club', label: 'Họp câu lạc bộ', weekday: 1, start: '15:30', end: '16:00' },
];

/** The plan the student confirmed on Monday. */
export const savedPlan: Plan = {
  id: 'plan-w40',
  weekStart: WEEK_START,
  savedAt: '2026-09-28T08:12:00+07:00',
  version: 1,
  blocks: [
    { id: 'b1', taskId: 't-draft', date: '2026-09-28', start: '14:00', end: '16:00' },
    { id: 'b2', taskId: 't-draft', date: '2026-09-28', start: '16:00', end: '18:00' },
    { id: 'b3', taskId: 't-reading2', date: '2026-09-29', start: '14:00', end: '15:30' },
    { id: 'b4', taskId: 't-lab4', date: '2026-09-29', start: '16:00', end: '17:00' },
    { id: 'b5', taskId: 't-reading2', date: '2026-09-30', start: '19:00', end: '20:30' },
    { id: 'b6', taskId: 't-draft', date: '2026-09-30', start: '20:40', end: '21:30' },
    { id: 'b7', taskId: 't-draft', date: '2026-10-01', start: '14:00', end: '16:00' },
    { id: 'b8', taskId: 't-lab4', date: '2026-10-01', start: '16:00', end: '17:00' },
    { id: 'b9', taskId: 't-draft', date: '2026-10-02', start: '09:00', end: '10:00' },
  ],
};

export const sessions: StudySession[] = [
  { id: 's1', taskId: 't-draft', date: '2026-09-28', minutes: 70, source: 'timer', note: 'Phác thảo bố cục dashboard' },
  { id: 's2', taskId: 't-draft', date: '2026-09-28', minutes: 50, source: 'timer' },
  { id: 's3', taskId: 't-quiz', date: '2026-09-28', minutes: 40, source: 'manual' },
  { id: 's4', taskId: 't-notes', date: '2026-09-28', minutes: 45, source: 'manual' },
];
