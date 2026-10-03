import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { EditBlockModal } from '../../components/domain/EditBlockModal';
import { Schedule } from '../../components/domain/Schedule';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/Toast';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { confirmPlan } from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import type { TimeBlock } from '../../types';
import { durationMin, formatDeadline, formatDuration } from '../../utils/time';

export function PlanPreviewPage() {
  useDocumentTitle('Bản xem trước');
  const { state, dispatch } = useAppStore();
  const { taskById, courseById } = useDerived();
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState<TimeBlock | null>(null);
  const [saving, setSaving] = useState(false);
  const draft = state.planDraft;

  const coverage = useMemo(() => {
    if (!draft) return [];
    const targets = new Map((draft.planningTargets ?? []).map((target) => [target.taskId, target.targetMin]));
    return draft.input.tasks.map((t) => {
      const placed = draft.blocks.filter((b) => b.taskId === t.taskId).reduce((s, b) => s + durationMin(b.start, b.end), 0);
      const required = targets.get(t.taskId) ?? t.remainingMin;
      return { taskId: t.taskId, required, placed, missing: Math.max(0, required - placed) };
    });
  }, [draft]);

  if (!draft) return <Navigate to="/plan" replace />;

  const scheduled = draft.blocks.reduce((s, b) => s + durationMin(b.start, b.end), 0);
  const missing = coverage.filter((c) => c.missing > 0);
  const missingMinutes = missing.reduce((sum, item) => sum + item.missing, 0);
  // A partial plan is still a valid baseline. Blocking confirmation when the
  // learner has insufficient capacity makes Recover unavailable precisely
  // when it is needed most.
  const canSave = draft.blocks.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await confirmPlan();
      dispatch({ type: 'SAVE_PLAN' });
      toast({ tone: 'success', title: 'Kế hoạch đã được lưu', description: 'Bạn vẫn có thể tạo lại hoặc điều chỉnh bất cứ lúc nào.' });
      navigate('/plan');
    } catch {
      toast({ tone: 'danger', title: 'Chưa thể xác nhận kế hoạch', description: 'Bản xem trước vẫn được giữ. Hãy thử lại.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Kiểm tra kế hoạch trước khi lưu" back={{ to: '/plan/new', label: 'Quay lại chỉnh sửa' }} />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border-2 border-dashed border-[#9DB6F5] bg-primary-light px-4 py-4 sm:items-center sm:px-5" role="status">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary-ink">
          <Icon name="edit" size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold uppercase tracking-wide text-primary-ink">Bản xem trước — chưa lưu</p>
          <p className="text-[#23408F]">Kiểm tra các buổi học, thời gian và giả định. Kế hoạch hiện tại chưa thay đổi.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-6">
        <Card aria-labelledby="week">
          <CardHeader id="week" title="Lịch tuần đề xuất" subtitle={`${draft.blocks.length} buổi · ${formatDuration(scheduled)} · bấm biểu tượng bút để sửa từng buổi`} />
          <Schedule blocks={draft.blocks} taskById={taskById} courseById={courseById} onEdit={setEditing} emptyText="Bạn đã bỏ hết các buổi học." />
        </Card>

        <div className="space-y-5">
          <Card aria-labelledby="sum">
            <CardHeader id="sum" title="Quỹ thời gian" />
            <dl className="space-y-2.5">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Đã xếp</dt>
                <dd className="font-semibold tabular-nums">{formatDuration(scheduled)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Thời gian rảnh</dt>
                <dd className="font-semibold tabular-nums">{formatDuration(draft.feasibility.availableMin)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Dự phòng</dt>
                <dd className="font-semibold tabular-nums">{formatDuration(Math.max(0, draft.feasibility.availableMin - scheduled))}</dd>
              </div>
            </dl>
            {missing.length > 0 && (
              <p className="mt-4 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger-ink" role="alert">
                Kế hoạch còn thiếu {formatDuration(missingMinutes)} cho {missing.map((m) => `${taskById.get(m.taskId)?.title ?? m.taskId} (${formatDuration(m.missing)})`).join(', ')}.
                Bạn vẫn có thể lưu phần đã xếp; PaceWise sẽ đánh dấu rủi ro và đưa phần còn thiếu sang Tiến độ/Phục hồi.
              </p>
            )}
            {(draft.feasibility.uncoveredTasks?.length ?? 0) > 0 && (
              <p className="mt-4 rounded-xl bg-warning-light px-3 py-2 text-sm text-warning-ink" role="status">
                {draft.feasibility.uncoveredTasks!.length} deadline trong 14 ngày tới chưa được đưa vào bản kế hoạch này. PaceWise không coi chúng là đã được bảo vệ.
              </p>
            )}
          </Card>

          {(draft.priorityOrder?.length ?? 0) > 0 && (
            <Card aria-labelledby="priority-order">
              <CardHeader
                id="priority-order"
                title="Thứ tự ưu tiên theo deadline"
                subtitle="Khung giờ trên lịch vẫn theo sở thích; danh sách này quyết định nhiệm vụ nào cần được bảo vệ trước."
              />
              <ol className="space-y-3">
                {draft.priorityOrder!.map((item) => (
                  <li key={item.taskId} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                      {item.rank}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{item.title}</p>
                      <p className="caption">
                        Hạn {formatDeadline(item.deadline)} · trọng số nhóm {item.assignmentGroupWeight}% · {item.pointsPossible} điểm
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card aria-labelledby="why">
            <CardHeader id="why" title="Vì sao PaceWise đề xuất lịch này?" />
            <ul className="space-y-2.5">
              {draft.reasons.map((r) => (
                <li key={r} className="flex gap-2.5">
                  <Icon name="check" size={18} className="mt-0.5 shrink-0 text-success-ink" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card tone="accent" aria-labelledby="asm">
            <CardHeader id="asm" title="Giả định của AI" subtitle="Hãy sửa nếu chưa đúng với bạn." />
            <ul className="space-y-2.5">
              {draft.assumptions.map((a) => (
                <li key={a} className="flex gap-2.5">
                  <Icon name="info" size={18} className="mt-0.5 shrink-0 text-accent-ink" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-[76px] z-20 mt-6 flex flex-col-reverse gap-3 rounded-2xl border border-line bg-white/95 p-4 shadow-card backdrop-blur sm:flex-row sm:items-center lg:bottom-4">
        <Button variant="secondary" icon="arrowLeft" onClick={() => navigate('/plan/new')}>
          Quay lại chỉnh sửa
        </Button>
        <p className="caption flex-1 sm:text-right">
          {missing.length > 0
            ? `Lưu ${formatDuration(scheduled)} đã xếp; ${formatDuration(missingMinutes)} còn thiếu sẽ được theo dõi như rủi ro.`
            : 'Chỉ khi bấm “Xác nhận và lưu”, kế hoạch mới được áp dụng.'}
        </p>
        <Button icon="check" disabled={!canSave || saving} onClick={save}>
          {saving ? 'Đang xác nhận...' : missing.length > 0 ? 'Lưu kế hoạch và theo dõi rủi ro' : 'Xác nhận và lưu'}
        </Button>
      </div>

      <EditBlockModal
        block={editing}
        task={editing ? taskById.get(editing.taskId) : undefined}
        blocks={draft.blocks}
        availability={draft.input.availability}
        onClose={() => setEditing(null)}
        onSave={(b) => {
          dispatch({ type: 'UPDATE_DRAFT_BLOCK', block: b });
          setEditing(null);
          toast({ tone: 'info', title: 'Đã cập nhật bản xem trước', description: 'Thay đổi chưa được lưu.' });
        }}
        onRemove={(id) => {
          dispatch({ type: 'REMOVE_DRAFT_BLOCK', id });
          setEditing(null);
        }}
      />
    </div>
  );
}
