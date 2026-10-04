import { useEffect, useMemo, useState } from 'react';
import type { Task, TimeBlock } from '../../types';
import { addDays, DEMO_TODAY, formatDay, toClock, toMin, uid } from '../../utils/time';
import { Button } from '../ui/Button';
import { Select, TimeSelect } from '../ui/Field';
import { Modal } from '../ui/Modal';

export function PlanEntryModal({ open, tasks, weekStart, initialTaskId, onClose, onAdd }: {
  open: boolean;
  tasks: Task[];
  weekStart: string;
  initialTaskId?: string;
  onClose: () => void;
  onAdd: (block: TimeBlock) => void;
}) {
  const [taskId, setTaskId] = useState(initialTaskId ?? tasks[0]?.id ?? '');
  const [date, setDate] = useState(weekStart);
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('20:00');
  const availableDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).filter((item) => item >= DEMO_TODAY),
    [weekStart],
  );

  useEffect(() => {
    if (!open) return;
    setTaskId(initialTaskId ?? tasks[0]?.id ?? '');
    setDate(availableDates[0] ?? DEMO_TODAY);
    setStart('19:00');
    setEnd('20:00');
  }, [availableDates, initialTaskId, open, tasks]);

  const task = tasks.find((item) => item.id === taskId);
  const error = useMemo(() => {
    if (!taskId) return 'Chọn một nhiệm vụ.';
    if (toMin(end) <= toMin(start)) return 'Giờ kết thúc phải sau giờ bắt đầu.';
    if (task && date > task.deadline) return 'Study block không được nằm sau deadline.';
    return undefined;
  }, [date, end, start, task, taskId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thêm study block"
      description="Block mới là dữ liệu đầu vào để Plan Agent kiểm tra và xếp phần còn lại."
      footer={<><Button variant="secondary" onClick={onClose}>Hủy</Button><Button disabled={Boolean(error)} onClick={() => onAdd({ id: uid('manual-block'), taskId, date, start, end })}>Thêm vào bản nháp</Button></>}
    >
      <div className="space-y-4">
        <Select label="Nhiệm vụ" value={taskId} onChange={(event) => setTaskId(event.target.value)} options={tasks.map((item) => ({ value: item.id, label: item.title }))} />
        <Select label="Ngày" value={date} onChange={(event) => setDate(event.target.value)} options={availableDates.map((item) => ({ value: item, label: formatDay(item) }))} />
        <div className="grid grid-cols-2 gap-3">
          <TimeSelect label="Bắt đầu" value={start} onChange={(event) => { const next = event.target.value; setStart(next); setEnd(toClock(Math.min(24 * 60, toMin(next) + 60))); }} />
          <TimeSelect label="Kết thúc" includeEndOfDay value={end} onChange={(event) => setEnd(event.target.value)} error={error} />
        </div>
      </div>
    </Modal>
  );
}
