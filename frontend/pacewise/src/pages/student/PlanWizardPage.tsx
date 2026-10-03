import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Checkbox, Input, Select, TimeSelect } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { Stepper } from '../../components/ui/Stepper';
import { Badge } from '../../components/ui/Badge';
import { CourseTag } from '../../components/domain/TaskCard';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import type { AvailabilityDay, PlanInput, PreferredTime, UnavailableSlot, Weekday } from '../../types';
import { NEXT_WEEK_START, TASK_SELECTION_HORIZON_DAYS, WEEK_START, daysUntil, formatDM, formatDeadline, formatDuration, toMin, uid, weekdayName } from '../../utils/time';
import { lmsUnavailableSlots, mergeUnavailable } from '../../utils/lmsPlanning';

interface Row {
  taskId: string;
  checked: boolean;
  hours: string;
}

const PREFERRED_TIME_OPTIONS: [PreferredTime, string][] = [
  ['morning', 'Buổi sáng'],
  ['afternoon', 'Buổi chiều'],
  ['evening', 'Buổi tối'],
];

function normalizePreferredTimes(value: PlanInput['preferred'] | undefined): PreferredTime[] {
  if (!value) return ['afternoon'];
  return Array.isArray(value) ? value : [value];
}

const STEPS = ['Mục tiêu', 'Thời gian', 'Xác nhận'];

