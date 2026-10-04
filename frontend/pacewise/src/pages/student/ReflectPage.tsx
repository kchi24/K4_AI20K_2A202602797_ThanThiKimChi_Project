import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StatTile } from '../../components/domain/StatTile';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Textarea } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { Banner } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { confirmReflection, createReflection, type AgentResponse } from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import type { ReflectionActivity } from '../../utils/reflectionActivities';
import { buildReflectionActivities, reflectionActivityWindow, reflectionNeedsPlanReview } from '../../utils/reflectionActivities';
import { weekStats } from '../../utils/progress';
import { calendarWeekStart, formatDay, formatDM, formatDuration, formatHours } from '../../utils/time';
import { weeklyReflectionCycle } from '../../utils/weeklyReflection';

const WEEKLY_QUESTIONS = [
  'Tuần này việc gì đã hoàn thành hoặc chưa hoàn thành?',
  'Nguyên nhân chính khiến kế hoạch đúng hoặc bị lệch?',
  'Tuần sau cần thay đổi thời lượng, khung giờ hay cách chia task nào?',
] as const;
const ACTIVITY_QUESTIONS = [
  'Sau hoạt động này, bạn đã hoàn thành hoặc hiểu được điều gì?',
  'Điều gì hỗ trợ hoặc gây khó khăn cho bạn?',
  'Bước tiếp theo phù hợp nhất là gì?',
] as const;
const MAX = 500;

