import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateDoSession, prepareDoSession } from '../src/services/api';

afterEach(() => vi.unstubAllGlobals());

describe('Do Agent API', () => {
  it('prepares a confirmed study block with course-scoped resources', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.workflow).toBe('do');
      expect(payload.context.do_course_id).toBe('1');
      expect(payload.context.do_block_id).toBe('block-1');
      expect(payload.context.progress_metrics.do_session.action).toBe('prepare');
      return new Response(JSON.stringify({
        response: 'Sẵn sàng', workflow: 'do', status: 'completed', source_refs: [],
        output: { do_session: {
          action: 'prepare', status: 'ready', block_id: 'block-1', task_id: '1:7', title: 'Vòng lặp',
          objective: 'Ôn vòng lặp', planned_minutes: 45, recommended_resources: [], opening_prompt: 'Hãy hỏi khi cần.',
        } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(prepareDoSession({ courseId: '1', blockId: 'block-1', taskId: '1:7', title: 'Vòng lặp', objective: 'Ôn vòng lặp', plannedMinutes: 45 }))
      .resolves.toMatchObject({ action: 'prepare', block_id: 'block-1' });
  });

  it('returns a structured completion evaluation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      response: 'Mở Recover', workflow: 'do', status: 'completed', source_refs: [],
      output: { do_session: {
        action: 'complete', status: 'needs_more_time', block_id: 'block-1', task_id: '1:7',
        planned_minutes: 60, actual_minutes: 70, variance_minutes: 10, completion_percent: 50,
        remaining_minutes: 30, blocker: 'time', blocker_note: '', needs_recovery: true,
        needs_understanding_check: false, next_action: 'Mở Recover',
      } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(evaluateDoSession({ courseId: '1', blockId: 'block-1', taskId: '1:7', plannedMinutes: 60, actualMinutes: 70, completionPercent: 50, blocker: 'time' }))
      .resolves.toMatchObject({ action: 'complete', status: 'needs_more_time', needs_recovery: true });
  });
});
