import { useMemo } from 'react';
import { useAppStore } from '../store/AppStore';
import { detectDrift, nextAction, weekStats } from '../utils/progress';
import type { Course, Task } from '../types';

/** Derived, read-only view of the store used by many pages. */
export function useDerived() {
  const { state } = useAppStore();
  return useMemo(() => {
    const taskById = new Map<string, Task>(state.tasks.map((t) => [t.id, t]));
    const courseById = new Map<string, Course>(state.courses.map((c) => [c.id, c]));
    const drifts = detectDrift(state.plan, state.tasks).filter((d) => !state.dismissedDrifts.includes(d.taskId));
    return {
      taskById,
      courseById,
      courseOf: (taskId: string) => courseById.get(taskById.get(taskId)?.courseId ?? ''),
      drifts,
      next: nextAction(state.plan, state.tasks, drifts),
      stats: weekStats(state.tasks, state.sessions, state.plan),
    };
  }, [state.tasks, state.courses, state.plan, state.sessions, state.dismissedDrifts]);
}
