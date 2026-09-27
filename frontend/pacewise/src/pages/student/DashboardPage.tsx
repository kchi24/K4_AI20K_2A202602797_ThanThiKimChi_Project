import { useState } from 'react';
import { NextActionCard } from '../../components/domain/NextActionCard';
import { TaskCard } from '../../components/domain/TaskCard';
import { WarningCard } from '../../components/domain/WarningCard';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { syncCanvas } from '../../services/api';
import { tasks as seedTasks } from '../../data/courses';
import { diffDays } from '../../utils/time';
import { formatDay, formatHours, TIMEZONE_LABEL, DEMO_TODAY, DEMO_NOW } from '../../utils/time';

export function DashboardPage() {
  useDocumentTitle('Tổng quan');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const { next, drifts, stats, taskById, courseById, courseOf } = useDerived();
  const firstName = state.user?.name.split(' ').slice(-1)[0] ?? 'bạn';
  const [syncing, setSyncing] = useState(false);

  const handleSyncCanvas = async () => {
    setSyncing(true);
    await syncCanvas();
    dispatch({ type: 'SYNC_CANVAS', tasks: seedTasks });
    setSyncing(false);
    toast({ tone: 'success', title: 'Đã đồng bộ dữ liệu môn học từ Canvas', description: 'Các bài tập và deadline đã được cập nhật vào hệ thống.' });
  };

  const weekTasks = state.tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => diffDays(b.deadline, a.deadline))
    .slice(0, 4);
  const topDrift = drifts[0];

  return (
    <div className="page">
      <header className="mb-6 sm:mb-8">
        <p className="caption">
          {formatDay(DEMO_TODAY)} · {DEMO_NOW} ({TIMEZONE_LABEL})
        </p>
        <h1 className="mt-1 text-[26px] font-bold tracking-tight sm:text-[30px]">Chào {firstName}, hôm nay mình làm gì trước?</h1>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">
        <div className="min-w-0 space-y-5 lg:space-y-6">
          {next ? (
            <NextActionCard next={next} course={courseOf(next.task.id)} sessionRunning={state.activeSession?.taskId === next.task.id} />
          ) : state.tasks.length === 0 ? (
            <EmptyState
              icon="book"
              title="Tuần này chưa có môn học & deadline"
              description="PaceWise cần danh sách bài tập từ Canvas LMS để giúp bạn sắp xếp thời gian học và theo dõi tiến độ."
              action={
                <Button
                  icon="refresh"
                  size="lg"
                  loading={syncing}
                  onClick={handleSyncCanvas}
                >
                  Đồng bộ dữ liệu từ Canvas
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Chưa có kế hoạch cho tuần này"
              description="Thêm mục tiêu, deadline và thời gian rảnh để PaceWise gợi ý việc nên làm tiếp theo."
              action={
                <ButtonLink to="/plan/new" icon="plus" size="lg">
                  Tạo kế hoạch
                </ButtonLink>
              }
            />
          )}

          {topDrift && taskById.get(topDrift.taskId) && <WarningCard drift={topDrift} task={taskById.get(topDrift.taskId)!} compact />}

          <Card aria-labelledby="week-title">
            <CardHeader id="week-title" title="Tuần này" subtitle="Những việc gần deadline nhất" action={state.tasks.length > 0 ? <ButtonLink to="/progress" variant="ghost" size="sm">Xem tất cả</ButtonLink> : undefined} />
            {weekTasks.length ? (
              <div className="space-y-2.5">
                {weekTasks.map((t) => (
                  <TaskCard key={t.id} task={t} course={courseById.get(t.courseId)} compact atRisk={drifts.some((d) => d.taskId === t.id)} />
                ))}
              </div>
            ) : (
              <p className="py-2 text-muted">Chưa có deadline nào trong tuần này. Dữ liệu bài tập sẽ xuất hiện sau khi bạn đồng bộ từ Canvas.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5 lg:space-y-6">
          <Card aria-labelledby="progress-title">
            <CardHeader id="progress-title" title="Tiến độ" />
            {state.tasks.length === 0 ? (
              <div className="py-1">
                <p className="text-xl font-bold text-muted">Chưa có dữ liệu</p>
                <p className="caption mt-1">Tiến độ sẽ hiển thị sau khi đồng bộ môn học từ Canvas.</p>
              </div>
            ) : (
              <>
                <p className="text-3xl font-bold tabular-nums">
                  {stats.done} / {stats.total}
                  <span className="ml-2 text-base font-medium text-muted">nhiệm vụ hoàn thành</span>
                </p>
                <ProgressBar className="mt-3" value={stats.done} max={stats.total} label="Nhiệm vụ hoàn thành tuần này" tone="success" />
              </>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-canvas p-3">
                <dt className="caption">Đã học tuần này</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatHours(stats.studiedMin)}</dd>
              </div>
              <div className="rounded-xl bg-canvas p-3">
                <dt className="caption">Kế hoạch cả tuần</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatHours(stats.plannedMin)}</dd>
              </div>
            </dl>
          </Card>

          <Card aria-labelledby="attention-title">
            <CardHeader id="attention-title" title="Cần chú ý" />
            {state.tasks.length === 0 ? (
              <p className="text-muted">Tài khoản mới chưa có dữ liệu. Vui lòng bấm <strong>“Đồng bộ dữ liệu từ Canvas”</strong> để bắt đầu.</p>
            ) : !state.plan ? (
              <div className="space-y-3">
                <p className="text-muted">Chưa có kế hoạch tuần. Hãy tạo kế hoạch để PaceWise theo dõi tiến độ và hỗ trợ điều chỉnh khi cần.</p>
                <ButtonLink to="/plan/new" variant="soft" block icon="plus">
                  Tạo kế hoạch tuần
                </ButtonLink>
              </div>
            ) : topDrift ? (
              <div className="space-y-3">
                <p>
                  <strong>{taskById.get(topDrift.taskId)?.title}</strong> đang có nguy cơ trễ khoảng <strong>{formatHours(topDrift.deficitMin)}</strong>.
                </p>
                <ButtonLink to="/recover" variant="soft" block iconRight="arrowRight">
                  Xem phương án
                </ButtonLink>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-success-ink">Kế hoạch đang đúng hướng. Không có gì cần xử lý.</p>
            )}
          </Card>

          {state.plan && (
            <Card aria-labelledby="plan-title">
              <CardHeader id="plan-title" title="Kế hoạch đã lưu" subtitle={`Phiên bản ${state.plan.version} · ${state.plan.blocks.length} buổi học`} />
              <ButtonLink to="/plan" variant="secondary" block>
                Mở kế hoạch tuần
              </ButtonLink>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