export function PlanWizardPage() {
  useDocumentTitle('Tạo kế hoạch');
  const { state, dispatch } = useAppStore();
  const { courseById } = useDerived();
  const navigate = useNavigate();
  const open = state.tasks.filter((t) => t.status !== 'done');
  const priorityTasks = open.filter((task) => {
    const days = daysUntil(task.deadline);
    return days >= 0 && days <= TASK_SELECTION_HORIZON_DAYS;
  });
  const defaultTasks = priorityTasks.length
    ? priorityTasks
    : [...open].sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 3);
  const priorityTaskIds = new Set(defaultTasks.map((task) => task.id));
  const prev = state.wizardInput;

  const [step, setStep] = useState(0);
  const reflectedNextWeek = Object.values(state.reflections).some((item) => item.effectiveWeekStart === NEXT_WEEK_START);
  const [planWeekStart, setPlanWeekStart] = useState(prev?.weekStart ?? (reflectedNextWeek ? NEXT_WEEK_START : WEEK_START));
  const defaultGoal = prev?.goal ?? (state.user?.isNew ? 'Hoàn thành các bài tập tuần đúng hạn' : 'Hoàn thành Project Draft và Reading 2 trước deadline');
  const [goal, setGoal] = useState(defaultGoal);
  const [rows, setRows] = useState<Row[]>(() =>
    open.map((t) => {
      const p = prev?.tasks.find((x) => x.taskId === t.id);
      const rem = p ? p.remainingMin : Math.max(0, t.estimateMin - t.loggedMin);
      return { taskId: t.id, checked: prev ? !!p : priorityTaskIds.has(t.id), hours: String(Math.round((rem / 60) * 10) / 10).replace('.', ',') };
    }),
  );
  const [showLaterTasks, setShowLaterTasks] = useState(() => Boolean(prev?.tasks.some((task) => !priorityTaskIds.has(task.taskId))));
  const [availability, setAvailability] = useState<AvailabilityDay[]>(prev?.availability ?? state.availability);
  const [unavailable, setUnavailable] = useState<UnavailableSlot[]>(() => mergeUnavailable(
    prev?.unavailable ?? state.unavailable,
    lmsUnavailableSlots(state.courseData),
  ));
  const [preferred, setPreferred] = useState<PreferredTime[]>(() => normalizePreferredTimes(prev?.preferred));
  const [showErrors, setShowErrors] = useState(false);

  const hoursToMin = (h: string) => Math.round(parseFloat(h.replace(',', '.')) * 60);

  const input: PlanInput = useMemo(
    () => ({
      goal,
      weekStart: planWeekStart,
      tasks: rows.filter((r) => r.checked).map((r) => ({ taskId: r.taskId, remainingMin: hoursToMin(r.hours) || 0 })),
      availability,
      unavailable,
      preferred,
    }),
    [goal, planWeekStart, rows, availability, unavailable, preferred],
  );
  const initialInputRef = useRef(JSON.stringify(input));
  const hasDraftChanges = initialInputRef.current !== JSON.stringify(input);

  // ---- validation per step ----
  const step1Errors: Record<string, string> = {};
  if (!rows.some((r) => r.checked)) step1Errors.tasks = 'Chọn ít nhất một nhiệm vụ để lập kế hoạch.';
  rows.forEach((r) => {
    const m = hoursToMin(r.hours);
    if (r.checked && (!m || m <= 0 || m > 40 * 60)) step1Errors[r.taskId] = 'Nhập số giờ lớn hơn 0 (ví dụ 1,5).';
  });
  const step2Errors: Record<string, string> = {};
  if (!availability.some((a) => a.enabled)) step2Errors.days = 'Thêm ít nhất một khung giờ rảnh trong tuần.';
  if (preferred.length === 0) step2Errors.preferred = 'Chọn ít nhất một buổi bạn thích học.';
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

  const togglePreferred = (value: PreferredTime) => {
    setPreferred((current) => (
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    ));
  };

  const errorList = Object.values(errors);

  return (
    <div className="page max-w-4xl">
      <PageHeader title="Tạo kế hoạch 7 ngày" back={{ to: '/plan', label: 'Kế hoạch' }} description="Mọi chỉnh sửa được giữ trong bản nháp. Kế hoạch đang áp dụng chỉ thay đổi sau khi bạn xác nhận." />
      <div className="mb-6">
        <Stepper steps={STEPS} current={step} />
      </div>

      <div
        role="status"
        className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
          hasDraftChanges
            ? 'border-primary/30 bg-primary-light text-primary-ink'
            : 'border-line bg-surface text-muted'
        }`}
      >
        {hasDraftChanges
          ? 'Đã ghi nhận các thay đổi trong bản nháp. Kế hoạch hiện tại của bạn chưa bị thay đổi.'
          : 'Bạn chưa chỉnh sửa dữ liệu của bản nháp này.'}
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
            <fieldset>
              <legend className="card-title">Lập kế hoạch cho tuần nào?</legend>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  [WEEK_START, `Tuần hiện tại · ${formatDM(WEEK_START)}`],
                  [NEXT_WEEK_START, `Tuần tiếp theo · ${formatDM(NEXT_WEEK_START)}`],
                ].map(([value, label]) => (
                  <label key={value} className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-4 font-medium ${planWeekStart === value ? 'border-primary-dark bg-primary-light text-primary-ink' : 'border-line bg-white'}`}>
                    <input type="radio" name="plan-week" value={value} checked={planWeekStart === value} onChange={() => setPlanWeekStart(value)} className="h-4 w-4 accent-[#3F6FE8]" />
                    {label}
                  </label>
                ))}
              </div>
              {reflectedNextWeek && <p className="mt-2 text-sm text-muted">Đã chọn sẵn tuần tiếp theo vì bạn vừa xác nhận Weekly Reflect.</p>}
            </fieldset>
          </Card>
          <Card>
            <Input label="Mục tiêu tuần" value={goal} onChange={(e) => setGoal(e.target.value)} hint="Không bắt buộc — giúp bạn nhớ vì sao lập kế hoạch này." maxLength={140} />
          </Card>
          <Card aria-labelledby="t-title">
            <CardHeader id="t-title" title="Chọn nhiệm vụ" subtitle={`PaceWise chọn sẵn deadline trong ${TASK_SELECTION_HORIZON_DAYS} ngày tới. Bạn vẫn có thể mở các nhiệm vụ xa hơn.`} />
            {showErrors && step1Errors.tasks && <p className="mb-3 text-sm font-medium text-danger-ink">{step1Errors.tasks}</p>}
            {rows.length === 0 ? (
              <p className="py-4 text-muted">Hiện chưa có bài tập mở nào từ Canvas cần lập kế hoạch.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rows.filter((row) => showLaterTasks || priorityTaskIds.has(row.taskId)).map((r) => {
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
            {open.length > priorityTaskIds.size && (
              <Button className="mt-4" size="sm" variant="ghost" onClick={() => setShowLaterTasks((visible) => !visible)}>
                {showLaterTasks ? 'Ẩn nhiệm vụ ngoài 14 ngày' : `Xem thêm ${open.length - priorityTaskIds.size} nhiệm vụ xa hơn`}
              </Button>
            )}
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <Card aria-labelledby="av-title">
            <CardHeader id="av-title" title="Thời gian rảnh" subtitle="Khung giờ bạn có thể học trong 7 ngày lập kế hoạch." />
            {showErrors && step2Errors.days && <p className="mb-3 text-sm font-medium text-danger-ink">{step2Errors.days}</p>}
            <ul className="divide-y divide-line">
              {availability.map((a) => (
                <li key={a.weekday} className="grid grid-cols-[1fr_auto] items-start gap-3 py-3 sm:grid-cols-[150px_1fr_1fr] sm:items-center">
                  <Checkbox label={weekdayName(a.weekday)} checked={a.enabled} onChange={(e) => updateDay(a.weekday, { enabled: e.target.checked })} />
                  <span className="text-right text-sm text-muted sm:hidden">{a.enabled ? formatDuration(Math.max(0, toMin(a.end) - toMin(a.start))) : 'Không rảnh'}</span>
                  {a.enabled ? (
                    <div className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-2">
                      <TimeSelect label={`Bắt đầu ${weekdayName(a.weekday)}`} hideLabel value={a.start} onChange={(e) => updateDay(a.weekday, { start: e.target.value })} />
                      <TimeSelect
                        label={`Kết thúc ${weekdayName(a.weekday)}`}
                        hideLabel
                        includeEndOfDay
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
              subtitle="Bao gồm lịch bận bạn nhập và lịch học/quiz/thi đồng bộ từ LMS."
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
                    disabled={u.readOnly}
                    onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, label: e.target.value } : x)))}
                    error={showErrors ? step2Errors[`u${u.id}`] : undefined}
                  />
                  <Select
                    label="Ngày"
                    value={String(u.weekday)}
                    disabled={u.readOnly}
                    onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, weekday: Number(e.target.value) as Weekday } : x)))}
                    options={[0, 1, 2, 3, 4, 5, 6].map((w) => ({ value: String(w), label: weekdayName(w as Weekday) }))}
                  />
                  <TimeSelect label="Từ" value={u.start} disabled={u.readOnly} onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, start: e.target.value } : x)))} />
                  <TimeSelect label="Đến" includeEndOfDay value={u.end} disabled={u.readOnly} onChange={(e) => setUnavailable((l) => l.map((x) => (x.id === u.id ? { ...x, end: e.target.value } : x)))} />
                  {u.readOnly ? (
                    <Badge tone="primary">LMS</Badge>
                  ) : (
                    <Button variant="danger" icon="trash" aria-label={`Xóa ${u.label || 'khoảng này'}`} onClick={() => setUnavailable((l) => l.filter((x) => x.id !== u.id))}>
                      <span className="sm:sr-only">Xóa</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <fieldset>
              <legend className="card-title">Bạn thích học vào lúc nào?</legend>
              <p className="mt-1 text-sm text-muted">Có thể chọn một, hai hoặc cả ba buổi. PaceWise vẫn dùng buổi khác khi cần để tránh trễ deadline.</p>
              {showErrors && step2Errors.preferred && <p className="mt-2 text-sm font-medium text-danger-ink">{step2Errors.preferred}</p>}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PREFERRED_TIME_OPTIONS.map(([v, l]) => (
                  <label
                    key={v}
                    className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-4 font-medium ${preferred.includes(v) ? 'border-primary-dark bg-primary-light text-primary-ink' : 'border-line bg-white'}`}
                  >
                    <input type="checkbox" name="pref" value={v} checked={preferred.includes(v)} onChange={() => togglePreferred(v)} className="h-4 w-4 accent-[#3F6FE8]" />
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
                <p className="caption mt-3">Các lựa chọn đã được ghi nhận trong bản nháp. Chưa có kế hoạch nào được áp dụng cho đến khi bạn xem và xác nhận.</p>
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
