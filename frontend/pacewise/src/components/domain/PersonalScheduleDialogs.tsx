import { useEffect, useState } from 'react';
import type { PersonalSlotCategory, PreferredTime, RoutineProfile } from '../../types';
import { Button, IconButton } from '../ui/Button';

const CATEGORY_LABELS: Record<PersonalSlotCategory, string> = {
  meal: 'Ăn uống',
  self_study: 'Giờ tự học ưu tiên',
  sleep: 'Ngủ',
  other: 'Bận khác',
};

export function PersonalSlotDialog({
  open,
  category,
  initialLabel,
  initialDate,
  minDate,
  maxDate,
  onClose,
  onSubmit,
}: {
  open: boolean;
  category: PersonalSlotCategory;
  initialLabel: string;
  initialDate: string;
  minDate: string;
  maxDate: string;
  onClose: () => void;
  onSubmit: (value: { date: string; start: string; end: string; label: string; category: PersonalSlotCategory }) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('19:00');
  const [label, setLabel] = useState(initialLabel);

  useEffect(() => {
    if (!open) return;
    setDate(initialDate);
    setLabel(initialLabel);
  }, [initialDate, initialLabel, open]);

  if (!open) return null;
  const valid = Boolean(date && label.trim() && end > start);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="personal-slot-title">
      <form
        className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSubmit({ date, start, end, label: label.trim(), category });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="personal-slot-title" className="text-lg font-bold">Thêm {CATEGORY_LABELS[category].toLowerCase()}</h2>
            <p className="mt-1 text-sm text-muted">
              {category === 'self_study'
                ? 'Plan Agent sẽ ưu tiên đặt study block vào khoảng này.'
                : 'Plan Agent sẽ không xếp study block trùng khoảng này.'}
            </p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={onClose} />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm font-semibold">Ngày
            <input type="date" min={minDate} max={maxDate} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-line px-3 font-normal" required />
          </label>
          <label className="text-sm font-semibold">Bắt đầu
            <input type="time" step="900" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-line px-3 font-normal" required />
          </label>
          <label className="text-sm font-semibold">Kết thúc
            <input type="time" step="900" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-line px-3 font-normal" required />
          </label>
          <label className="sm:col-span-2 text-sm font-semibold">Tên hiển thị
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} className="mt-1 block h-10 w-full rounded-lg border border-line px-3 font-normal" placeholder={category === 'other' ? 'Ví dụ: Làm thêm, đi khám…' : CATEGORY_LABELS[category]} required />
          </label>
        </div>
        {end <= start && <p className="mt-3 text-sm font-semibold text-danger-ink">Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="submit" icon="check" disabled={!valid}>Thêm vào lịch</Button>
        </div>
      </form>
    </div>
  );
}

const PERIODS: Array<{ value: PreferredTime; label: string; detail: string }> = [
  { value: 'late_night', label: 'Khuya', detail: '00:00–05:00' },
  { value: 'morning', label: 'Sáng', detail: '05:00–12:00' },
  { value: 'afternoon', label: 'Chiều', detail: '12:00–17:00' },
  { value: 'evening', label: 'Tối', detail: '17:00–24:00' },
];

export function RoutineDialog({ open, value, onClose, onSave }: {
  open: boolean;
  value: RoutineProfile | null;
  onClose: () => void;
  onSave: (profile: RoutineProfile) => void;
}) {
  const [wakeTime, setWakeTime] = useState(value?.wakeTime ?? '07:00');
  const [sleepTime, setSleepTime] = useState(value?.sleepTime ?? '23:00');
  const [preferred, setPreferred] = useState<PreferredTime[]>(value?.preferred ?? ['morning', 'evening']);

  useEffect(() => {
    if (!open) return;
    setWakeTime(value?.wakeTime ?? '07:00');
    setSleepTime(value?.sleepTime ?? '23:00');
    setPreferred(value?.preferred ?? ['morning', 'evening']);
  }, [open, value]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="routine-title">
      <form
        className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (preferred.length) onSave({ wakeTime, sleepTime, preferred });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="routine-title" className="text-lg font-bold">Giờ sinh hoạt</h2>
            <p className="mt-1 text-sm text-muted">PaceWise chỉ học theo nhịp của bạn sau khi bạn xác nhận, kể cả khi bạn thường học khuya.</p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={onClose} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <label className="text-sm font-semibold">Thường thức dậy
            <input type="time" step="900" value={wakeTime} onChange={(event) => setWakeTime(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-line px-3 font-normal" />
          </label>
          <label className="text-sm font-semibold">Thường đi ngủ
            <input type="time" step="900" value={sleepTime} onChange={(event) => setSleepTime(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-line px-3 font-normal" />
          </label>
        </div>
        <fieldset className="mt-5">
          <legend className="text-sm font-bold">Khung giờ thích tự học</legend>
          <p className="mt-1 text-xs text-muted">Có thể chọn nhiều khung. “Khuya” chỉ được ưu tiên khi bạn chủ động chọn.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PERIODS.map((period) => {
              const checked = preferred.includes(period.value);
              return (
                <label key={period.value} className={`cursor-pointer rounded-xl border p-3 ${checked ? 'border-primary bg-primary-light' : 'border-line bg-white'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setPreferred((current) => checked ? current.filter((item) => item !== period.value) : [...current, period.value])}
                    className="sr-only"
                  />
                  <span className="block text-sm font-bold">{period.label}</span>
                  <span className="block text-[11px] text-muted">{period.detail}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {preferred.length === 0 && <p className="mt-3 text-sm font-semibold text-danger-ink">Chọn ít nhất một khung giờ ưa thích.</p>}
        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-muted">
          Giờ ngủ là ràng buộc cứng. Khung ưa thích chỉ thay đổi thứ tự xếp lịch, không cho phép vượt deadline hoặc chèn vào lịch LMS.
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="submit" icon="check" disabled={!preferred.length}>Lưu giờ sinh hoạt</Button>
        </div>
      </form>
    </div>
  );
}
