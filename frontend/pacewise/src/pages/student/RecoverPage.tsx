import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/States';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { cx } from '../../utils/cx';
import { buildRecoveryOptions } from '../../utils/recovery';
import { formatDay, formatHours } from '../../utils/time';

export function useRecoveryOptions() {
  const { state } = useAppStore();
  const { drifts } = useDerived();
  const drift = drifts[0];
  const options = useMemo(
    () => (drift && state.plan ? buildRecoveryOptions(state.plan, state.tasks, drift, state.availability, state.unavailable) : []),
    [drift, state.plan, state.tasks, state.availability, state.unavailable],
  );
  return { drift, options };
}

export function RecoverPage() {
  useDocumentTitle('Phục hồi kế hoạch');
  const { state } = useAppStore();
  const { taskById } = useDerived();
  const { drift, options } = useRecoveryOptions();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  if (!state.plan) {
    return (
      <div className="page">
        <PageHeader title="Phục hồi kế hoạch" />
        <EmptyState
          icon="calendar"
          title="Chưa có kế hoạch tuần"
          description="Bạn cần tạo kế hoạch học tập trước để PaceWise có thể theo dõi và hỗ trợ phục hồi khi có lịch học bị lệch."
          action={
            <ButtonLink to="/plan/new" icon="plus" size="lg">
              Tạo kế hoạch ngay
            </ButtonLink>
          }
        />
      </div>
    );
  }

  if (!drift) {
    return (
      <div className="page">
        <PageHeader title="Phục hồi kế hoạch" />
        <EmptyState
          icon="checkCircle"
          title="Kế hoạch đang đúng hướng"
          description="Hiện không có nhiệm vụ nào bị lệch so với kế hoạch. PaceWise sẽ báo khi cần điều chỉnh."
          action={<ButtonLink to="/dashboard">Về trang Tổng quan</ButtonLink>}
        />
      </div>
    );
  }
  const task = taskById.get(drift.taskId)!;

  return (
    <div className="page">
      <PageHeader
        title="Phục hồi kế hoạch"
        description={
          <>
            {task.title} đang trễ khoảng <strong className="text-ink">{formatHours(drift.deficitMin)}</strong> (dự kiến {formatHours(drift.expectedMin)}, đã học{' '}
            {formatHours(drift.loggedMin)}). Deadline {formatDay(drift.deadline)}, 23:59.
          </>
        }
      />
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#D6E2FD] bg-primary-light px-4 py-3 text-[#23408F]" role="status">
        <Icon name="info" size={20} className="mt-0.5 shrink-0" />
        <p>Chưa có thay đổi nào được áp dụng. Chọn một phương án để xem chi tiết thay đổi trước khi quyết định.</p>
      </div>

      <fieldset>
        <legend className="sr-only">Chọn phương án phục hồi</legend>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {options.map((o) => {
            const active = selected === o.id;
            return (
              <label
                key={o.id}
                className={cx(
                  'relative flex cursor-pointer flex-col rounded-2xl border-2 bg-white p-5 shadow-card transition-colors',
                  active ? 'border-primary-dark ring-4 ring-primary/10' : 'border-line hover:border-[#C9D8FB]',
                )}
              >
                <input type="radio" name="option" value={o.id} checked={active} onChange={() => setSelected(o.id)} className="sr-only" />
                <div className="flex items-center gap-2">
                  <span className={cx('flex h-6 w-6 items-center justify-center rounded-full border-2', active ? 'border-primary-dark bg-primary-dark text-white' : 'border-slate-300')} aria-hidden="true">
                    {active && <Icon name="check" size={14} />}
                  </span>
                  <span className="text-sm font-semibold text-muted">Phương án {o.id}</span>
                  {o.id !== 'C' && o.fullyRecovers && (
                    <Badge tone="success" className="ml-auto">
                      Bù đủ
                    </Badge>
                  )}
                  {o.id !== 'C' && !o.fullyRecovers && (
                    <Badge tone="warning" className="ml-auto">
                      Bù một phần
                    </Badge>
                  )}
                </div>
                <h2 className="mt-3 text-lg font-semibold">{o.title}</h2>
                <p className="mt-1 text-muted">{o.summary}</p>
                <dl className="mt-4 space-y-3 text-[15px]">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Thay đổi</dt>
                    <dd>
                      <ul className="mt-1 space-y-1">
                        {o.changes.map((c) => (
                          <li key={c} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
                            {c}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Tác động</dt>
                    <dd className="mt-1">{o.impact}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Thời gian</dt>
                    <dd className="mt-1">{o.time}</dd>
                  </div>
                  <div className="rounded-xl bg-warning-light px-3 py-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-warning-ink">Đánh đổi</dt>
                    <dd className="mt-1">{o.tradeoff}</dd>
                  </div>
                </dl>
              </label>
            );
          })}
        </div>
      </fieldset>
      {options.length < 3 && <p className="caption mt-3">Chỉ có {options.length} phương án thỏa ràng buộc về thời gian rảnh và deadline.</p>}

      <div className="sticky bottom-[76px] z-20 mt-6 flex flex-col-reverse gap-3 rounded-2xl border border-line bg-white/95 p-4 shadow-card backdrop-blur sm:flex-row sm:items-center lg:bottom-4">
        <ButtonLink to="/dashboard" variant="secondary">
          Để sau
        </ButtonLink>
        <p className="caption flex-1 sm:text-right">{selected ? `Đã chọn phương án ${selected}. Lịch chưa thay đổi.` : 'Bạn chưa chọn phương án nào.'}</p>
        <Button iconRight="arrowRight" disabled={!selected} onClick={() => navigate(`/recover/${selected}`)}>
          Xem thay đổi
        </Button>
      </div>
    </div>
  );
}
