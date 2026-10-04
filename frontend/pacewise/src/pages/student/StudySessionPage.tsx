import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DoSessionSupport } from '../../components/domain/DoSessionSupport';
import { CourseTag } from '../../components/domain/TaskCard';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input, Textarea } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Banner, EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useTimer } from '../../hooks/useTimer';
import { evaluateDoSession, prepareDoSession } from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import type { DoBlocker, DoSessionEvaluation, DoSessionPreparation } from '../../types';
import { remainingOf } from '../../utils/progress';
import { minutesUntil, studyBlockAccess } from '../../utils/studyBlockAccess';
import { durationMin, formatDay, formatDuration, formatTimer } from '../../utils/time';

const OUTCOME_LABEL: Record<DoSessionEvaluation['status'], string> = {
  on_track: 'Đúng tiến độ',
  completed: 'Hoàn thành milestone',
  needs_more_time: 'Cần thêm thời gian',
  blocked: 'Đang bị kẹt kiến thức',
  missed: 'Bỏ lỡ phiên học',
};

export function StudySessionPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const blockId = searchParams.get('blockId');
  const navigate = useNavigate();
  const { state, dispatch } = useAppStore();
  const { taskById, courseOf } = useDerived();
  const toast = useToast();
  const task = taskById.get(taskId);
  const session = state.activeSession;
  const mine = session?.taskId === taskId ? session : null;
  const elapsed = useTimer(mine);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<{ minutes: number; evaluation?: DoSessionEvaluation } | null>(null);
  const [showSmartTriage, setShowSmartTriage] = useState(false);
  const [showSessionReview, setShowSessionReview] = useState(false);
  const [completionPercent, setCompletionPercent] = useState(100);
  const [blocker, setBlocker] = useState<DoBlocker>('none');
  const [blockerNote, setBlockerNote] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [preparation, setPreparation] = useState<DoSessionPreparation | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [offlineMinutes, setOfflineMinutes] = useState(String(task?.estimateMin || 45));
  const [clock, setClock] = useState(Date.now());
  const taskBlocks = [...(state.plan?.blocks ?? [])]
    .filter((block) => block.taskId === taskId && block.status !== 'history')
    .sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start));
  const plannedBlock = blockId
    ? taskBlocks.find((block) => block.id === blockId)
    : taskBlocks.find((block) => studyBlockAccess(block, clock).state === 'available')
      ?? taskBlocks.find((block) => studyBlockAccess(block, clock).state === 'too_early')
      ?? taskBlocks[taskBlocks.length - 1];
  const access = plannedBlock ? studyBlockAccess(plannedBlock, clock) : undefined;
  const course = task ? courseOf(task.id) : undefined;
  useEffect(() => {
    if (!blockId) return;
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [blockId]);
  useEffect(() => {
    if (!plannedBlock || !task || !course || access?.state !== 'available') return;
    let active = true;
    setPreparing(true);
    setPreparation(null);
    setPrepareError('');
    void prepareDoSession({
      courseId: course.id,
      blockId: plannedBlock.id,
      taskId: task.id,
      title: task.title,
      objective: plannedBlock.milestoneTitle ?? task.objective,
      plannedMinutes: Math.max(1, durationMin(plannedBlock.start, plannedBlock.end)),
    }).then((result) => {
      if (active) setPreparation(result);
    }).catch((error) => {
      if (active) setPrepareError(error instanceof Error ? error.message : 'Do Agent chưa chuẩn bị được học liệu.');
    }).finally(() => {
      if (active) setPreparing(false);
    });
    return () => { active = false; };
  }, [access?.state, course, plannedBlock, task]);
  useDocumentTitle(mine ? `${formatTimer(elapsed)} · ${task?.title}` : 'Phiên học');

  if (!task) {
    return (
      <div className="page">
        <EmptyState icon="file" title="Không tìm thấy nhiệm vụ" description="Hãy chọn lại nhiệm vụ từ Dashboard." action={<ButtonLink to="/dashboard">Về trang Tổng quan</ButtonLink>} />
      </div>
    );
  }

  if (blockId && !plannedBlock) {
    return (
      <div className="page flex min-h-[calc(100dvh-4rem)] max-w-2xl items-center justify-center">
        <EmptyState icon="calendar" title="Study block không còn hiệu lực" description="Block có thể đã được Plan Agent thay thế khi kế hoạch được cập nhật." action={<ButtonLink to="/plan">Về lịch học PaceWise</ButtonLink>} />
      </div>
    );
  }

  if (!plannedBlock) {
    return (
      <div className="page flex min-h-[calc(100dvh-4rem)] max-w-2xl items-center justify-center">
        <EmptyState icon="calendar" title="Hãy mở phiên từ lịch học" description="Do Agent chỉ được kích hoạt từ study block đã được Plan Agent tạo và sinh viên xác nhận." action={<ButtonLink to="/plan">Về lịch học PaceWise</ButtonLink>} />
      </div>
    );
  }

  const other = session && session.taskId !== taskId ? taskById.get(session.taskId) : null;

  const finishSession = async (minutes: number, nextCompletion = completionPercent, nextBlocker = blocker, nextNote = blockerNote) => {
    if (!course) return;
    setFinishing(true);
    try {
      const plannedMinutes = Math.max(1, durationMin(plannedBlock.start, plannedBlock.end));
      const evaluation = await evaluateDoSession({
        courseId: course.id,
        blockId: plannedBlock.id,
        taskId: task.id,
        plannedMinutes,
        actualMinutes: minutes,
        completionPercent: nextCompletion,
        blocker: nextBlocker,
        blockerNote: nextNote,
      });
      dispatch({
        type: 'COMPLETE_SESSION',
        minutes,
        note: note.trim() || nextNote.trim() || undefined,
        blockId: plannedBlock.id,
        plannedMin: plannedMinutes,
        evaluation,
      });
      setShowSessionReview(false);
      setShowSmartTriage(false);
      setDone({ minutes, evaluation });
      if (evaluation.needs_recovery) {
        toast({ tone: 'warning', title: 'Kế hoạch có thể cần phục hồi', description: evaluation.next_action });
      } else {
        toast({ tone: 'success', title: 'Do Agent đã ghi nhận phiên học', description: evaluation.next_action });
      }
    } catch (error) {
      toast({ tone: 'danger', title: 'Chưa thể kết thúc phiên', description: error instanceof Error ? error.message : 'Hãy thử lại.' });
    } finally {
      setFinishing(false);
    }
  };

  if (access && access.state !== 'available' && !mine) {
    const tooEarly = access.state === 'too_early';
    return (
      <div className="page flex min-h-[calc(100dvh-4rem)] max-w-2xl items-center justify-center">
        <Card className="w-full text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-light text-primary-ink"><Icon name={tooEarly ? 'clock' : 'calendar'} size={28} /></span>
          <h1 className="mt-4 text-2xl font-bold">{tooEarly ? 'Chưa đến giờ tự học' : 'Buổi tự học đã kết thúc'}</h1>
          <p className="mx-auto mt-2 max-w-md text-muted">
            {tooEarly
              ? `Phiên được mở trước giờ bắt đầu 5 phút. Còn khoảng ${minutesUntil(access.opensAt, clock)} phút.`
              : 'Study block vẫn được giữ trên lịch sử; Plan Agent sẽ xử lý phần chưa hoàn thành trong lần phân tích tiếp theo.'}
          </p>
          {plannedBlock && <p className="mt-4 text-sm font-semibold">{formatDay(plannedBlock.date)} · {plannedBlock.start}–{plannedBlock.end}</p>}
          <ButtonLink to="/plan" className="mt-6">Về lịch học PaceWise</ButtonLink>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page flex min-h-[calc(100dvh-4rem)] max-w-2xl items-center justify-center">
        <Card className="w-full text-center" role="status">
          <h1 className="text-2xl font-bold">Tự học</h1>
          <p className="mt-1 text-sm text-muted">{task.title}{course ? ` · ${course.code}` : ''}</p>
          <div className="mx-auto mt-7 flex h-64 w-64 flex-col items-center justify-center rounded-full border-[9px] border-success bg-white shadow-sm">
            <Icon name="checkCircle" size={28} className="text-success-ink" />
            <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">{formatTimer(done.minutes * 60_000)}</p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-success-ink">Đã hoàn thành</p>
          </div>

          <div className="mx-auto mt-6 flex max-w-sm justify-center gap-8 text-sm">
            <p><span className="font-bold text-success-ink">Đã hoàn thành:</span> {formatDuration(done.minutes)}</p>
            <p><span className="font-bold text-primary-ink">Buổi còn lại:</span> {formatDuration(remainingOf(taskById.get(task.id)!))}</p>
          </div>

          <div className="mx-auto mt-6 max-w-md rounded-xl border border-line bg-canvas p-4">
            <p className={`font-semibold ${done.evaluation?.needs_recovery ? 'text-warning-ink' : 'text-success-ink'}`}>
              {done.evaluation ? OUTCOME_LABEL[done.evaluation.status] : 'Đã kết thúc phiên học'}
            </p>
            <p className="mt-1 text-sm text-muted">{done.evaluation?.next_action ?? 'Thời gian thực tế đã được lưu vào Tiến độ.'}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <ButtonLink to="/plan">Về lịch học PaceWise</ButtonLink>
              {done.evaluation?.needs_recovery && <ButtonLink to="/recover" variant="secondary">Mở Recover</ButtonLink>}
              {done.evaluation?.needs_understanding_check && <ButtonLink to="/learn?tab=check" variant="secondary">Kiểm tra nhanh</ButtonLink>}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const running = !!mine?.runningSince;
  const target = plannedBlock
    ? Math.max(1, durationMin(plannedBlock.start, plannedBlock.end)) * 60_000
    : Math.min(90, Math.max(25, remainingOf(task))) * 60_000;
  const progress = Math.min(100, Math.round((elapsed / target) * 100));

  return (
    <div className="page max-w-6xl">
      {other && (
        <div className="mb-5">
          <Banner tone="warning" icon="alert" action={<ButtonLink to={`/study/${other.id}/session`} size="sm" variant="secondary">Mở phiên đang chạy</ButtonLink>}>
            Bạn đang có một phiên học cho <strong>{other.title}</strong>. Kết thúc phiên đó trước khi bắt đầu phiên mới.
          </Banner>
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <div className="space-y-5">
      <Card className="text-center">
        <h1 className="text-2xl font-bold">Tự học</h1>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h2 className="mt-2 text-base font-semibold text-muted">
            {task.title} — {course?.name}
          </h2>
          <CourseTag course={course} />
        </div>

        <div
          className="mx-auto mt-7 h-64 w-64 rounded-full p-[9px] shadow-sm"
          style={{ background: `conic-gradient(rgb(var(--pw-primary-ink)) ${progress}%, rgb(var(--pw-line)) ${progress}% 100%)` }}
        >
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white">
            <Icon name={running ? 'sparkle' : 'clock'} size={26} className="text-primary-ink" />
            <p
              className="mt-3 text-5xl font-bold tabular-nums tracking-tight text-ink"
              role="timer"
              aria-live="off"
              aria-label={`Đã học ${Math.floor(elapsed / 60000)} phút`}
            >
              {formatTimer(elapsed)}
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-primary-ink">{mine ? (running ? 'Đang tự học' : 'Đã tạm dừng') : 'Sẵn sàng'}</p>
          </div>
        </div>

        <ProgressBar className="sr-only" value={elapsed} max={target} label="Thời gian phiên so với mục tiêu" />
        <div className="mx-auto mt-5 flex max-w-md justify-center gap-8 text-sm text-muted">
          <p>Mục tiêu: <strong className="text-ink">{formatDuration(target / 60_000)}</strong></p>
          {plannedBlock && <p>Khung giờ: <strong className="text-ink">{plannedBlock.start}–{plannedBlock.end}</strong></p>}
        </div>

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
                  setShowSessionReview(true);
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
        <Card>
          <Textarea label="Ghi chú cho phiên này" hint="Không bắt buộc. Ví dụ: đã đọc xong phần 2.1." value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Card>
      )}
        </div>
        <DoSessionSupport
          courseId={course?.id ?? task.courseId}
          blockId={plannedBlock.id}
          taskTitle={task.title}
          objective={plannedBlock.milestoneTitle ?? task.objective}
          preparation={preparation}
          loading={preparing}
          error={prepareError || undefined}
        />
      </div>
      <div className="mt-5 text-center">
        <ButtonLink to="/plan" variant="secondary">Về lịch học PaceWise</ButtonLink>
        <p className="caption mt-3">Nếu rời trang, đồng hồ vẫn tiếp tục chạy. Chỉ có thể chạy một phiên cùng lúc.</p>
      </div>

      <Modal
        open={showSessionReview}
        onClose={() => !finishing && setShowSessionReview(false)}
        title="Kết thúc phiên tự học"
        description="Phản hồi ngắn giúp Do Agent cập nhật tiến độ và quyết định có cần Recover."
        footer={(
          <>
            <Button variant="secondary" disabled={finishing} onClick={() => setShowSessionReview(false)}>Tiếp tục học</Button>
            <Button
              icon="check"
              loading={finishing}
              onClick={() => void finishSession(Math.max(1, Math.round(elapsed / 60_000)))}
            >
              Lưu và kết thúc
            </Button>
          </>
        )}
      >
        <div className="space-y-5">
          <fieldset>
            <legend className="text-sm font-semibold">Milestone đã hoàn thành bao nhiêu?</legend>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {[0, 25, 50, 75, 100].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCompletionPercent(value)}
                  className={`min-h-10 rounded-lg border text-sm font-bold ${completionPercent === value ? 'border-primary-dark bg-primary-light text-primary-ink' : 'border-line bg-white text-muted hover:bg-slate-50'}`}
                  aria-pressed={completionPercent === value}
                >
                  {value}%
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-semibold">
            Trở ngại chính
            <select value={blocker} onChange={(event) => setBlocker(event.target.value as DoBlocker)} className="mt-2 block h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-normal">
              <option value="none">Không có</option>
              <option value="knowledge">Chưa hiểu kiến thức</option>
              <option value="time">Thiếu thời gian</option>
              <option value="interruption">Bị gián đoạn</option>
              <option value="other">Khác</option>
            </select>
          </label>

          <Textarea
            label="Ghi chú cho Do Agent"
            hint="Ví dụ: chưa hiểu quan hệ many-to-many. Không bắt buộc nếu không có trở ngại."
            value={blockerNote}
            onChange={(event) => setBlockerNote(event.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>
      </Modal>

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
                loading={finishing}
                onClick={() => {
                  const m = Math.max(1, Number(offlineMinutes) || task?.estimateMin || 45);
                  void finishSession(m, 100, 'none', 'Tự học offline');
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
                  setShowSmartTriage(false);
                  navigate(`/learn?tab=check&topic=${encodeURIComponent(course?.name ?? '')}`);
                  toast({ tone: 'info', title: 'Chuyển sang Understanding Agent', description: 'Nhiệm vụ chỉ được kết luận sau khi có bằng chứng hiểu bài.' });
                }}
              >
                Làm 1 câu Kiểm tra nhanh xác nhận
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
