import { useParams } from 'react-router-dom';
import { CourseTag, deadlineLabel, deadlineTone } from '../../components/domain/TaskCard';
import { Badge } from '../../components/ui/Badge';
import { ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { EmptyState } from '../../components/ui/States';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { remainingOf, sortBlocks } from '../../utils/progress';
import { formatDay, formatDeadline, formatDuration, formatRange, isPast } from '../../utils/time';

export function TaskDetailPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const { state } = useAppStore();
  const { taskById, courseOf } = useDerived();
  const task = taskById.get(taskId);
  useDocumentTitle(task?.title ?? 'Nhiệm vụ');

  if (!task) {
    return (
      <div className="page">
        <EmptyState icon="file" title="Không tìm thấy nhiệm vụ" description="Nhiệm vụ có thể đã bị xóa khỏi dữ liệu Canvas." action={<ButtonLink to="/progress">Về trang Tiến độ</ButtonLink>} />
      </div>
    );
  }
  const course = courseOf(task.id);
  const upcoming = sortBlocks(state.plan?.blocks.filter((b) => b.taskId === task.id && !isPast(b.date, b.end)) ?? []);
  const sessions = state.sessions.filter((s) => s.taskId === task.id);
  const running = state.activeSession?.taskId === task.id;

  return (
    <div className="page max-w-4xl">
      <PageHeader
        back={{ to: '/dashboard', label: 'Tổng quan' }}
        eyebrow={
          <span className="flex flex-wrap gap-2">
            <CourseTag course={course} />
            <Badge tone={deadlineTone(task)}>{deadlineLabel(task)}</Badge>
          </span>
        }
        title={task.title}
        actions={
          task.status !== 'done' && (
            <ButtonLink to={`/study/${task.id}/session`} icon="play" size="lg">
              {running ? 'Tiếp tục phiên học' : 'Bắt đầu học'}
            </ButtonLink>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card aria-labelledby="info">
          <CardHeader id="info" title="Thông tin" />
          <dl className="space-y-3">
            <div className="flex gap-3">
              <Icon name="book" size={20} className="mt-0.5 text-muted" />
              <div>
                <dt className="caption">Môn</dt>
                <dd className="font-medium">
                  {course?.code} · {course?.name}
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Icon name="flag" size={20} className="mt-0.5 text-muted" />
              <div>
                <dt className="caption">Deadline</dt>
                <dd className="font-medium">{formatDeadline(task.deadline)} (GMT+7)</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Icon name="clock" size={20} className="mt-0.5 text-muted" />
              <div>
                <dt className="caption">Thời lượng ước tính</dt>
                <dd className="font-medium">
                  {formatDuration(task.estimateMin)}
                  {task.estimateIsAssumption && <span className="caption"> · ước lượng của PaceWise</span>}
                </dd>
              </div>
            </div>
          </dl>
        </Card>
        <Card aria-labelledby="obj">
          <CardHeader id="obj" title="Mục tiêu" />
          <p className="flex gap-3">
            <Icon name="target" size={20} className="mt-0.5 shrink-0 text-primary-ink" />
            {task.objective}
          </p>
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-sm">
              <span className="text-muted">Đã học</span>
              <span className="font-semibold tabular-nums">
                {formatDuration(task.loggedMin)} / {formatDuration(task.estimateMin)}
              </span>
            </div>
            <ProgressBar value={task.loggedMin} max={task.estimateMin} label={`Tiến độ ${task.title}`} />
            <p className="caption mt-2">{task.status === 'done' ? 'Đã hoàn thành' : `Còn khoảng ${formatDuration(remainingOf(task))}`}</p>
          </div>
        </Card>
        <Card aria-labelledby="up">
          <CardHeader id="up" title="Buổi học sắp tới" />
          {upcoming.length ? (
            <ul className="space-y-2">
              {upcoming.map((b) => (
                <li key={b.id} className="flex justify-between gap-3 rounded-xl bg-canvas px-3 py-2.5">
                  <span>{formatDay(b.date, { relative: true })}</span>
                  <span className="font-semibold tabular-nums">{formatRange(b.start, b.end)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Không có buổi nào trong kế hoạch.</p>
          )}
        </Card>
        <Card aria-labelledby="hist">
          <CardHeader id="hist" title="Phiên học đã ghi" />
          {sessions.length ? (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 rounded-xl bg-canvas px-3 py-2.5">
                  <span>
                    {formatDay(s.date)} · {s.source === 'timer' ? 'Hẹn giờ' : 'Nhập tay'}
                  </span>
                  <span className="font-semibold tabular-nums">{formatDuration(s.minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Chưa có phiên học nào.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
