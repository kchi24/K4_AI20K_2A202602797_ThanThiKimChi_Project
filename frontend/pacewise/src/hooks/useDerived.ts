import { useMemo } from 'react';
import { useAppStore } from '../store/AppStore';
import { detectDrift, nextAction, weekStats } from '../utils/progress';
import type { Course, Plan, StudySession, Task } from '../types';

export function buildCourseScope(
  activeCourseId: string | undefined,
  tasks: Task[],
  sessions: StudySession[],
  plan: Plan | null,
) {
  const activeTasks = activeCourseId
    ? tasks.filter((task) => task.courseId === activeCourseId)
    : tasks;
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  return {
    activeTasks,
    activeSessions: sessions.filter((session) => activeTaskIds.has(session.taskId)),
    activePlan: plan
      ? { ...plan, blocks: plan.blocks.filter((block) => activeTaskIds.has(block.taskId)) }
      : null,
  };
}

/** Derived, read-only view of the store used by many pages. */
export function useDerived() {
  const { state } = useAppStore();
  return useMemo(() => {
    const taskById = new Map<string, Task>(state.tasks.map((t) => [t.id, t]));
    const courseById = new Map<string, Course>(state.courses.map((c) => [c.id, c]));
    const drifts = detectDrift(state.plan, state.tasks).filter((d) => !state.dismissedDrifts.includes(d.taskId));
    const activeCourseId = state.user?.courseId;
    const { activeTasks, activeSessions, activePlan } = buildCourseScope(
      activeCourseId,
      state.tasks,
      state.sessions,
      state.plan,
    );
    const activeDrifts = detectDrift(activePlan, activeTasks)
      .filter((drift) => !state.dismissedDrifts.includes(drift.taskId));
    return {
      taskById,
      courseById,
      courseOf: (taskId: string) => courseById.get(taskById.get(taskId)?.courseId ?? ''),
      drifts,
      next: nextAction(state.plan, state.tasks, drifts),
      stats: weekStats(state.tasks, state.sessions, state.plan),
      activeCourse: activeCourseId ? courseById.get(activeCourseId) : undefined,
      activeTasks,
      activeSessions,
      activePlan,
      activeDrifts,
      activeNext: nextAction(activePlan, activeTasks, activeDrifts),
      activeStats: weekStats(activeTasks, activeSessions, activePlan),
    };
  }, [state.tasks, state.courses, state.plan, state.sessions, state.dismissedDrifts, state.user?.courseId]);
}