function ActivityButton({ activity, selected, onClick }: { activity: ReflectionActivity; selected: boolean; onClick: () => void }) {
  const result = activity.missed
    ? 'Chưa ghi nhận thực hiện'
    : activity.actualMinutes != null
      ? `${formatDuration(activity.actualMinutes)} thực tế${activity.completionPercent != null ? ` · ${activity.completionPercent}%` : ''}`
      : `${activity.start}${activity.end ? `–${activity.end}` : ''}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-primary-dark bg-primary-light text-primary-ink' : 'border-line bg-white hover:border-primary'}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide">{activity.kindLabel}</span>
        <span className="text-xs text-muted">{activity.courseCode}</span>
      </span>
      <span className="mt-1 block truncate text-sm font-semibold text-ink">{activity.title}</span>
      <span className="mt-1 block text-xs text-muted">{formatDay(activity.date, { short: true })} · {result}</span>
    </button>
  );
}

export function ReflectPage() {
  useDocumentTitle('Phản tư học tập');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedActivity = searchParams.get('activity');
  const cycle = weeklyReflectionCycle(state.plan);
  const activityWindow = reflectionActivityWindow({
    requestedActivity: Boolean(requestedActivity),
    weeklyStart: cycle.weekStart,
    weeklyEnd: cycle.weekEnd,
  });
  const activities = useMemo(() => buildReflectionActivities({
    plan: state.plan,
    sessions: state.sessions,
    tasks: state.tasks,
    courses: state.courses,
    courseData: state.courseData,
    from: activityWindow.from,
    to: activityWindow.to,
  }), [activityWindow.from, activityWindow.to, state.courseData, state.courses, state.plan, state.sessions, state.tasks]);
  const [selectedId, setSelectedId] = useState(() => requestedActivity ? `activity:${requestedActivity}` : 'weekly');
  const activity = selectedId.startsWith('activity:')
    ? activities.find((item) => `activity:${item.id}` === selectedId)
    : undefined;
  const scope = activity ? 'activity' as const : 'weekly' as const;
  const reflectionWeekStart = activity ? calendarWeekStart(activity.date) : cycle.weekStart;
  const reflectionKey = activity ? `activity:${activity.id}` : `all:${reflectionWeekStart}`;
  const currentReflection = state.reflections[reflectionKey]
    ?? (scope === 'weekly'
      ? Object.values(state.reflections).find((item) => (item.scope ?? 'weekly') === 'weekly' && item.courseId === 'all' && item.weekStart === cycle.weekStart)
      : undefined);
  const stats = weekStats(state.tasks, state.sessions, state.plan, cycle.weekStart);
  const questions = scope === 'activity' ? ACTIVITY_QUESTIONS : WEEKLY_QUESTIONS;
  const [answers, setAnswers] = useState<[string, string, string]>(currentReflection?.answers ?? ['', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<AgentResponse | null>(null);
  const dirty = JSON.stringify(answers) !== JSON.stringify(currentReflection?.answers ?? ['', '', '']);

  useEffect(() => {
    if (!requestedActivity) return;
    const requestedId = `activity:${requestedActivity}`;
    if (activities.some((item) => `activity:${item.id}` === requestedId)) setSelectedId(requestedId);
  }, [activities, requestedActivity]);

  useEffect(() => {
    setAnswers(currentReflection?.answers ?? ['', '', '']);
    setDraft(null);
    setError('');
  }, [reflectionKey, currentReflection?.savedAt]);

  const save = async () => {
    if (answers.every((answer) => !answer.trim())) {
      setError('Trả lời ít nhất một câu để tạo bản phản tư.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const metrics = activity
        ? {
            reflection_scope: 'activity',
            week_start: reflectionWeekStart,
            activity: {
              id: activity.id,
              kind: activity.kind,
              title: activity.title,
              course_id: activity.courseId,
              course_code: activity.courseCode,
              date: activity.date,
              planned_minutes: activity.plannedMinutes,
              actual_minutes: activity.actualMinutes,
              completion_percent: activity.completionPercent,
              blocker: activity.blocker,
              outcome: activity.outcome,
              missed: activity.missed,
            },
          }
        : {
            ...stats,
            reflection_scope: 'weekly',
            week_start: cycle.weekStart,
            week_end: cycle.weekEnd,
            effective_week_start: cycle.effectiveWeekStart,
            timezone: 'Asia/Ho_Chi_Minh',
            activity_count: activities.length,
            period_complete: cycle.isOpen,
          };
      setDraft(await createReflection(answers.map((answer) => answer.trim()) as [string, string, string], metrics));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa tạo được bản phản tư.');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      await confirmReflection(scope);
      dispatch({
        type: 'SAVE_REFLECTION',
        reflectionKey,
        courseId: activity?.courseId ?? 'all',
        weekStart: reflectionWeekStart,
        effectiveWeekStart: scope === 'weekly' ? cycle.effectiveWeekStart : undefined,
        scope,
        activityId: activity?.id,
        activityTitle: activity?.title,
        activityKind: activity?.kind,
        answers: answers.map((answer) => answer.trim()) as [string, string, string],
        aiDraft: draft.reflection_draft ?? undefined,
        aiSummary: draft.response,
      });
      const needsPlanReview = reflectionNeedsPlanReview(scope, activity);
      setDraft(null);
      toast({
        tone: 'success',
        title: scope === 'activity' ? 'Đã lưu phản tư sau phiên' : 'Đã lưu phản tư cả tuần',
        description: needsPlanReview
          ? `AI đang tạo bản đề xuất${scope === 'weekly' ? ` cho tuần ${formatDM(cycle.effectiveWeekStart)}` : ''}; lịch chưa bị thay đổi.`
          : 'Phiên học đang đúng hướng nên lịch hiện tại được giữ nguyên.',
      });
      navigate(needsPlanReview ? `/plan?reanalyze=reflection&scope=${scope}` : '/plan', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa xác nhận được bản phản tư.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`page ${requestedActivity ? 'max-w-3xl' : 'max-w-6xl'}`}>
      <PageHeader
        title={requestedActivity ? 'Phản tư sau phiên học' : 'Reflect'}
        description={requestedActivity ? 'Ghi nhận nhanh kết quả vừa học; sau khi lưu bạn sẽ quay về thời khóa biểu.' : 'Chọn một mốc đã xảy ra để nhìn lại nhanh, hoặc chọn tất cả để tổng kết tuần học đa môn.'}
      />

      <div className={requestedActivity ? 'space-y-5' : 'grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]'}>
        {!requestedActivity && <Card className="lg:sticky lg:top-4 !p-4">
          <div className="flex items-center gap-2">
            <Icon name="sparkle" size={18} className="text-primary-ink" />
            <h2 className="font-bold">Chọn phạm vi phản tư</h2>
          </div>
          <button
            type="button"
            onClick={() => setSelectedId('weekly')}
            aria-pressed={scope === 'weekly'}
            className={`mt-3 w-full rounded-xl border p-3 text-left transition ${scope === 'weekly' ? 'border-primary-dark bg-primary-light' : 'border-line bg-white hover:border-primary'}`}
          >
            <span className="block text-sm font-bold text-ink">Tất cả hoạt động trong tuần</span>
            <span className="mt-1 block text-xs text-muted">{activities.length} mốc · tất cả môn · {formatDM(cycle.weekStart)}–{formatDM(cycle.weekEnd)}</span>
          </button>
          <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {activities.map((item) => (
              <ActivityButton key={item.id} activity={item} selected={activity?.id === item.id} onClick={() => setSelectedId(`activity:${item.id}`)} />
            ))}
            {activities.length === 0 && <p className="rounded-xl bg-canvas p-3 text-sm text-muted">Chưa có hoạt động học tập đã kết thúc trong tuần này.</p>}
          </div>
          <p className="mt-3 text-xs text-muted">Ăn, ngủ và lịch bận chỉ là ngữ cảnh lập kế hoạch nên không tạo phản tư riêng.</p>
        </Card>}

        <div className="min-w-0 space-y-5">
          {!activity ? (
            <>
              {cycle.isGracePeriod ? (
                <Banner tone="warning" icon="clock">Bạn đang dùng thời gian hoàn thành bù. Weekly Reflect đóng lúc 09:00 sáng nay.</Banner>
              ) : cycle.isOpen ? (
                <Banner tone="info" icon="clock">Weekly Reflect đã mở. Kết quả của các phản tư ngắn sẽ được dùng làm bằng chứng tổng hợp.</Banner>
              ) : (
                <Banner tone="warning" icon="clock">Bạn đang phản tư sớm. AI chỉ dùng dữ liệu đến hiện tại; bạn có thể cập nhật bản tổng kết chính thức Chủ Nhật {formatDM(cycle.weekEnd)} lúc {cycle.opensAt}.</Banner>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile icon="checkCircle" label="Nhiệm vụ hoàn thành" value={`${stats.done} / ${stats.total}`} />
                <StatTile icon="clock" label="Phiên học" value={stats.sessionCount} />
                <StatTile icon="chart" label="Thời gian học" value={formatHours(stats.studiedMin)} />
                <StatTile icon="calendar" label="Kế hoạch dự kiến" value={formatHours(stats.plannedMin)} />
              </div>
            </>
          ) : (
            <Banner tone={activity.missed ? 'warning' : 'info'} icon={activity.missed ? 'alert' : 'checkCircle'}>
              <strong>{activity.kindLabel} · {activity.courseCode}</strong><br />
              {activity.title} · {formatDay(activity.date)}{activity.start ? `, ${activity.start}${activity.end ? `–${activity.end}` : ''}` : ''}
              {activity.actualMinutes != null ? ` · thực tế ${formatDuration(activity.actualMinutes)}` : activity.missed ? ' · chưa có phiên Do' : ''}
            </Banner>
          )}

          <Card aria-labelledby="reflection-questions">
            <CardHeader
              id="reflection-questions"
              title={scope === 'activity' ? 'Phản tư sau hoạt động' : 'Phản tư cả tuần'}
              subtitle={scope === 'activity' ? 'Ghi nhận nhanh trong 20–30 giây.' : 'Tổng hợp mọi môn trong 5–10 phút.'}
            />
            {currentReflection && !dirty && (
              <div className="mb-4"><Banner tone="success" icon="checkCircle">Đã lưu lúc {new Date(currentReflection.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}. Bạn vẫn có thể chỉnh sửa.</Banner></div>
            )}
            <div className="space-y-5">
              {questions.map((label, index) => (
                <Textarea
                  key={label}
                  label={`${index + 1}. ${label}`}
                  value={answers[index]}
                  maxLength={MAX}
                  hint={`${answers[index].length}/${MAX} ký tự`}
                  onChange={(event) => {
                    const next = [...answers] as [string, string, string];
                    next[index] = event.target.value;
                    setAnswers(next);
                  }}
                />
              ))}
            </div>
            {error && <p role="alert" className="mt-4 text-sm font-medium text-danger-ink">{error}</p>}
            {draft && (
              <div className="mt-5 rounded-xl border border-[#D6E2FD] bg-primary-light p-4">
                <h3 className="font-semibold">Bản phản tư do AI đề xuất — chưa lưu</h3>
                <p className="mt-2 whitespace-pre-line text-sm">{draft.response}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button icon="check" onClick={confirm} loading={loading}>{scope === 'activity' ? 'Lưu và về lịch học' : 'Lưu và xem lịch đề xuất'}</Button>
                  <Button variant="secondary" onClick={() => setDraft(null)}>Chỉnh lại câu trả lời</Button>
                </div>
              </div>
            )}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button icon="sparkle" onClick={save} loading={loading} disabled={!!currentReflection && !dirty}>
                {scope === 'activity' ? 'AI phản tư mốc này' : cycle.isOpen ? 'AI tổng kết tất cả' : 'AI phản tư sớm'}
              </Button>
              {requestedActivity && <Button variant="secondary" onClick={() => navigate('/plan')}>Bỏ qua, về lịch học</Button>}
              {dirty && <span className="caption">Có thay đổi chưa lưu</span>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
