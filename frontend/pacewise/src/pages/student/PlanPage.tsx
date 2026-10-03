import { CombinedSchedule } from '../../components/domain/CombinedSchedule';
import { ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Banner, EmptyState } from '../../components/ui/States';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { buildPlanTimeline } from '../../utils/planTimeline';
import { addDays, durationMin, formatDM, formatHours, PLANNING_WINDOW_START } from '../../utils/time';

export function PlanPage() {
  useDocumentTitle('Kế hoạch');
  const { state } = useAppStore();
  const { drifts } = useDerived();
  const plan = state.plan;
  const planStart = state.plan?.weekStart ?? PLANNING_WINDOW_START;
  const weekEnd = addDays(planStart, 6);
  const calendarItems = Object.values(state.courseData)
    .flatMap((course) => course.calendarItems ?? []);
  const timeline = buildPlanTimeline({
    blocks: plan?.blocks ?? [],
    calendarItems,
    tasks: state.tasks,
    courses: state.courses,
    unavailable: state.unavailable,
    from: planStart,
    to: weekEnd,
  });
  const provisionalTimeline = buildPlanTimeline({
    blocks: state.provisionalBlocks,
    calendarItems,
    tasks: state.tasks,
    courses: state.courses,
    unavailable: state.unavailable,
    from: addDays(planStart, 7),
    to: addDays(planStart, 13),
  });
  const lmsItemCount = timeline.filter((item) => item.source === 'lms').length;
  const studyMinutes = (plan?.blocks ?? []).reduce(
    (total, block) => total + durationMin(block.start, block.end),
    0,
  );
  const plannedTaskIds = new Set((plan?.blocks ?? []).map((block) => block.taskId));
  const priorityValue = { high: 0, medium: 1, low: 2 } as const;
  const priorityTasks = state.tasks
    .filter((task) => plannedTaskIds.has(task.id))
    .sort((left, right) => (
      left.deadline.localeCompare(right.deadline)
      || priorityValue[left.priority] - priorityValue[right.priority]
      || (right.assignmentGroup?.weight ?? 0) - (left.assignmentGroup?.weight ?? 0)
      || (right.pointsPossible ?? 0) - (left.pointsPossible ?? 0)
    ));

  return (
    <div className="page">
      <PageHeader
        title="Kế hoạch 7 ngày"
        description={`Từ ${formatDM(planStart)} đến ${formatDM(weekEnd)} · Tất cả môn · GMT+7`}
        actions={state.plan ? <ButtonLink to="/plan/new" icon="plus">Tạo kế hoạch mới</ButtonLink> : undefined}
      />

      {state.planDraft && (
        <div className="mb-5">
          <Banner tone="info" icon="edit" action={<ButtonLink to="/plan/preview" size="sm" variant="secondary">Mở bản xem trước</ButtonLink>}>
            Bạn có một bản xem trước <strong>chưa lưu</strong>. Kế hoạch bên dưới vẫn là bản đang áp dụng.
          </Banner>
        </div>
      )}

      {!state.plan ? (
        <div className="space-y-5">
          <EmptyState
            title="Chưa có kế hoạch cho 7 ngày tới"
            description="Lịch LMS bên dưới là dữ liệu chỉ đọc. Hãy tạo study block để biến các deadline thành hành động cụ thể."
            action={<ButtonLink to="/plan/new" icon="plus" size="lg">Tạo kế hoạch</ButtonLink>}
          />
          {lmsItemCount > 0 && (
            <Card aria-labelledby="lms-week">
              <CardHeader
                id="lms-week"
                title="Lịch LMS trong 7 ngày tới"
                subtitle={`${lmsItemCount} mốc cố định · chưa có study block PaceWise`}
              />
              <CombinedSchedule items={timeline} />
            </Card>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-6">
          <div className="space-y-5">
            <Card aria-labelledby="combined-schedule">
              <CardHeader
                id="combined-schedule"
                title="Lịch tuần hợp nhất"
                subtitle={`Lịch LMS chỉ đọc + study block PaceWise · phiên bản ${state.plan.version}`}
              />
              <CombinedSchedule items={timeline} />
            </Card>

            {state.provisionalBlocks.length > 0 && (
              <Card tone="accent" aria-labelledby="provisional-schedule">
                <CardHeader
                  id="provisional-schedule"
                  title="Dự kiến tuần sau · chưa cam kết"
                  subtitle="Recover dùng tuần sau để kiểm tra xung đột. Các block này chưa thuộc kế hoạch 7 ngày chính thức và cần xác nhận lại khi sang tuần."
                />
                <CombinedSchedule items={provisionalTimeline} />
              </Card>
            )}
          </div>

          <div className="space-y-5">
            <Card aria-labelledby="plan-summary">
              <CardHeader id="plan-summary" title="Tóm tắt" />
              <dl className="space-y-3">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Study block đã xếp</dt>
                  <dd className="font-semibold tabular-nums">{formatHours(studyMinutes)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Số buổi tự học</dt>
                  <dd className="font-semibold">{plan?.blocks.length ?? 0}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Mốc LMS trong tuần</dt>
                  <dd className="font-semibold">{lmsItemCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Phiên bản trước</dt>
                  <dd className="font-semibold">{state.planHistory.length} bản trong lịch sử</dd>
                </div>
              </dl>
            </Card>

            {priorityTasks.length > 0 && (
              <Card aria-labelledby="saved-priority-order">
                <CardHeader
                  id="saved-priority-order"
                  title="Nên làm trước"
                  subtitle="Xếp theo deadline, mức ưu tiên, trọng số nhóm bài và điểm số."
                />
                <ol className="space-y-2.5">
                  {priorityTasks.map((task, index) => (
                    <li key={task.id} className="flex items-start gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-primary-ink">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold">{task.title}</p>
                        <p className="caption">Hạn {formatDM(task.deadline)} · {task.assignmentGroup?.weight ?? 0}% trọng số nhóm</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            )}

            {drifts.length > 0 && (
              <Card tone="warning" aria-labelledby="plan-drift">
                <CardHeader
                  id="plan-drift"
                  title="Kế hoạch đang lệch"
                  subtitle={`${state.tasks.find((task) => task.id === drifts[0].taskId)?.title ?? 'Nhiệm vụ'} thiếu khoảng ${formatHours(drifts[0].deficitMin)}`}
                />
                <ButtonLink
                  to={`/recover?taskId=${encodeURIComponent(drifts[0].taskId)}&courseId=${encodeURIComponent(drifts[0].courseId)}`}
                  block
                  iconRight="arrowRight"
                >
                  Xem phương án phục hồi
                </ButtonLink>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
