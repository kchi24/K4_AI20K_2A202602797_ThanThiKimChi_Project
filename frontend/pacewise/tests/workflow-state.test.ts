import { describe, expect, it } from 'vitest';

import { initialState, reducer } from '../src/store/AppStore';
import type { Task } from '../src/types';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: '1:10',
  courseId: '1',
  title: 'Assignment',
  deadline: '2026-10-10',
  estimateMin: 60,
  loggedMin: 0,
  status: 'todo',
  priority: 'medium',
  objective: 'Test persistence',
  ...overrides,
});

describe('durable learner workflow state', () => {
  it('reapplies saved progress to a fresh LMS task snapshot', () => {
    const hydrated = reducer(initialState, {
      type: 'HYDRATE_WORKSPACE',
      state: {
        taskProgress: {
          '1:10': {
            estimateMin: 120,
            loggedMin: 45,
            status: 'in_progress',
            updatedAt: '2026-10-02T08:00:00Z',
          },
        },
      },
    });

    const synced = reducer(hydrated, { type: 'SYNC_CANVAS', tasks: [task()] });

    expect(synced.tasks[0]).toMatchObject({
      estimateMin: 120,
      loggedMin: 45,
      status: 'in_progress',
    });
  });

  it('keeps reflections isolated by course', () => {
    const first = reducer(initialState, {
      type: 'SAVE_REFLECTION',
      courseId: '1',
      answers: ['A', 'B', 'C'],
    });
    const second = reducer(first, {
      type: 'SAVE_REFLECTION',
      courseId: '2',
      answers: ['D', 'E', 'F'],
    });

    expect(second.reflections['1'].answers).toEqual(['A', 'B', 'C']);
    expect(second.reflections['2'].answers).toEqual(['D', 'E', 'F']);
  });

  it('applies the teacher resolution returned by synchronization', () => {
    const state = {
      ...initialState,
      quickChecks: [{
        id: 'qc-1',
        topic: 'Regression',
        question: 'Explain overfitting',
        answer: 'Answer',
        evidenceState: 'abstained' as const,
        confidence: 'low' as const,
        feedback: 'Waiting for review',
        submittedAt: '08:00',
        reviewItemId: 'AR-1',
      }],
    };

    const synced = reducer(state, {
      type: 'SYNC_CANVAS',
      tasks: [],
      reviewResolutions: {
        'AR-1': {
          status: 'edited',
          note: 'Đã đối chiếu bằng chứng.',
          resolvedStatus: 'thể hiện hiểu biết',
        },
      },
    });

    expect(synced.quickChecks[0]).toMatchObject({
      evidenceState: 'demonstrated',
      instructorNote: 'Đã đối chiếu bằng chứng.',
    });
  });
});
