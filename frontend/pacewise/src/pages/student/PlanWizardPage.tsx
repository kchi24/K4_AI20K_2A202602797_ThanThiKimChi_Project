import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Checkbox, Input, Select } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stepper } from '../../components/ui/Stepper';
import { Badge } from '../../components/ui/Badge';
import { CourseTag } from '../../components/domain/TaskCard';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import type { AvailabilityDay, PlanInput, PreferredTime, UnavailableSlot, Weekday } from '../../types';
import { formatDeadline, formatDuration, toMin, uid, weekdayName } from '../../utils/time';

interface Row {
  taskId: string;
  checked: boolean;
  hours: string;
}

const STEPS = ['Mục tiêu', 'Thời gian', 'Xác nhận'];

export function PlanWizardPage() {
  useDocumentTitle('Tạo kế hoạch');
  const { state, dispatch } = useAppStore();
  const { courseById } = useDerived();
  const navigate = useNavigate();
  const open = state.tasks.filter((t) => t.status !== 'done');
  const prev = state.wizardInput;

  const [step, setStep] = useState(0);
  const defaultGoal = prev?.goal ?? (state.user?.isNew ? 'Hoàn thành các bài tập tuần đúng hạn' : 'Hoàn thành Project Draft và Reading 2 trước deadline');
  const [goal, setGoal] = useState(defaultGoal);
  const [rows, setRows] = useState<Row[]>(() =>
    open.map((t) => {
      const p = prev?.tasks.find((x) => x.taskId === t.id);
      const rem = p ? p.remainingMin : Math.max(0, t.estimateMin - t.loggedMin);
      return { taskId: t.id, checked: prev ? !!p : true, hours: String(Math.round((rem / 60) * 10) / 10).replace('.', ',') };
    }),
  );
  const [availability, setAvailability] = useState<AvailabilityDay[]>(prev?.availability ?? state.availability);
  const [unavailable, setUnavailable] = useState<UnavailableSlot[]>(prev?.unavailable ?? state.unavailable);
  const [preferred, setPreferred] = useState<PreferredTime>(prev?.preferred ?? 'afternoon');
  const [showErrors, setShowErrors] = useState(false);

  const hoursToMin = (h: string) => Math.round(parseFloat(h.replace(',', '.')) * 60);

  const input: PlanInput = useMemo(
    () => ({
      goal,
      tasks: rows.filter((r) => r.checked).map((r) => ({ taskId: r.taskId, remainingMin: hoursToMin(r.hours) || 0 })),
      availability,
      unavailable,
      preferred,
    }),
    [goal, rows, availability, unavailable, preferred],
  );

  // ---- validation per step ----
  const step1Errors: Record<string, string> = {};
  if (!rows.some((r) => r.checked)) step1Errors.tasks = 'Chọn ít nhất một nhiệm vụ để lập kế hoạch.';
  rows.forEach((r) => {
    const m = hoursToMin(r.hours);
    if (r.checked && (!m || m <= 0 || m > 40 * 60)) step1Errors[r.taskId] = 'Nhập số giờ lớn hơn 0 (ví dụ 1,5).';
  });
  const step2Errors: Record<string, string> = {};
  if (!availability.some((a) => a.enabled)) step2Errors.days = 'Thêm ít nhất một khung giờ rảnh trong tuần.';
  availability.forEach((a) => {
    if (a.enabled && toMin(a.end) <= toMin(a.start)) step2Errors[`d${a.weekday}`] = 'Giờ kết thúc phải sau giờ bắt đầu.';
  });
  unavailable.forEach((u) => {
    if (!u.label.trim()) step2Errors[`u${u.id}`] = 'Đặt tên cho khoảng thời gian này.';
    else if (toMin(u.end) <= toMin(u.start)) step2Errors[`u${u.id}`] = 'Giờ kết thúc phải sau giờ bắt đầu.';
  });
  const errors = step === 0 ? step1Errors : step === 1 ? step2Errors : {};

  const goNext = () => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      requestAnimationFrame(() => document.getElementById('error-summary')?.focus());
      return;
    }
    setShowErrors(false);
    setStep((s) => s + 1);
    window.scrollTo(0, 0);
  };

  const generate = () => {
    dispatch({ type: 'SET_WIZARD_INPUT', input });
    navigate('/plan/generating');
  };

  const updateDay = (w: Weekday, patch: Partial<AvailabilityDay>) => setAvailability((list) => list.map((a) => (a.weekday === w ? { ...a, ...patch } : a)));

  const errorList = Object.values(errors);

  return (
    <div className="page max-w-4xl">
      <PageHeader title="Tạo kế hoạch tuần" back={{ to: '/plan', label: 'Kế hoạch' }} description="PaceWise chỉ tạo bản nháp. Không có gì được lưu cho tới khi bạn xác nhận." />
      <div className="mb-6">
        <Stepper steps={STEPS} current={step} />
      </div>

      {showErrors && errorList.length > 0 && (
        <div id="error-summary" tabIndex={-1} role="alert" className="mb-5 rounded-2xl border border-[#F6CFCF] bg-danger-light px-4 py-3 text-danger-ink focus:outline-none">
          <p className="font-semibold">Có {errorList.length} mục cần sửa. Dữ liệu bạn nhập vẫn được giữ.</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {Array.from(new Set(errorList)).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {step === 0 && (
        <div className="space-y-5">
          <Card>
            <Input label="Mục tiêu tuần" value={goal} onChange={(e) => setGoal(e.target.value)} hint="Không bắt buộc — giúp bạn nhớ vì sao lập kế hoạch này." maxLength={140} />
          </Card>
          <Card aria-labelledby="t-title">
            <CardHeader id="t-title" title="Chọn nhiệm vụ" subtitle="Điều chỉnh số giờ còn cần nếu ước lượng chưa đúng." />
            {showErrors && step1Errors.tasks && <p className="mb-3 text-sm font-medium text-danger-ink">{step1Errors.tasks}</p>}
            {rows.length === 0 ? (
              <p className="py-4 text-muted">Hiện chưa có bài tập mở nào từ Canvas cần lập kế hoạch.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((r) => {
                  const t = state.tasks.find((x) => x.id === r.taskId)!;
                  return (
                    <li key={r.taskId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
                      <Checkbox
                        className="flex-1"
                        checked={r.checked}
                        onChange={(e) => setRows((list) => list.map((x) => (x.taskId === r.taskId ? { ...x, checked: e.target.checked } : x)))}
                        label={
                          <span className="flex flex-wrap items-center gap-2">
                            {t.title} <CourseTag course={courseById.get(t.courseId)} />
                            {t.priority === 'high' && <Badge tone="danger">Ưu tiên cao</Badge>}
                            {t.priority === 'low' && <Badge>Ưu tiên thấp</Badge>}
                          </span>
                        }
                        description={`Hạn ${formatDeadline(t.deadline)}${t.estimateIsAssumption ? ' · ước lượng do PaceWise gợi ý' : ''}`}
                      />
                      <Input
                        className="w-full sm:w-40"
                        label="Còn cần (giờ)"
                        inputMode="decimal"
                        value={r.hours}
                        disabled={!r.checked}
                        onChange={(e) => setRows((list) => list.map((x) => (x.taskId === r.taskId ? { ...x, hours: e.target.value } : x)))}
                        error={showErrors ? step1Errors[r.taskId] : undefined}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <Card aria-labelledby="av-title">
            <CardHeader id="av-title" title="Thời gian rảnh" subtitle="Khung giờ bạn có thể học mỗi ngày trong tuần này." />
            {showErrors && step2Errors.days && <p className="mb-3 text-sm font-medium text-danger-ink">{step2Errors.days}</p>}
            <ul className="divide-y divide-line">
              {availability.map((a) => (
                <li key={a.weekday} className="grid grid-cols-[1fr_auto] items-start gap-3 py-3 sm:grid-cols-[150px_1fr_1fr] sm:items-center">
                  <Checkbox label={weekdayName(a.weekday)} checked={a.enabled} onChange={(e) => updateDay(a.weekday, { enabled: e.target.checked })} />
                  <span className="text-right text-sm text-muted sm:hidden">{a.enabled ? formatDuration(Math.max(0, toMin(a.end) - toMin(a.start))) : 'Không rảnh'}</span>
                  {a.enabled ? (
                    <div className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-2">
                      <Input label={`Bắt đầu ${weekdayName(a.weekday)}`} hideLabel type="time" value={a.start} onChange={(e) => updateDay(a.weekday, { start: e.target.value })} />
                      <Input
                        label={`Kết thúc ${weekdayName(a.weekday)}`}
                        hideLabel
                        type="time"
                        value={a.end}
                        onChange={(e) => updateDay(a.weekday, { end: e.target.value })}
                        error={showErrors ? step2Errors[`d${a.weekday}`] : undefined}
                      />
                    </div>
                  ) : (
                    <p className="col-span-2 hidden text-muted sm:block">Không rảnh</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card aria-labelledby="un-title">
            <CardHeader
              id="un-title"
              title="Thời gian không thể học"
              subtitle="Ví dụ: lịch làm thêm, họp nhóm. PaceWise sẽ tránh các khung này."
              action={
                <Button
                  size="sm"
                  variant="soft"
                  icon="plus"
                  onClick={() => setUnavailable((l) => [...l, { id: uid('un'), label: '', weekday: 3, start: '18:00', end: '19:00' }])}
                >
                  Thêm
                </Button>
              }
            />
            {unavailable.length === 0 && <p className="text-muted">Chưa có khoảng nào.</p>}
            <ul className="space-y-4">
              {unavailable.map((u) => (
                <li key={u.id} className="grid grid-cols-1 gap-3 rounded-2xl border border-line p-3 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto] sm:items-end">
                  <Input
                    label="Tên"
                    value={u.label}
                    onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, label: e.target.value } : x)))}
                    error={showErrors ? step2Errors[`u${u.id}`] : undefined}
                  />
                  <Select
                    label="Ngày"
                    value={String(u.weekday)}
                    onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, weekday: Number(e.target.value) as Weekday } : x)))}
                    options={[0, 1, 2, 3, 4, 5, 6].map((w) => ({ value: String(w), label: weekdayName(w as Weekday) }))}
                  />
                  <Input label="Từ" type="time" value={u.start} onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, start: e.target.value } : x)))} />
                  <Input label="Đến" type="time" value={u.end} onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, end: e.target.value } : x)))} />
                  <Button variant="danger" icon="trash" aria-label={`Xóa ${u.label || 'khoảng này'}`} onClick={() => setUnavailable((l) => l.filter((x) => x.id !== u.id))}>
                    <span className="sm:sr-only">Xóa</span>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <fieldset>
              <legend className="card-title">Bạn thích học vào lúc nào?</legend>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    ['morning', 'Buổi sáng'],
                    ['afternoon', 'Buổi chiều'],
                    ['evening', 'Buổi tối'],
                  ] as [PreferredTime, string][]
                ).map(([v, l]) => (
                  <label
                    key={v}
                    className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-4 font-medium ${preferred === v ? 'border-primary-dark bg-primary-light text-primary-ink' : 'border-line bg-white'}`}
                  >
                    <input type="radio" name="pref" value={v} checked={preferred === v} onChange={() => setPreferred(v)} className="h-4 w-4 accent-[#3F6FE8]" />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <Card tone="primary" role="status">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary-ink">
                <Icon name="sparkle" size={22} />
              </span>
              <div>
                <h2 className="text-xl font-semibold">Sẵn sàng kiểm tra kế hoạch</h2>
                <p className="mt-1 text-ink/80">
                  Bạn đã chọn {input.tasks.length} nhiệm vụ với tổng thời lượng {formatDuration(input.tasks.reduce((sum, task) => sum + task.remainingMin, 0))}.
                  Backend PaceWise sẽ xếp study block và kiểm tra deadline bằng cùng một bộ quy tắc duy nhất.
                </p>
                <p className="caption mt-3">Chưa có kế hoạch nào được lưu cho đến khi bạn xem và xác nhận bản nháp.</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {step > 0 ? (
          <Button variant="secondary" icon="arrowLeft" onClick={() => setStep((s) => s - 1)}>
            Quay lại
          </Button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <Button iconRight="arrowRight" onClick={goNext}>
            Tiếp tục
          </Button>
        ) : (
          <Button icon="sparkle" onClick={generate}>
            Tạo và kiểm tra kế hoạch
          </Button>
        )}
      </div>
    </div>
  );
}
