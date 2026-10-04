import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Course, Task } from '../../types';
import type { PlanTimelineItem } from '../../utils/planTimeline';
import { PlanCalendarBoard, positionCalendarItems } from './PlanCalendarBoard';

const course: Course = { id: '1', code: 'CS101', name: 'Python', tone: 'primary' };
const task: Task = {
  id: 'task-1', title: 'Mini project', courseId: '1', deadline: '2026-10-10', estimateMin: 120,
  loggedMin: 0, status: 'todo', priority: 'high', objective: 'Hoàn thành bài',
};
const item: PlanTimelineItem = {
  id: 'pacewise:block-1', entityId: 'block-1', taskId: 'task-1', source: 'pacewise', title: 'Mini project',
  date: '2026-10-05', start: '19:00', end: '20:00', durationMin: 60, courseCode: 'CS101',
  kind: 'study_block', kindLabel: 'Study block', readOnly: false,
};
const deadline: PlanTimelineItem = {
  id: 'lms:deadline:task-1', source: 'lms', title: 'Deadline · Mini project', date: '2026-10-05',
  start: '19:30', durationMin: 0, courseCode: 'CS101', kind: 'assignment', kindLabel: 'Deadline', readOnly: true,
};

describe('PlanCalendarBoard', () => {
  it('presents read-only LMS task selection and the positioned study block', () => {
    Object.defineProperty(window, 'PointerEvent', { configurable: true, writable: true, value: MouseEvent });
    const onResizeBlock = vi.fn();
    const onOpenBlock = vi.fn();
    render(
      <PlanCalendarBoard
        dates={['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']}
        courses={[course]}
        tasks={[task]}
        items={[item, deadline]}
        draftMode
        onMoveBlock={vi.fn()}
        onResizeBlock={onResizeBlock}
        onResizeBusy={vi.fn()}
        onAddBusy={vi.fn()}
        onOpenPersonal={vi.fn()}
        onOpenRoutine={vi.fn()}
        onOpenBlock={onOpenBlock}
        routineProfile={null}
        onSetPriority={vi.fn()}
        onRemoveBlock={vi.fn()}
        onRemoveBusy={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Mini project/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Chọn nhiệm vụ')).toBeTruthy();
    expect(screen.getByLabelText('Ưu tiên cá nhân cho Mini project')).toBeTruthy();
    expect(screen.getByText('Lịch cá nhân')).toBeTruthy();
    expect(screen.getAllByText('Ăn uống')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Giờ sinh hoạt/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa Mini project' })).toBeTruthy();
    expect(screen.getByTitle(/19:30 · CS101 · Deadline/)).toBeTruthy();
    fireEvent.click(screen.getByTitle(/Mở phiên tự học/));
    expect(onOpenBlock).toHaveBeenCalledWith('block-1');
    const resizeHandle = screen.getByRole('button', { name: 'Thay đổi thời lượng Mini project' });
    fireEvent.pointerDown(resizeHandle, { clientY: 100 });
    fireEvent.pointerMove(window, { clientY: 129 });
    fireEvent.pointerUp(window, { clientY: 129 });
    expect(onResizeBlock).toHaveBeenCalledWith('block-1', 'end', '20:30');

    const startHandle = screen.getByRole('button', { name: 'Thay đổi giờ bắt đầu Mini project' });
    fireEvent.pointerDown(startHandle, { clientY: 100 });
    fireEvent.pointerMove(window, { clientY: 71 });
    fireEvent.pointerUp(window, { clientY: 71 });
    expect(onResizeBlock).toHaveBeenCalledWith('block-1', 'start', '18:30');
  });

  it('places overlapping items in separate horizontal lanes', () => {
    const overlapping = { ...item, id: 'pacewise:block-2', entityId: 'block-2', start: '19:30', end: '20:30' };
    const positioned = positionCalendarItems([item, overlapping]);

    expect(positioned.map((entry) => entry.laneCount)).toEqual([2, 2]);
    expect(new Set(positioned.map((entry) => entry.lane)).size).toBe(2);
  });
});
