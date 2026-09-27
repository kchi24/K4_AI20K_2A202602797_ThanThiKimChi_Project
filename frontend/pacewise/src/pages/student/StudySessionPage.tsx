import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CourseTag } from '../../components/domain/TaskCard';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input, Textarea } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Banner, EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useTimer } from '../../hooks/useTimer';
import { useAppStore } from '../../store/AppStore';
import { remainingOf } from '../../utils/progress';
import { formatDuration, formatTimer } from '../../utils/time';

export function StudySessionPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { state, dispatch } = useAppStore();
  const { taskById, courseOf } = useDerived();
  const toast = useToast();
  const task = taskById.get(taskId);
  const session = state.activeSession;
  const mine = session?.taskId === taskId ? session : null;
  const elapsed = useTimer(mine);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<{ minutes: number } | null>(null);
  const [showSmartTriage, setShowSmartTriage] = useState(false);
  const [offlineMinutes, setOfflineMinutes] = useState(String(task?.estimateMin || 45));
  useDocumentTitle(mine ? `${formatTimer(elapsed)} · ${task?.title}` : 'Phiên học');

  if (!task) {
    return (
      <div className="page">
        <EmptyState icon="file" title="Không tìm thấy nhiệm vụ" description="Hãy chọn lại nhiệm vụ từ Dashboard." action={<ButtonLink to="/dashboard">Về trang Tổng quan</ButtonLink>} />
      </div>
    );
  }

  const other = session && session.taskId !== taskId ? taskById.get(session.taskId) : null;
  const course = courseOf(task.id);

  if (done) {
    const updated = taskById.get(task.id)!;
    const isOverEstimate = updated.status !== 'done' && updated.loggedMin >= updated.estimateMin;
    const remaining = remainingOf(updated);

    return (
      <div className="page max-w-2xl">
        <Card tone="success" className="text-center" role="status">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-success-ink">
            <Icon name="checkCircle" size={30} />
          </span>
          <h1 className="mt-4 text-2xl font-bold">Phiên học đã hoàn thành</h1>
          <dl className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3 text-left">
            <div className="rounded-xl bg-white p-4">
              <dt className="caption">Thời gian phiên</dt>
              <dd className="text-xl font-bold">{formatDuration(done.minutes)}</dd>
            </div>
            <div className="rounded-xl bg-white p-4">
              <dt className="caption">Task còn khoảng</dt>
              <dd className="text-xl font-bold">
                {updated.status === 'done' ? 'Đã xong' : isOverEstimate ? 'Cần thêm giờ' : formatDuration(remaining)}
              </dd>
            </div>
          </dl>
          <p className="caption mt-4">Đã lưu vào tiến độ lúc {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.</p>

          {updated.status !== 'done' && (
            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-line bg-canvas p-4 text-left">
              <div className="flex items-center gap-2">
                <Icon name="clock" size={18} className="text-primary-ink" />
                <h3 className="text-sm font-semibold">
                  {isOverEstimate ? 'Nhiệm vụ cần thêm thời gian?' : 'Cập nhật thời gian còn lại?'}
                </h3>
              </div>
              <p className="caption mt-1">
                {isOverEstimate
                  ? `Đã học ${formatDuration(updated.loggedMin)} (vượt ước tính ${formatDuration(updated.estimateMin)}). Hãy cộng thêm số phút cần thiết để PaceWise tính lại kế hoạch và cảnh báo chính xác:`
                  : `Dự kiến còn ${formatDuration(remaining)}. Nếu cần thêm thời gian, bạn có thể điều chỉnh nhanh:`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[15, 30, 45, 60].map((extra) => (
                  <button
                    key={extra}
                    type="button"
                    onClick={() => {
                      const newEst = updated.loggedMin + extra;
                      dispatch({ type: 'UPDATE_TASK_ESTIMATE', taskId: task.id, estimateMin: newEst });
                      toast({ tone: 'success', title: `Đã cập nhật: còn lại khoảng ${formatDuration(extra)}` });
                    }}
                    className="min-h-[36px] rounded-lg border border-line bg-white px-3 text-xs font-semibold hover:border-primary hover:bg-primary-light"
                  >
                    +{extra} phút
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
            <ButtonLink to="/dashboard" variant="secondary">
              Xem việc tiếp theo
            </ButtonLink>
            {updated.status !== 'done' && (
              <Button
                variant="primary"
                icon="check"
                onClick={() => {
                  dispatch({ type: 'SET_TASK_DONE', taskId: task.id, done: true });
                  toast({ tone: 'success', title: `Đã đánh dấu “${task.title}” hoàn thành` });
                }}
              >
                Đánh dấu task đã xong
              </Button>
            )}
            <ButtonLink to={`/learn?tab=check&topic=${encodeURIComponent(course?.name ?? '')}`} variant="secondary" icon="checkCircle">
              Kiểm tra nhanh hiểu bài
            </ButtonLink>
            <ButtonLink to="/learn" variant="ghost" icon="message">
              Hỏi tài liệu bài học
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  const running = !!mine?.runningSince;
  const target = Math.min(90, Math.max(25, remainingOf(task))) * 60000;

  return (
    <div className="page max-w-3xl">
      <PageHeader back={{ to: `/study/${task.id}`, label: 'Chi tiết nhiệm vụ' }} title="Phiên học" />
      {other && (
        <div className="mb-5">
          <Banner tone="warning" icon="alert" action={<ButtonLink to={`/study/${other.id}/session`} size="sm" variant="secondary">Mở phiên đang chạy</ButtonLink>}>
            Bạn đang có một phiên học cho <strong>{other.title}</strong>. Kết thúc phiên đó trước khi bắt đầu phiên mới.
          </Banner>
        </div>
      )}
      <Card className="text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h2 className="text-xl font-semibold">
            {task.title} — {course?.name}
          </h2>
          <CourseTag course={course} />
        </div>
        <p
          className="mt-6 font-bold tabular-nums tracking-tight text-ink"
          style={{ fontSize: 'clamp(48px, 14vw, 80px)', lineHeight: 1.05 }}
          role="timer"
          aria-live="off"
          aria-label={`Đã học ${Math.floor(elapsed / 60000)} phút`}
        >
          {formatTimer(elapsed)}
        </p>
        <p className="mt-2 text-muted">{mine ? (running ? 'Đang tính giờ' : 'Đã tạm dừng') : 'Sẵn sàng bắt đầu'}</p>
        <ProgressBar className="mx-auto mt-4 max-w-sm" value={elapsed} max={target} label="Thời gian phiên so với mục tiêu" />
        <p className="caption mt-2">Gợi ý cho phiên này: {formatDuration(target / 60000)}</p>

        <div className="mx-auto mt-6 max-w-md rounded-xl bg-canvas px-4 py-3 text-left">
          <p className="text-sm font-semibold text-muted">Mục tiêu</p>
          <p className="mt-1">{task.objective}</p>
        </div>

        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          {!mine ? (
            <Button size="lg" icon="play" disabled={!!other} onClick={() => dispatch({ type: 'START_SESSION', taskId: task.id })}>
              Bắt đầu học
            </Button>
          ) : (
            <>
              {running ? (
                <Button size="lg" variant="secondary" icon="pause" onClick={() => dispatch({ type: 'PAUSE_SESSION' })}>
                  Tạm dừng
                </Button>
              ) : (
                <Button size="lg" variant="secondary" icon="play" onClick={() => dispatch({ type: 'RESUME_SESSION' })}>
                  Tiếp tục
                </Button>
              )}
              <Button
                size="lg"
                icon="check"
                onClick={() => {
                  // If session is less than 2 minutes, open Smart Triage to diagnose true intent!
                  if (elapsed < 120000) {
                    setOfflineMinutes(String(task?.estimateMin || 45));
                    setShowSmartTriage(true);
                    return;
                  }
                  const minutes = Math.max(1, Math.round(elapsed / 60000));
                  dispatch({ type: 'COMPLETE_SESSION', minutes, note: note.trim() || undefined });
                  setDone({ minutes });
                }}
              >
                Hoàn thành
              </Button>
            </>
          )}
        </div>
        {mine && (
          <button
            className="mt-4 min-h-[44px] text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
            onClick={() => {
              dispatch({ type: 'CANCEL_SESSION' });
              toast({ tone: 'info', title: 'Đã hủy phiên học', description: 'Không có thời gian nào được ghi.' });
            }}
          >
            Hủy phiên (không ghi thời gian)
          </button>
        )}
      </Card>
      {mine && (
        <Card className="mt-5">
          <Textarea label="Ghi chú cho phiên này" hint="Không bắt buộc. Ví dụ: đã đọc xong phần 2.1." value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Card>
      )}
      <p className="caption mt-4 text-center">Nếu rời trang, đồng hồ vẫn tiếp tục chạy. Chỉ có thể chạy một phiên cùng lúc.</p>

      {/* Smart Triage Dialog for < 2 minute completions */}
      <Modal
        open={showSmartTriage}
        onClose={() => setShowSmartTriage(false)}
        title="Xác nhận hoàn tất phiên học"
        description={`Đồng hồ mới chạy ${formatTimer(elapsed)}. PaceWise tôn trọng việc tự học thực tế của bạn, hãy chọn đúng ngữ cảnh:`}
        size="lg"
      >
        <div className="space-y-4">
          {/* Lựa chọn 1 */}
          <div className="rounded-xl border border-line bg-canvas/40 p-4 transition hover:border-primary">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-light text-xs font-bold text-primary-ink">
                1
              </span>
              <h4 className="font-semibold text-ink">Mình đã tự học xong từ trước (offline)</h4>
            </div>
            <p className="caption mt-1">
              Ghi nhận đúng thời lượng bạn đã học bên ngoài để số liệu tuần và đánh giá Reflect cuối tuần chính xác.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Input
                  label="Số phút thực tế"
                  type="number"
                  value={offlineMinutes}
                  onChange={(e) => setOfflineMinutes(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="60"
                />
              </div>
              <Button
                size="sm"
                icon="check"
                onClick={() => {
                  const m = Math.max(1, Number(offlineMinutes) || task?.estimateMin || 45);
                  dispatch({ type: 'COMPLETE_SESSION', minutes: m, note: note.trim() || 'Tự học offline' });
                  setShowSmartTriage(false);
                  setDone({ minutes: m });
                  toast({ tone: 'success', title: `Đã ghi nhận ${formatDuration(m)} học offline` });
                }}
              >
                Lưu {offlineMinutes || task?.estimateMin} phút
              </Button>
            </div>
          </div>

          {/* Lựa chọn 2 */}
          <div className="rounded-xl border border-line bg-canvas/40 p-4 transition hover:border-primary">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-light text-xs font-bold text-accent-ink">
                2
              </span>
              <h4 className="font-semibold text-ink">Đã nắm vững kiến thức này từ trước</h4>
            </div>
            <p className="caption mt-1">
              Hoàn thành bài sớm mà không cần ghi giờ. Bạn có thể làm 1 câu kiểm tra nhanh để xác nhận năng lực.
            </p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <Button
                size="sm"
                variant="secondary"
                icon="checkCircle"
                onClick={() => {
                  dispatch({ type: 'CANCEL_SESSION' });
                  dispatch({ type: 'SET_TASK_DONE', taskId: task.id, done: true });
                  setShowSmartTriage(false);
                  navigate(`/learn?tab=check&topic=${encodeURIComponent(course?.name ?? '')}`);
                  toast({ tone: 'info', title: 'Hoàn thành sớm', description: 'Chuyển sang phần Kiểm tra nhanh để xác nhận độ hiểu bài.' });
                }}
              >
                Làm 1 câu Kiểm tra nhanh xác nhận
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  dispatch({ type: 'CANCEL_SESSION' });
                  dispatch({ type: 'SET_TASK_DONE', taskId: task.id, done: true });
                  setShowSmartTriage(false);
                  toast({ tone: 'success', title: `Đã đánh dấu “${task.title}” hoàn thành` });
                  navigate('/dashboard');
                }}
              >
                Đánh dấu xong ngay (bỏ qua)
              </Button>
            </div>
          </div>

          {/* Lựa chọn 3 */}
          <div className="rounded-xl border border-line bg-slate-50 p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-xs font-bold text-slate-700">
                3
              </span>
              <h4 className="font-semibold text-ink">Bấm nhầm hoặc chưa bắt đầu học</h4>
            </div>
            <p className="caption mt-1">Hủy phiên này, không ghi nhận thời gian ảo vào lịch sử học tập.</p>
            <div className="mt-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  dispatch({ type: 'CANCEL_SESSION' });
                  setShowSmartTriage(false);
                  toast({ tone: 'info', title: 'Đã hủy phiên học', description: 'Không có thời gian nào bị ghi nhận.' });
                }}
              >
                Hủy phiên (không ghi giờ)
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
