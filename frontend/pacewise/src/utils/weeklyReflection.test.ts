import { describe, expect, it } from 'vitest';
import type { Plan } from '../types';
import { weeklyReflectionCycle } from './weeklyReflection';

const planWithSundayBlock = (end: string): Plan => ({
  id: 'plan-1',
  weekStart: '2026-09-28',
  savedAt: '2026-10-01T00:00:00Z',
  version: 1,
  blocks: [{ id: 'block-1', taskId: 'task-1', date: '2026-10-04', start: '19:30', end }],
});

describe('weeklyReflectionCycle', () => {
  it('uses a fixed Monday to Sunday period', () => {
    const cycle = weeklyReflectionCycle(null, '2026-10-03', '12:00');
    expect(cycle).toMatchObject({
      weekStart: '2026-09-28',
      weekEnd: '2026-10-04',
      effectiveWeekStart: '2026-10-05',
      isOpen: false,
    });
  });

  it('opens Sunday at 20:00 by default', () => {
    expect(weeklyReflectionCycle(null, '2026-10-04', '19:59').isOpen).toBe(false);
    expect(weeklyReflectionCycle(null, '2026-10-04', '20:00').isOpen).toBe(true);
  });

  it('waits for the final Sunday study block', () => {
    const plan = planWithSundayBlock('21:00');
    expect(weeklyReflectionCycle(plan, '2026-10-04', '20:30')).toMatchObject({
      opensAt: '21:00',
      isOpen: false,
    });
    expect(weeklyReflectionCycle(plan, '2026-10-04', '21:00').isOpen).toBe(true);
  });

  it('keeps the previous week open until Monday 09:00', () => {
    expect(weeklyReflectionCycle(null, '2026-10-05', '08:59')).toMatchObject({
      weekStart: '2026-09-28',
      weekEnd: '2026-10-04',
      isOpen: true,
      isGracePeriod: true,
    });
    expect(weeklyReflectionCycle(null, '2026-10-05', '09:00')).toMatchObject({
      weekStart: '2026-10-05',
      isOpen: false,
    });
  });
});
