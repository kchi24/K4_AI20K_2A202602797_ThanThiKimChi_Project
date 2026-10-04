import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PlanCalendarBoard } from '../../components/domain/PlanCalendarBoard';
import { PlanEntryModal } from '../../components/domain/PlanEntryModal';
import { PlanMonthBoard } from '../../components/domain/PlanMonthBoard';
import { PersonalSlotDialog, RoutineDialog } from '../../components/domain/PersonalScheduleDialogs';
import { ReminderCenter } from '../../components/domain/ReminderCenter';
import { StudyBlockDialog } from '../../components/domain/StudyBlockDialog';
import { Button, IconButton } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { confirmPlan, generatePlan, proposeWeeklyGoals } from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import type { PersonalSlotCategory, PlanInput, TimeBlock, UnavailableSlot, WeeklyGoal } from '../../types';
import { lmsUnavailableSlots, mergeUnavailable } from '../../utils/lmsPlanning';
import { buildPlanTimeline } from '../../utils/planTimeline';
import { routineAvailability, routineSleepSlots } from '../../utils/routine';
import { studyBlockAccess } from '../../utils/studyBlockAccess';
import { addDays, calendarWeekStart, DEMO_NOW, DEMO_TODAY, diffDays, durationMin, formatDM, formatDuration, TASK_SELECTION_HORIZON_DAYS, toClock, toMin, uid, weekdayOf, weekDates } from '../../utils/time';

type CalendarView = 'week' | 'month' | 'next7';

const monthStartOf = (date: string) => `${date.slice(0, 7)}-01`;
const addMonths = (date: string, offset: number) => {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
};

const overlaps = (left: { start: string; end?: string }, right: { start: string; end?: string }) => (
  Boolean(left.end && right.end) && toMin(left.start) < toMin(right.end!) && toMin(right.start) < toMin(left.end!)
);

const editablePersonalSlots = (slots: UnavailableSlot[]) => slots.filter((slot) => slot.source !== 'lms' && slot.source !== 'routine');

