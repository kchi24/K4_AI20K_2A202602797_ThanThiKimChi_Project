import { useEffect, useState } from 'react';
import type { AvailabilityDay, Task, TimeBlock } from '../../types';
import { validateBlockEdit } from '../../utils/scheduler';
import { formatDay, weekDates } from '../../utils/time';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Field';
import { Modal } from '../ui/Modal';

export function EditBlockModal({
  block,
  task,
  blocks,
  availability,
  onClose,
  onSave,
  onRemove,
}: {
  block: TimeBlock | null;
  task?: Task;
  blocks: TimeBlock[];
  availability: AvailabilityDay[];
  onClose: () => void;
  onSave: (b: TimeBlock) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState<TimeBlock | null>(block);
  useEffect(() => setDraft(block), [block]);
  const check = draft ? validateBlockEdit(draft, blocks, availability) : {};
  return (
    <Modal
      open={!!block}
      onClose={onClose}
      title={`Sửa buổi học · ${task?.title ?? ''}`}
      description="Thay đổi chỉ áp dụng cho bản xem trước cho tới khi bạn xác nhận và lưu."
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={() => draft && onRemove(draft.id)}>
            Bỏ buổi này
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!!check.error} onClick={() => draft && onSave(draft)}>
            Cập nhật bản xem trước
          </Button>
        </>
      }
    >
      {draft && (
        <div className="space-y-4">
          <Select
            label="Ngày"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            options={weekDates().map((d) => ({ value: d, label: formatDay(d) }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Bắt đầu" type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            <Input label="Kết thúc" type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} error={check.error} />
          </div>
          {check.warning && <p className="rounded-xl bg-warning-light px-3 py-2 text-sm text-warning-ink">{check.warning}</p>}
        </div>
      )}
    </Modal>
  );
}
