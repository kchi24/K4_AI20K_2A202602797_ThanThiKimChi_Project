import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatTile } from '../../components/domain/StatTile';
import { LMSLearningSnapshot } from '../../components/domain/LMSLearningSnapshot';
import { TaskCard } from '../../components/domain/TaskCard';
import { WarningCard } from '../../components/domain/WarningCard';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Banner } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { trackProgress, type AgentResponse } from '../../services/api';
import { DEMO_TODAY, formatDay, formatDuration, formatHours, weekDates } from '../../utils/time';

export function ProgressPage() {
  useDocumentTitle('Tiến độ');
  const { state, dispatch } = useAppStore();
  const {
    activeCourse,
    activeDrifts: drifts,
    activePlan,
    activeSessions,
    activeStats: stats,
    activeTasks: courseTasks,
    taskById,
    courseById,
  } = useDerived();
  const navigate = useNavigate();
  const toast = useToast();
  const open = courseTasks.filter((t) => t.status !== 'done');
  const done = courseTasks.filter((t) => t.status === 'done');

  const [studyTask, setStudyTask] = useState(open[0]?.id ?? '');
  const [form, setForm] = useState({ taskId: open[0]?.id ?? '', minutes: '', date: DEMO_TODAY, note: '' });
  const [errors, setErrors] = useState<{ minutes?: string; taskId?: string }>({});
  const [tracking, setTracking] = useState<AgentResponse | null>(null);
  const activeCourseData = state.user?.courseId ? state.courseData[state.user.courseId] : undefined;

  useEffect(() => {
    let active = true;
    void trackProgress(activePlan, state.availability, state.unavailable)
      .then((result) => active && setTracking(result))
      .catch(() => active && setTracking(null));
    return () => { active = false; };
  }, [activePlan, state.settings.lastSync, state.user?.courseId, state.availability, state.unavailable]);

  useEffect(() => {
    const nextTaskId = open[0]?.id ?? '';
    setStudyTask(nextTaskId);
    setForm((current) => ({ ...current, taskId: nextTaskId }));
    setTracking(null);
  }, [state.user?.courseId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = Number(form.minutes);
    const next: typeof errors = {};
    if (!form.taskId) next.taskId = 'Chọn nhiệm vụ.';
    if (!form.minutes || !Number.isFinite(m) || m <= 0) next.minutes = 'Nhập số phút lớn hơn 0.';
    else if (m > 600) next.minutes = 'Một lần nhập tối đa 600 phút.';
    setErrors(next);
    if (Object.keys(next).length) return;
    dispatch({ type: 'ADD_MANUAL_SESSION', session: { taskId: form.taskId, minutes: m, date: form.date, note: form.note.trim() || undefined } });
    toast({ tone: 'success', title: 'Đã lưu thời gian học', description: `${formatDuration(m)} cho ${taskById.get(form.taskId)?.title}. Tiến độ đã được cập nhật.` });
    setForm((f) => ({ ...f, minutes: '', note: '' }));
  };

  return (
    <div className="page">
      <PageHeader
        title="Tiến độ"
        description={`Thời gian thực tế so với kế hoạch của ${activeCourse?.code ?? 'môn đang chọn'}.`}
      />

      {tracking && (
        <div className="mb-5">
          <Banner tone={tracking.risk_signals?.length ? 'warning' : 'success'} icon={tracking.risk_signals?.length ? 'info' : 'checkCircle'}>
            {tracking.response}
          </Banner>
        </div>
      )}

      <div className="mb-5">
        <LMSLearningSnapshot data={activeCourseData} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon="checkCircle" label="Đã hoàn thành" value={`${stats.done} / ${stats.total}`} hint="nhiệm vụ" />
        <StatTile icon="file" label="Còn lại" value={stats.remaining} hint="nhiệm vụ" />
        <StatTile icon="clock" label="Phiên học" value={stats.sessionCount} hint="trong tuần" />
        <StatTile icon="chart" label="Đã học" value={formatHours(stats.studiedMin)} hint={`dự kiến tới giờ: ${formatHours(stats.plannedUntilNow)}`} />
      </div>

      {drifts[0] && taskById.get(drifts[0].taskId) && (
        <div className="mt-5">
          <WarningCard drift={drifts[0]} task={taskById.get(drifts[0].taskId)!} />
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
        <Card aria-labelledby="start">
          <CardHeader id="start" title="Bắt đầu phiên học" subtitle="Hẹn giờ sẽ tự ghi thời gian khi bạn hoàn thành." />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select className="flex-1" label="Nhiệm vụ" value={studyTask} onChange={(e) => setStudyTask(e.target.value)} options={open.map((t) => ({ value: t.id, label: t.title }))} />
            <Button icon="play" disabled={!studyTask} onClick={() => navigate(`/study/${studyTask}/session`)}>
              Bắt đầu
            </Button>
          </div>
          {state.activeSession && (
            <p className="caption mt-3">
              Đang có phiên chạy cho <strong>{taskById.get(state.activeSession.taskId)?.title}</strong>.
            </p>
          )}
        </Card>

        <Card aria-labelledby="manual-title" id="manual">
          <CardHeader id="manual-title" title="Nhập thủ công" subtitle="Dùng khi bạn học mà quên bật hẹn giờ, hoặc để sửa dữ liệu." />
          <form className="space-y-4" onSubmit={submit} noValidate>
            <Select label="Nhiệm vụ" value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })} options={courseTasks.map((t) => ({ value: t.id, label: t.title }))} error={errors.taskId} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Thời lượng (phút)" inputMode="numeric" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value.replace(/[^\d]/g, '') })} error={errors.minutes} placeholder="45" />
              <Select label="Ngày" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} options={weekDates().filter((d) => d <= DEMO_TODAY).map((d) => ({ value: d, label: formatDay(d, { relative: true }) }))} />
            </div>
            <Textarea label="Ghi chú" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} hint="Không bắt buộc" />
            <Button type="submit" icon="check">
              Lưu thời gian
            </Button>
          </form>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
        <Card aria-labelledby="tasks">
          <CardHeader id="tasks" title="Nhiệm vụ đang làm" subtitle={`${open.length} nhiệm vụ`} />
          <div className="space-y-2.5">
            {open.map((t) => (
              <TaskCard key={t.id} task={t} course={courseById.get(t.courseId)} atRisk={drifts.some((d) => d.taskId === t.id)} />
            ))}
          </div>
          {done.length > 0 && (
            <details className="mt-4">
              <summary className="min-h-[44px] cursor-pointer py-2 font-semibold text-primary-ink">Đã hoàn thành ({done.length})</summary>
              <div className="mt-2 space-y-2.5">
                {done.map((t) => (
                  <TaskCard key={t.id} task={t} course={courseById.get(t.courseId)} compact />
                ))}
              </div>
            </details>
          )}
        </Card>
        <Card aria-labelledby="sessions">
          <CardHeader id="sessions" title="Lịch sử phiên học" subtitle="Mới nhất trước" />
          {activeSessions.length ? (
            <ul className="divide-y divide-line">
              {activeSessions.slice(0, 10).map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{taskById.get(s.taskId)?.title}</p>
                    <p className="caption">
                      {formatDay(s.date, { relative: true })} · {s.source === 'timer' ? 'Hẹn giờ' : 'Nhập tay'}
                      {s.note ? ` · ${s.note}` : ''}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatDuration(s.minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Chưa có phiên học nào.</p>
          )}
          <div className="mt-4">
            <p className="mb-2 text-sm text-muted">Thời gian đã học so với kế hoạch cả tuần</p>
            <ProgressBar value={stats.studiedMin} max={Math.max(stats.plannedMin, 1)} label="Đã học so với kế hoạch tuần" />
          </div>
        </Card>
      </div>
    </div>
  );
}