export function PlanPage() {
  useDocumentTitle('Plan');
  const { state, dispatch } = useAppStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const reflectionReanalysisStarted = useRef(false);
  const initialStart = calendarWeekStart(DEMO_TODAY);
  const [anchorDate, setAnchorDate] = useState(initialStart);
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [blocks, setBlocks] = useState<TimeBlock[]>(
    state.planDraft?.blocks ?? [...(state.plan?.blocks ?? []), ...state.provisionalBlocks],
  );
  const [unavailable, setUnavailable] = useState<UnavailableSlot[]>(editablePersonalSlots(state.unavailable));
  const [needsAnalysis, setNeedsAnalysis] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryTaskId, setEntryTaskId] = useState<string | undefined>();
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [routineDialogOpen, setRoutineDialogOpen] = useState(false);
  const [personalDialog, setPersonalDialog] = useState<{ category: PersonalSlotCategory; label: string } | null>(null);
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>(
    state.planDraft?.weeklyGoals ?? state.wizardInput?.weeklyGoals ?? [],
  );
  const [goalsApproved, setGoalsApproved] = useState(Boolean(state.planDraft || state.wizardInput?.weeklyGoals?.length));

  useEffect(() => {
    if (!state.planDraft) return;
    setBlocks(state.planDraft.blocks);
    const draftStart = state.planDraft.weekStart ?? state.planDraft.input.weekStart ?? initialStart;
    setAnchorDate(draftStart < initialStart ? initialStart : draftStart);
    setWeeklyGoals(state.planDraft.weeklyGoals ?? state.planDraft.input.weeklyGoals ?? []);
    setGoalsApproved(true);
  }, [initialStart, state.planDraft]);

  useEffect(() => {
    // Personal schedule is owned by the hydrated workspace, not by an older
    // AI draft. Keep local calendar state in sync even when no draft exists.
    setUnavailable(editablePersonalSlots(state.unavailable));
  }, [state.unavailable]);

  const monthStart = monthStartOf(anchorDate);
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const weekStart = calendarView === 'week' ? calendarWeekStart(anchorDate) : calendarView === 'next7' ? anchorDate : calendarWeekStart(monthStart);
  const weekEnd = calendarView === 'month' ? addDays(calendarWeekStart(monthEnd), 6) : addDays(weekStart, 6);
  const dates = useMemo(
    () => calendarView === 'month'
      ? Array.from({ length: diffDays(weekStart, weekEnd) + 1 }, (_, index) => addDays(weekStart, index))
      : weekDates(weekStart),
    [calendarView, weekEnd, weekStart],
  );
  const openTasks = useMemo(
    () => [...state.tasks]
      .filter((task) => task.status !== 'done' && task.deadline >= DEMO_TODAY)
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [state.tasks],
  );
  const calendarItems = useMemo(() => Object.values(state.courseData).flatMap((course) => course.calendarItems ?? []), [state.courseData]);
  const routineConstraints = useMemo(() => routineSleepSlots(state.routineProfile), [state.routineProfile]);
  const constraints = useMemo(
    () => mergeUnavailable([...unavailable, ...routineConstraints], lmsUnavailableSlots(state.courseData)),
    [routineConstraints, state.courseData, unavailable],
  );
  const visibleBlocks = useMemo(() => blocks.filter((block) => block.date >= weekStart && block.date <= weekEnd), [blocks, weekEnd, weekStart]);
  const timeline = useMemo(() => buildPlanTimeline({ blocks: visibleBlocks, calendarItems, tasks: state.tasks, courses: state.courses, unavailable: constraints, from: weekStart, to: weekEnd }), [calendarItems, constraints, state.courses, state.tasks, visibleBlocks, weekEnd, weekStart]);
  const totalMinutes = visibleBlocks.reduce((total, block) => total + durationMin(block.start, block.end), 0);
  const personalSlots = constraints.filter((slot) => slot.source === 'manual' || slot.source === 'google');
  const draftReady = Boolean(state.planDraft) && !needsAnalysis;

  const selectView = (view: CalendarView) => {
    setCalendarView(view);
    if (view === 'week') setAnchorDate(calendarWeekStart(anchorDate));
    if (view === 'month') setAnchorDate(monthStartOf(anchorDate));
  };

  const shiftCalendar = (direction: -1 | 1) => {
    setAnchorDate((current) => calendarView === 'month' ? addMonths(current, direction) : addDays(current, direction * 7));
  };

  const validateBlock = (candidate: TimeBlock, ignoreId?: string) => {
    const task = state.tasks.find((item) => item.id === candidate.taskId);
    if (!task) return 'Nhiệm vụ không còn tồn tại.';
    if (candidate.date < DEMO_TODAY) return 'Không thể xếp study block vào thời gian đã qua.';
    if (candidate.date === DEMO_TODAY && toMin(candidate.start) < toMin(DEMO_NOW) + 15) {
      return 'Study block phải bắt đầu sau thời điểm hiện tại ít nhất 15 phút.';
    }
    if (candidate.date > task.deadline) return 'Không thể xếp study block sau deadline.';
    const alreadyPlanned = blocks
      .filter((block) => block.id !== ignoreId && block.taskId === candidate.taskId)
      .filter((block) => block.status !== 'history')
      .reduce((total, block) => total + durationMin(block.start, block.end), 0);
    const remainingWork = Math.max(30, task.estimateMin - task.loggedMin);
    if (alreadyPlanned + durationMin(candidate.start, candidate.end) > remainingWork) {
      return `Nhiệm vụ này chỉ còn ${formatDuration(Math.max(0, remainingWork - alreadyPlanned))} chưa được xếp.`;
    }
    const availability = state.availability.find((day) => day.weekday === weekdayOf(candidate.date));
    const insideDeclaredStudyTime = constraints.some((slot) => (
      slot.category === 'self_study'
      && (!slot.date || slot.date === candidate.date)
      && slot.weekday === weekdayOf(candidate.date)
      && toMin(candidate.start) >= toMin(slot.start)
      && toMin(candidate.end) <= toMin(slot.end)
    ));
    if (!insideDeclaredStudyTime && (!availability?.enabled || toMin(candidate.start) < toMin(availability.start) || toMin(candidate.end) > toMin(availability.end))) return 'Khung giờ này nằm ngoài thời gian bạn có thể học.';
    if (blocks.some((block) => block.id !== ignoreId && block.date === candidate.date && overlaps(candidate, block))) return 'Study block bị trùng với một block khác.';
    const preferredSlotIds = new Set(constraints.filter((slot) => slot.category === 'self_study').map((slot) => slot.id));
    const fixed = timeline.filter((item) => item.source !== 'pacewise' && item.date === candidate.date && item.end && !(item.entityId && preferredSlotIds.has(item.entityId)));
    if (fixed.some((item) => overlaps(candidate, item))) return 'Khung giờ này trùng lịch LMS hoặc lịch cá nhân.';
    return undefined;
  };

  const addBlock = (block: TimeBlock) => {
    const error = validateBlock(block);
    if (error) { toast({ tone: 'warning', title: 'Chưa thể đặt block', description: error }); return false; }
    setBlocks((current) => [...current, block].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)));
    setNeedsAnalysis(true);
    setEntryOpen(false);
    toast({ tone: 'info', title: 'Đã ghim study block', description: 'Bấm AI phân tích để kiểm tra và xếp phần còn lại.' });
    return true;
  };

  const moveBlock = (id: string, date: string, start: string) => {
    const current = blocks.find((block) => block.id === id);
    if (!current) return;
    const candidate = { ...current, date, start, end: toClock(Math.min(24 * 60, toMin(start) + durationMin(current.start, current.end))) };
    const error = validateBlock(candidate, id);
    if (error) { toast({ tone: 'warning', title: 'Không thể dời block', description: error }); return; }
    setBlocks((list) => list.map((block) => block.id === id ? candidate : block));
    setNeedsAnalysis(true);
  };

  const resizeBlock = (id: string, edge: 'start' | 'end', clock: string) => {
    const current = blocks.find((block) => block.id === id);
    if (!current) return;
    const candidate = { ...current, [edge]: clock };
    const error = validateBlock(candidate, id);
    if (error) { toast({ tone: 'warning', title: 'Không thể đổi thời lượng', description: error }); return; }
    setBlocks((list) => list.map((block) => block.id === id ? candidate : block));
    setNeedsAnalysis(true);
  };

  const savePersonalSchedule = (next: UnavailableSlot[]) => {
    setUnavailable(next);
    dispatch({ type: 'SAVE_AVAILABILITY', availability: state.availability, unavailable: next });
    setNeedsAnalysis(true);
  };

  const resizeBusy = (id: string, edge: 'start' | 'end', clock: string) => {
    savePersonalSchedule(unavailable.map((slot) => slot.id === id ? { ...slot, [edge]: clock } : slot));
  };

  const removeBlock = (id: string) => { setBlocks((current) => current.filter((block) => block.id !== id)); setNeedsAnalysis(true); };

  const openStudyBlock = (id: string) => {
    setPendingBlockId(id);
  };

  const startStudyBlock = (id: string) => {
    const block = blocks.find((item) => item.id === id);
    if (!block) return;
    if (needsAnalysis) {
      toast({ tone: 'warning', title: 'Lịch vừa được chỉnh sửa', description: 'Bấm AI phân tích lại rồi áp dụng kế hoạch trước khi bắt đầu Do.' });
      return;
    }
    const saved = state.plan?.blocks.some((item) => item.id === id);
    if (!saved) {
      toast({ tone: 'warning', title: 'Study block chưa sẵn sàng', description: 'Hãy áp dụng kế hoạch trước khi bắt đầu Do.' });
      return;
    }
    const access = studyBlockAccess(block);
    if (access.state === 'ended') {
      toast({ tone: 'warning', title: 'Buổi tự học đã kết thúc', description: 'Block vẫn được giữ trên lịch sử. Hãy để Plan Agent sắp xếp lại phần chưa hoàn thành.' });
      return;
    }
    navigate(`/study/${block.taskId}/session?blockId=${encodeURIComponent(block.id)}`);
  };

  const updateBlockExactTime = (candidate: TimeBlock) => {
    const error = validateBlock(candidate, candidate.id);
    if (error) {
      toast({ tone: 'warning', title: 'Không thể đổi thời gian', description: error });
      return false;
    }
    setBlocks((current) => current.map((block) => block.id === candidate.id ? candidate : block));
    if (state.planDraft?.blocks.some((block) => block.id === candidate.id)) {
      dispatch({ type: 'UPDATE_DRAFT_BLOCK', block: candidate });
    }
    setNeedsAnalysis(true);
    toast({ tone: 'info', title: 'Đã cập nhật thời gian', description: 'Bấm AI phân tích lại để kiểm tra capacity và xung đột trước khi áp dụng.' });
    return true;
  };

  const addPersonalSlot = (date: string, start: string, category: PersonalSlotCategory, label: string, end?: string) => {
    const slot: UnavailableSlot = { id: uid('personal-slot'), label, weekday: weekdayOf(date), date, start, end: end ?? toClock(Math.min(24 * 60, toMin(start) + 60)), source: 'manual', category };
    savePersonalSchedule([...unavailable, slot]);
    toast({
      tone: 'info',
      title: category === 'self_study' ? 'Đã thêm giờ tự học ưu tiên' : `Đã thêm ${label.toLowerCase()}`,
      description: category === 'self_study' ? 'Plan Agent sẽ thử xếp study block vào khung này trước.' : 'Plan Agent sẽ tránh khung giờ này khi xếp lịch.',
    });
  };

  const tasksForHorizon = () => {
    const pinnedTaskIds = new Set(blocks.map((block) => block.taskId));
    const planningWeekStart = calendarWeekStart(DEMO_TODAY);
    const horizonEnd = addDays(planningWeekStart, TASK_SELECTION_HORIZON_DAYS - 1);
    return openTasks.filter((task) => pinnedTaskIds.has(task.id) || (task.deadline >= DEMO_TODAY && task.deadline <= horizonEnd));
  };

  const analyzeWithGoals = async (goals: WeeklyGoal[]) => {
    const selected = tasksForHorizon();
    if (selected.length === 0) { toast({ tone: 'warning', title: 'Chưa có nhiệm vụ để lập kế hoạch', description: 'LMS chưa có deadline trong 14 ngày tới.' }); return; }
    const planningWeekStart = calendarWeekStart(DEMO_TODAY);
    const horizonEnd = addDays(planningWeekStart, TASK_SELECTION_HORIZON_DAYS - 1);
    const goalByTask = new Map(goals.flatMap((goal) => goal.taskIds.map((taskId) => [taskId, goal.id] as const)));
    const input: PlanInput = {
      goal: goals.map((goal) => goal.title).join('; '),
      weekStart: planningWeekStart,
      horizonEnd,
      weeklyGoals: goals.map((goal) => ({ ...goal, confirmed: true })),
      tasks: selected.map((task) => ({
        taskId: task.id,
        remainingMin: Math.max(30, task.estimateMin - task.loggedMin),
        personalPriority: task.personalPriority ?? 2,
        weeklyGoalId: goalByTask.get(task.id),
      })),
      availability: routineAvailability(state.routineProfile, state.availability),
      unavailable: constraints,
      preferred: state.routineProfile?.preferred ?? state.wizardInput?.preferred ?? ['morning', 'afternoon', 'evening'],
      pinnedBlocks: blocks,
    };
    setGenerating(true);
    try {
      const draft = await generatePlan(input, state.tasks);
      dispatch({ type: 'SET_WIZARD_INPUT', input });
      dispatch({ type: 'SET_DRAFT', draft });
      setBlocks(draft.blocks);
      setWeeklyGoals(draft.weeklyGoals ?? goals);
      setNeedsAnalysis(false);
      toast({ tone: draft.feasibility.feasible ? 'success' : 'warning', title: draft.feasibility.feasible ? 'AI đã tạo lịch khả thi' : 'AI đã xếp phần có thể thực hiện', description: draft.feasibility.feasible ? 'Hãy xem lịch rồi xác nhận.' : `Còn thiếu ${formatDuration(draft.feasibility.deficitMin)} trước deadline.` });
    } catch {
      toast({ tone: 'danger', title: 'AI chưa thể phân tích kế hoạch', description: 'Dữ liệu kéo thả vẫn được giữ. Hãy thử lại.' });
    } finally { setGenerating(false); }
  };

  const analyze = async () => {
    const selected = tasksForHorizon();
    if (selected.length === 0) {
      toast({ tone: 'warning', title: 'Chưa có nhiệm vụ để lập kế hoạch', description: 'LMS chưa có deadline trong 14 ngày tới.' });
      return;
    }
    const confirmedGoals = weeklyGoals.filter((goal) => goal.confirmed && goal.title.trim());
    if (goalsApproved && confirmedGoals.length > 0) {
      await analyzeWithGoals(confirmedGoals);
      return;
    }
    setLoadingGoals(true);
    try {
      const proposed = await proposeWeeklyGoals(selected);
      setWeeklyGoals(proposed.map((goal) => ({ ...goal, confirmed: true })));
      setGoalsApproved(false);
      setGoalDialogOpen(true);
    } catch {
      const fallback = selected.slice(0, 4).map((task, index) => ({
        id: `goal-${index + 1}`,
        title: `Hoàn thành phần cần thiết của ${task.title} trước hạn`,
        taskIds: [task.id],
        confirmed: true,
      }));
      setWeeklyGoals(fallback);
      setGoalsApproved(false);
      setGoalDialogOpen(true);
    } finally {
      setLoadingGoals(false);
    }
  };

  useEffect(() => {
    if (searchParams.get('reanalyze') !== 'reflection' || reflectionReanalysisStarted.current) return;
    reflectionReanalysisStarted.current = true;
    const confirmedGoals = weeklyGoals.filter((goal) => goal.confirmed && goal.title.trim());
    const goals = confirmedGoals.length > 0
      ? confirmedGoals
      : tasksForHorizon().slice(0, 4).map((task, index) => ({
          id: `reflection-goal-${index + 1}`,
          title: `Hoàn thành phần cần thiết của ${task.title} trước hạn`,
          taskIds: [task.id],
          confirmed: true,
        }));
    setSearchParams({}, { replace: true });
    toast({
      tone: 'info',
      title: 'AI đang phân tích lại lịch',
      description: 'PaceWise sẽ tạo bản đề xuất; lịch hiện tại vẫn được giữ cho đến khi bạn áp dụng.',
    });
    void analyzeWithGoals(goals);
  // This is a one-shot hand-off from Reflect. A ref prevents duplicate calls
  // under React StrictMode while the query string is being replaced.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const save = async (openAfterSaveId?: string) => {
    if (!draftReady) return;
    setSaving(true);
    try {
      await confirmPlan();
      dispatch({ type: 'SAVE_PLAN' });
      setNeedsAnalysis(false);
      setPendingBlockId(null);
      toast({ tone: 'success', title: 'Đã áp dụng kế hoạch tuần' });
      const block = openAfterSaveId ? blocks.find((item) => item.id === openAfterSaveId) : undefined;
      if (block && block.status !== 'tentative') {
        navigate(`/study/${block.taskId}/session?blockId=${encodeURIComponent(block.id)}`);
      }
    }
    catch { toast({ tone: 'danger', title: 'Chưa thể lưu kế hoạch', description: 'Bản nháp vẫn được giữ.' }); }
    finally { setSaving(false); }
  };

  const pendingBlock = pendingBlockId ? blocks.find((item) => item.id === pendingBlockId) : undefined;

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden bg-canvas pb-[68px] lg:h-dvh lg:pb-0">
      <header className="z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2 sm:px-5">
        <div className="mr-2 min-w-[112px]">
          <h1 className="text-lg font-bold">Plan</h1>
          <p className="text-[11px] text-muted">{calendarView === 'month' ? new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthStart}T00:00:00Z`)) : `${formatDM(weekStart)}–${formatDM(weekEnd)}`} · GMT+7</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5" aria-label="Kiểu hiển thị lịch">
          {([['week', 'Tuần'], ['month', 'Tháng'], ['next7', '7 ngày tới']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => selectView(value)} className={`min-h-8 rounded-md px-3 text-xs font-semibold ${calendarView === value ? 'bg-primary-light text-primary-ink' : 'text-muted hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
        <IconButton icon="chevronLeft" label="Khoảng trước" className="h-9 w-9" onClick={() => shiftCalendar(-1)} />
        <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value || DEMO_TODAY)} className="h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold" aria-label="Chọn ngày" />
        <Button size="sm" variant="ghost" className="min-h-9 px-2" onClick={() => setAnchorDate(DEMO_TODAY)}>Hôm nay</Button>
        <IconButton icon="chevronRight" label="Khoảng sau" className="h-9 w-9" onClick={() => shiftCalendar(1)} />
        <div className="ml-auto flex items-center gap-2">
          {calendarView !== 'month' && <Button size="sm" variant="secondary" icon="plus" onClick={() => { setEntryTaskId(undefined); setEntryOpen(true); }}>Study block</Button>}
          <ReminderCenter compact />
          {calendarView !== 'month' && <Button size="sm" icon="sparkle" loading={generating || loadingGoals} onClick={() => void analyze()}>{state.planDraft || needsAnalysis ? 'AI phân tích lại' : 'AI lập kế hoạch'}</Button>}
          {calendarView !== 'month' && draftReady && <Button size="sm" icon="check" loading={saving} onClick={() => void save()}>Áp dụng kế hoạch</Button>}
        </div>
      </header>

      <div className="z-10 shrink-0 border-b border-line bg-white px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold"><Icon name={draftReady ? 'checkCircle' : 'edit'} size={15} className={draftReady ? 'text-success-ink' : 'text-primary-ink'} />{draftReady ? 'Bản AI đã kiểm tra · chưa áp dụng' : needsAnalysis ? 'Có thay đổi cần AI kiểm tra' : state.plan ? 'Kế hoạch đang áp dụng' : 'Kéo dữ liệu vào lịch để bắt đầu'}</span>
          <span className="text-muted">{visibleBlocks.length} study block · {formatDuration(totalMinutes)}</span>
          {state.planDraft && !state.planDraft.feasibility.feasible && <span className="font-semibold text-warning-ink">Thiếu {formatDuration(state.planDraft.feasibility.deficitMin)} capacity</span>}
          <span className="ml-auto text-muted">{personalSlots.length} mục lịch cá nhân</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        {calendarView === 'month' ? (
          <PlanMonthBoard dates={dates} month={monthStart.slice(0, 7)} items={timeline} onSelectDate={(date) => { setAnchorDate(date); setCalendarView('week'); }} />
        ) : (
          <PlanCalendarBoard dates={dates} courses={state.courses} tasks={openTasks} items={timeline} draftMode routineProfile={state.routineProfile} onMoveBlock={moveBlock} onResizeBlock={resizeBlock} onResizeBusy={resizeBusy} onAddBusy={(date, start, category, label) => addPersonalSlot(date, start, category, label)} onOpenPersonal={(category, label) => setPersonalDialog({ category, label })} onOpenRoutine={() => setRoutineDialogOpen(true)} onOpenBlock={openStudyBlock} onSetPriority={(taskId, personalPriority) => { dispatch({ type: 'UPDATE_TASK_PRIORITY', taskId, personalPriority }); setNeedsAnalysis(true); }} onRemoveBlock={removeBlock} onRemoveBusy={(id) => savePersonalSchedule(unavailable.filter((slot) => slot.id !== id))} />
        )}
      </div>

      <PlanEntryModal open={entryOpen} tasks={openTasks} weekStart={weekStart} initialTaskId={entryTaskId} onClose={() => setEntryOpen(false)} onAdd={addBlock} />
      <StudyBlockDialog
        block={pendingBlock ?? null}
        title={pendingBlock?.milestoneTitle ?? state.tasks.find((task) => task.id === pendingBlock?.taskId)?.title ?? 'Phiên tự học'}
        saved={Boolean(!needsAnalysis && pendingBlock && state.plan?.blocks.some((block) => block.id === pendingBlock.id))}
        draftReady={draftReady}
        saving={saving}
        minDate={DEMO_TODAY}
        maxDate={addDays(calendarWeekStart(DEMO_TODAY), TASK_SELECTION_HORIZON_DAYS - 1)}
        onClose={() => !saving && setPendingBlockId(null)}
        onSave={updateBlockExactTime}
        onStart={() => pendingBlock && startStudyBlock(pendingBlock.id)}
        onApplyAndStart={() => void save(pendingBlock?.id)}
      />
      <PersonalSlotDialog
        open={Boolean(personalDialog)}
        category={personalDialog?.category ?? 'other'}
        initialLabel={personalDialog?.label ?? 'Bận khác'}
        initialDate={DEMO_TODAY > weekStart ? DEMO_TODAY : weekStart}
        minDate={DEMO_TODAY}
        maxDate={addDays(calendarWeekStart(DEMO_TODAY), TASK_SELECTION_HORIZON_DAYS - 1)}
        onClose={() => setPersonalDialog(null)}
        onSubmit={(value) => {
          addPersonalSlot(value.date, value.start, value.category, value.label, value.end);
          setPersonalDialog(null);
        }}
      />
      <RoutineDialog
        open={routineDialogOpen}
        value={state.routineProfile}
        onClose={() => setRoutineDialogOpen(false)}
        onSave={(profile) => {
          dispatch({ type: 'UPDATE_ROUTINE_PROFILE', profile });
          setRoutineDialogOpen(false);
          setNeedsAnalysis(true);
          toast({ tone: 'success', title: 'Đã lưu giờ sinh hoạt', description: 'Bấm AI phân tích lại để áp dụng nhịp học mới.' });
        }}
      />
      {goalDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="weekly-goal-title">
          <div className="w-full max-w-xl rounded-2xl border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="weekly-goal-title" className="text-lg font-bold">Mục tiêu tuần AI đề xuất</h2>
                <p className="mt-1 text-sm text-muted">Sửa hoặc bỏ mục tiêu trước khi Plan Agent chia nhiệm vụ và xếp lịch.</p>
              </div>
              <IconButton icon="x" label="Đóng" onClick={() => setGoalDialogOpen(false)} />
            </div>
            <div className="mt-4 space-y-3">
              {weeklyGoals.map((goal) => (
                <label key={goal.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
                  <input type="checkbox" checked={goal.confirmed} onChange={(event) => setWeeklyGoals((current) => current.map((item) => item.id === goal.id ? { ...item, confirmed: event.target.checked } : item))} className="mt-2" />
                  <input value={goal.title} onChange={(event) => setWeeklyGoals((current) => current.map((item) => item.id === goal.id ? { ...item, title: event.target.value } : item))} className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm" aria-label="Nội dung mục tiêu tuần" />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setGoalDialogOpen(false)}>Để sau</Button>
              <Button icon="check" onClick={() => {
                const confirmed = weeklyGoals.filter((goal) => goal.confirmed && goal.title.trim()).map((goal) => ({ ...goal, confirmed: true }));
                if (!confirmed.length) { toast({ tone: 'warning', title: 'Hãy chọn ít nhất một mục tiêu tuần' }); return; }
                setWeeklyGoals(confirmed);
                setGoalsApproved(true);
                setGoalDialogOpen(false);
                void analyzeWithGoals(confirmed);
              }}>Xác nhận và lập lịch</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
