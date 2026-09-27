import { Schedule } from '../../components/domain/Schedule';
import { ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Banner, EmptyState } from '../../components/ui/States';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { durationMin, formatDay, formatDM, formatHours, WEEK_START, addDays } from '../../utils/time';

export function PlanPage() {
  useDocumentTitle('Kế hoạch');
  const { state } = useAppStore();
  const { taskById, courseById, drifts } = useDerived();
  const plan = state.plan;

  return (
    <div className="page">
      <PageHeader
        title="Kế hoạch tuần"
        description={`Tuần ${formatDM(WEEK_START)} – ${formatDM(addDays(WEEK_START, 6))} · giờ hiển thị theo GMT+7`}
        actions={
          plan && (
            <>
              <ButtonLink to="/plan/new" icon="plus">
                Tạo kế hoạch mới
              </ButtonLink>
            </>
          )
        }
      />

      {state.planDraft && (
        <div className="mb-5">
          <Banner tone="info" icon="edit" action={<ButtonLink to="/plan/preview" size="sm" variant="secondary">Mở bản xem trước</ButtonLink>}>
            Bạn có một bản xem trước <strong>chưa lưu</strong>. Kế hoạch dưới đây vẫn là bản đang áp dụng.
          </Banner>
        </div>
      )}

      {!plan ? (
        <EmptyState
          title="Chưa có kế hoạch cho tuần này"
          description="Thêm mục tiêu, deadline và thời gian rảnh để tạo một kế hoạch có thể kiểm tra."
          action={
            <ButtonLink to="/plan/new" icon="plus" size="lg">
              Tạo kế hoạch
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-6">
          <Card aria-labelledby="sched">
            <CardHeader
              id="sched"
              title="Lịch học đã xác nhận"
              subtitle={`Phiên bản ${plan.version} · lưu lúc ${new Date(plan.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}, ${formatDay(plan.savedAt.slice(0, 10))}`}
            />
            <Schedule blocks={plan.blocks} taskById={taskById} courseById={courseById} />
          </Card>
          <div className="space-y-5">
            <Card aria-labelledby="sum">
              <CardHeader id="sum" title="Tóm tắt" />
              <dl className="space-y-3">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Tổng thời gian đã xếp</dt>
                  <dd className="font-semibold tabular-nums">{formatHours(plan.blocks.reduce((s, b) => s + durationMin(b.start, b.end), 0))}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Số buổi học</dt>
                  <dd className="font-semibold">{plan.blocks.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Phiên bản trước</dt>
                  <dd className="font-semibold">{state.planHistory.length} bản trong lịch sử</dd>
                </div>
              </dl>
            </Card>
            {drifts.length > 0 && (
              <Card tone="warning" aria-labelledby="dr">
                <CardHeader id="dr" title="Kế hoạch đang lệch" subtitle={`${taskById.get(drifts[0].taskId)?.title} trễ khoảng ${formatHours(drifts[0].deficitMin)}`} />
                <ButtonLink to="/recover" block iconRight="arrowRight">
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
