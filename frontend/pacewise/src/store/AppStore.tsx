import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { defaultAvailability, defaultUnavailable } from '../data/plan';
import { getCurrentSession, lmsEventStreamUrl, loadWorkspace, saveWorkspace, syncCanvas } from '../services/api';
import type {
  ActiveSession,
  AssessmentItem,
  AssessmentStatus,
  AuditEntry,
  AvailabilityDay,
  CanvasSyncResult,
  ClassGuidance,
  ClassGroup,
  Course,
  GroupStats,
  LMSCourseData,
  LMSInstructorSummary,
  Plan,
  PlanDraft,
  PlanInput,
  QAMessage,
  QuickCheckResult,
  Reflection,
  RecoveryOption,
  ReviewItem,
  ReviewStatus,
  StudySession,
  Task,
  TaskProgress,
  TimeBlock,
  UnavailableSlot,
  User,
} from '../types';
import { DEMO_TODAY, WEEK_START, uid } from '../utils/time';

export interface Settings {
  staleData: boolean;
  lastSync: string;
}

export interface AppState {
  user: User | null;
  authReady: boolean;
  workspaceReady: boolean;
  courses: Course[];
  tasks: Task[];
  taskProgress: Record<string, TaskProgress>;
  courseData: Record<string, LMSCourseData>;
  plan: Plan | null;
  planHistory: Plan[];
  availability: AvailabilityDay[];
  unavailable: UnavailableSlot[];
  sessions: StudySession[];
  activeSession: ActiveSession | null;
  wizardInput: PlanInput | null;
  planDraft: PlanDraft | null;
  qaMessages: QAMessage[];
  quickChecks: QuickCheckResult[];
  guidance: ClassGuidance[];
  reflections: Record<string, Reflection>;
  recoveryOptions: RecoveryOption[];
  settings: Settings;
  reviewQueue: ReviewItem[];
  assessments: AssessmentItem[];
  audit: AuditEntry[];
  classGroups: ClassGroup[];
  groupStats: Record<string, GroupStats>;
  lmsInstructorSummary: LMSInstructorSummary | null;
  /** Monotonic UI signal used to revalidate course-derived views after LMS events. */
  lmsRevision: number;
  /** Tasks whose drift warning the student chose to keep as-is (plan unchanged). */
  dismissedDrifts: string[];
}

export const initialState: AppState = {
  user: null,
  authReady: false,
  workspaceReady: false,
  courses: [],
  tasks: [],
  taskProgress: {},
  courseData: {},
  plan: null,
  planHistory: [],
  availability: defaultAvailability,
  unavailable: defaultUnavailable,
  sessions: [],
  activeSession: null,
  wizardInput: null,
  planDraft: null,
  qaMessages: [],
  quickChecks: [],
  guidance: [],
  reflections: {},
  recoveryOptions: [],
  settings: { staleData: false, lastSync: '' },
  reviewQueue: [],
  assessments: [],
  audit: [],
  classGroups: [],
  groupStats: {},
  lmsInstructorSummary: null,
  lmsRevision: 0,
  dismissedDrifts: [],
};

export type Action =
  | { type: 'LOGIN'; user: User }
  | { type: 'AUTH_READY' }
  | { type: 'HYDRATE_WORKSPACE'; state: Partial<AppState> }
  | { type: 'SET_ACTIVE_COURSE'; courseId: string }
  | { type: 'LOGOUT' }
  | { type: 'SET_WIZARD_INPUT'; input: PlanInput }
  | { type: 'SET_DRAFT'; draft: PlanDraft | null }
  | { type: 'UPDATE_DRAFT_BLOCK'; block: TimeBlock }
  | { type: 'REMOVE_DRAFT_BLOCK'; id: string }
  | { type: 'SAVE_PLAN' }
  | { type: 'CLEAR_PLAN' }
  | { type: 'START_SESSION'; taskId: string }
  | { type: 'PAUSE_SESSION' }
  | { type: 'RESUME_SESSION' }
  | { type: 'CANCEL_SESSION' }
  | { type: 'COMPLETE_SESSION'; minutes: number; note?: string }
  | { type: 'ADD_MANUAL_SESSION'; session: Omit<StudySession, 'id' | 'source'> }
  | { type: 'UPDATE_TASK_ESTIMATE'; taskId: string; estimateMin: number }
  | { type: 'SET_TASK_DONE'; taskId: string; done: boolean }
  | { type: 'ADD_QA'; message: QAMessage }
  | { type: 'CLEAR_QA' }
  | { type: 'SUBMIT_QUICK_CHECK'; result: QuickCheckResult; reviewItem?: ReviewItem }
  | { type: 'ADD_CLASS_GUIDANCE'; topic: string; message: string }
  | { type: 'APPLY_RECOVERY'; blocks: TimeBlock[] }
  | { type: 'SAVE_REFLECTION'; courseId: string; answers: [string, string, string]; aiDraft?: Record<string, unknown>; aiSummary?: string }
  | { type: 'SET_RECOVERY_OPTIONS'; options: RecoveryOption[] }
  | { type: 'SAVE_AVAILABILITY'; availability: AvailabilityDay[]; unavailable: UnavailableSlot[] }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'SET_REVIEW_STATUS'; id: string; status: ReviewStatus; note?: string }
  | { type: 'SET_ASSESSMENT_STATUS'; id: string; status: AssessmentStatus; note?: string }
  | { type: 'UPDATE_ASSESSMENT'; item: Pick<AssessmentItem, 'id' | 'question' | 'rubric' | 'level' | 'source' | 'version'>; status?: AssessmentStatus; note?: string; historyText: string }
  | { type: 'DISMISS_DRIFT'; taskId: string }
  | { type: 'SYNC_CANVAS'; tasks: Task[]; courses?: Course[]; guidance?: ClassGuidance[]; assessments?: AssessmentItem[]; courseData?: Record<string, LMSCourseData>; reviewResolutions?: CanvasSyncResult['reviewResolutions'] }
  | { type: 'LMS_EVENT_RECEIVED' }
  | { type: 'SET_INSTRUCTOR_DATA'; classGroups: ClassGroup[]; groupStats: Record<string, GroupStats>; reviewQueue: ReviewItem[]; assessments: AssessmentItem[]; audit: AuditEntry[]; guidance: ClassGuidance[]; lmsSummary: LMSInstructorSummary | null }
  ;

function audit(state: AppState, action: string): AuditEntry[] {
  const d = new Date();
  const at = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
  return [{ id: uid('au'), at, actor: state.user?.name ?? 'Hệ thống', action }, ...state.audit];
}

function progressOf(task: Task): TaskProgress {
  return {
    estimateMin: task.estimateMin,
    loggedMin: task.loggedMin,
    status: task.status,
    updatedAt: new Date().toISOString(),
  };
}

function withTaskProgress(state: AppState, tasks: Task[]): Pick<AppState, 'tasks' | 'taskProgress'> {
  return {
    tasks,
    taskProgress: {
      ...state.taskProgress,
      ...Object.fromEntries(tasks.map((task) => [task.id, progressOf(task)])),
    },
  };
}

function resolvedEvidenceState(
  status: string | undefined,
  fallback: QuickCheckResult['evidenceState'],
): QuickCheckResult['evidenceState'] {
  const normalized = (status ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalized.includes('the hien')) return 'demonstrated';
  if (normalized.includes('hinh thanh')) return 'developing';
  if (normalized.includes('nham lan')) return 'misconception';
  if (normalized.includes('chua du')) return 'abstained';
  return fallback;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOGIN':
      // A first-time student starts with NO tasks, NO deadlines, NO plan, and NO sessions
      if (action.user.isNew) {
        return {
          ...initialState,
          user: action.user,
          authReady: true,
          workspaceReady: false,
          courses: [],
          tasks: [], // Sinh viên mới: hoàn toàn chưa có bài tập hay deadline nào
          taskProgress: {},
          plan: null,
          sessions: [],
          dismissedDrifts: [],
          reflections: {},
        };
      }
      return { ...state, user: action.user, authReady: true, workspaceReady: false };
    case 'AUTH_READY':
      return { ...state, authReady: true };
    case 'HYDRATE_WORKSPACE': {
      const legacy = action.state as Partial<AppState> & { reflection?: Omit<Reflection, 'courseId'> };
      const courseId = state.user?.courseId;
      const reflections = legacy.reflections ?? (
        legacy.reflection && courseId
          ? { [courseId]: { ...legacy.reflection, courseId } }
          : state.reflections
      );
      const { reflection: _legacyReflection, ...workspace } = legacy;
      void _legacyReflection;
      return {
        ...state,
        ...workspace,
        reflections,
        taskProgress: legacy.taskProgress ?? state.taskProgress,
        user: state.user,
        authReady: true,
        workspaceReady: true,
      };
    }
    case 'SET_ACTIVE_COURSE':
      return {
        ...state,
        user: state.user ? { ...state.user, courseId: action.courseId } : null,
        qaMessages: [],
        assessments: [],
        classGroups: [],
        groupStats: {},
        reviewQueue: [],
        audit: [],
        guidance: [],
        lmsInstructorSummary: null,
      };
    case 'SYNC_CANVAS': {
      const incomingTasks = action.tasks.map((task) => {
        const current = state.tasks.find((item) => item.id === task.id);
        const saved = state.taskProgress[task.id];
        const progress = saved ?? (current ? progressOf(current) : undefined);
        if (!progress) return task;
        return {
          ...task,
          estimateMin: progress.estimateMin,
          loggedMin: progress.loggedMin,
          status: task.status === 'done' ? 'done' as const : progress.status,
        };
      });
      const quickChecks = state.quickChecks.map((result) => {
        const resolution = result.reviewItemId
          ? action.reviewResolutions?.[result.reviewItemId]
          : undefined;
        if (!resolution || !['approved', 'edited', 'rejected', 'needs_evidence'].includes(resolution.status)) {
          return result;
        }
        return {
          ...result,
          evidenceState: resolution.status === 'approved' || resolution.status === 'edited'
            ? resolvedEvidenceState(resolution.resolvedStatus, result.evidenceState)
            : 'abstained' as const,
          instructorNote: resolution.note ?? (
            resolution.status === 'rejected'
              ? 'Giảng viên chưa chấp nhận kết luận tự động.'
              : resolution.status === 'needs_evidence'
                ? 'Giảng viên yêu cầu thêm bằng chứng trước khi kết luận.'
                : 'Giảng viên đã xác nhận kết luận.'
          ),
        };
      });
      return {
        ...state,
        ...withTaskProgress(state, incomingTasks),
        quickChecks,
        courses: action.courses ?? state.courses,
        courseData: action.courseData ?? state.courseData,
        guidance: action.guidance ?? state.guidance,
        assessments: action.assessments ?? state.assessments,
        settings: { ...state.settings, staleData: false, lastSync: new Date().toISOString() },
      };
    }
    case 'LMS_EVENT_RECEIVED':
      return { ...state, lmsRevision: state.lmsRevision + 1 };
    case 'LOGOUT':
      return { ...state, user: null, authReady: true, workspaceReady: false, activeSession: null };
    case 'SET_INSTRUCTOR_DATA':
      return {
        ...state,
        classGroups: action.classGroups,
        groupStats: action.groupStats,
        reviewQueue: action.reviewQueue,
        assessments: action.assessments,
        audit: action.audit,
        guidance: action.guidance,
        lmsInstructorSummary: action.lmsSummary,
      };
    case 'SET_WIZARD_INPUT':
      return { ...state, wizardInput: action.input };
    case 'SET_DRAFT':
      return { ...state, planDraft: action.draft };
    case 'UPDATE_DRAFT_BLOCK':
      if (!state.planDraft) return state;
      return {
        ...state,
        planDraft: { ...state.planDraft, blocks: state.planDraft.blocks.map((b) => (b.id === action.block.id ? action.block : b)) },
      };
    case 'REMOVE_DRAFT_BLOCK':
      if (!state.planDraft) return state;
      return { ...state, planDraft: { ...state.planDraft, blocks: state.planDraft.blocks.filter((b) => b.id !== action.id) } };
    case 'SAVE_PLAN': {
      if (!state.planDraft || !state.planDraft.feasibility.feasible) return state;
      // A confirmed plan replaces the remaining week; the previous version stays in history.
      const plan: Plan = {
        id: uid('plan'),
        weekStart: WEEK_START,
        blocks: state.planDraft.blocks,
        savedAt: new Date().toISOString(),
        version: (state.plan?.version ?? 0) + 1,
      };
      return {
        ...state,
        plan,
        planHistory: state.plan ? [state.plan, ...state.planHistory] : state.planHistory,
        availability: state.planDraft.input.availability,
        unavailable: state.planDraft.input.unavailable,
        planDraft: null,
        wizardInput: null,
        recoveryOptions: [],
      };
    }
    case 'CLEAR_PLAN':
      return { ...state, plan: null, planHistory: state.plan ? [state.plan, ...state.planHistory] : state.planHistory };
    case 'START_SESSION':
      if (state.activeSession && state.activeSession.taskId !== action.taskId) return state;
      if (state.activeSession) return state;
      return { ...state, activeSession: { taskId: action.taskId, runningSince: Date.now(), accumulatedMs: 0 } };
    case 'PAUSE_SESSION': {
      const s = state.activeSession;
      if (!s || s.runningSince === null) return state;
      return { ...state, activeSession: { ...s, runningSince: null, accumulatedMs: s.accumulatedMs + (Date.now() - s.runningSince) } };
    }
    case 'RESUME_SESSION': {
      const s = state.activeSession;
      if (!s || s.runningSince !== null) return state;
      return { ...state, activeSession: { ...s, runningSince: Date.now() } };
    }
    case 'CANCEL_SESSION':
      return { ...state, activeSession: null };
    case 'COMPLETE_SESSION': {
      const s = state.activeSession;
      if (!s) return state;
      const session: StudySession = { id: uid('ses'), taskId: s.taskId, date: DEMO_TODAY, minutes: action.minutes, note: action.note, source: 'timer' };
      const tasks = state.tasks.map((task) =>
        task.id === s.taskId
          ? { ...task, loggedMin: task.loggedMin + action.minutes, status: task.status === 'done' ? 'done' as const : 'in_progress' as const }
          : task,
      );
      return {
        ...state,
        activeSession: null,
        sessions: [session, ...state.sessions],
        ...withTaskProgress(state, tasks),
      };
    }
    case 'ADD_MANUAL_SESSION': {
      const session: StudySession = { ...action.session, id: uid('ses'), source: 'manual' };
      const tasks = state.tasks.map((task) =>
        task.id === session.taskId
          ? { ...task, loggedMin: task.loggedMin + session.minutes, status: task.status === 'done' ? 'done' as const : 'in_progress' as const }
          : task,
      );
      return {
        ...state,
        sessions: [session, ...state.sessions],
        ...withTaskProgress(state, tasks),
      };
    }
    case 'UPDATE_TASK_ESTIMATE': {
      const tasks = state.tasks.map((task) => (
        task.id === action.taskId ? { ...task, estimateMin: action.estimateMin } : task
      ));
      return {
        ...state,
        ...withTaskProgress(state, tasks),
      };
    }
    case 'SET_TASK_DONE': {
      const tasks = state.tasks.map((task) =>
        task.id === action.taskId
          ? { ...task, status: action.done ? 'done' as const : task.loggedMin > 0 ? 'in_progress' as const : 'todo' as const }
          : task,
      );
      return {
        ...state,
        ...withTaskProgress(state, tasks),
      };
    }
    case 'ADD_QA':
      return { ...state, qaMessages: [...state.qaMessages, action.message] };
    case 'CLEAR_QA':
      return { ...state, qaMessages: [] };
    case 'SUBMIT_QUICK_CHECK':
      return {
        ...state,
        quickChecks: [action.result, ...state.quickChecks],
        reviewQueue: action.reviewItem ? [action.reviewItem, ...state.reviewQueue] : state.reviewQueue,
        audit: action.reviewItem ? audit(state, `Chuyển ca kiểm tra #${action.reviewItem.id} vào Review Queue`) : state.audit,
      };
    case 'ADD_CLASS_GUIDANCE': {
      const d = new Date();
      const at = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes(),
      ).padStart(2, '0')}`;
      const g: ClassGuidance = {
        id: uid('gd'),
        topic: action.topic,
        message: action.message,
        at,
        instructorName: state.user?.name ?? 'Giảng viên',
      };
      return {
        ...state,
        guidance: [g, ...state.guidance],
        audit: audit(state, `Phát gợi ý ôn tập chủ đề “${action.topic}”`),
      };
    }
    case 'APPLY_RECOVERY': {
      if (!state.plan) return state;
      const plan: Plan = { ...state.plan, id: uid('plan'), blocks: action.blocks, savedAt: new Date().toISOString(), version: state.plan.version + 1 };
      return { ...state, plan, planHistory: [state.plan, ...state.planHistory], dismissedDrifts: [], recoveryOptions: [] };
    }
    case 'SET_RECOVERY_OPTIONS':
      return { ...state, recoveryOptions: action.options };
    case 'SAVE_REFLECTION':
      return {
        ...state,
        reflections: {
          ...state.reflections,
          [action.courseId]: {
            courseId: action.courseId,
            weekStart: WEEK_START,
            answers: action.answers,
            savedAt: new Date().toISOString(),
            aiDraft: action.aiDraft,
            aiSummary: action.aiSummary,
          },
        },
      };
    case 'SAVE_AVAILABILITY':
      return { ...state, availability: action.availability, unavailable: action.unavailable };
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'SET_REVIEW_STATUS': {
      const item = state.reviewQueue.find((r) => r.id === action.id);
      const label = {
        approved: 'Duyệt kết luận',
        edited: 'Sửa và duyệt kết luận',
        rejected: 'Từ chối kết luận',
        needs_evidence: 'Yêu cầu thêm bằng chứng',
        in_review: 'Bắt đầu xem',
        pending: 'Đưa về chờ',
      }[action.status];
      return {
        ...state,
        reviewQueue: state.reviewQueue.map((r) => (r.id === action.id ? { ...r, status: action.status, note: action.note ?? r.note } : r)),
        quickChecks: state.quickChecks.map((qc) =>
          qc.reviewItemId === action.id
            ? {
                ...qc,
                instructorNote: action.note ?? (
                  action.status === 'approved' || action.status === 'edited'
                    ? 'Giảng viên đã xem và xác nhận phân tích.'
                    : undefined
                ),
              }
            : qc,
        ),
        audit: audit(state, `${label} ca #${item?.id ?? action.id}`),
      };
    }
    case 'SET_ASSESSMENT_STATUS': {
      const item = state.assessments.find((a) => a.id === action.id);
      const label = { approved: 'Duyệt và xuất bản', rejected: 'Trả lại', review: 'Gửi review', draft: 'Đưa về bản nháp' }[action.status];
      return {
        ...state,
        assessments: state.assessments.map((a) => (a.id === action.id ? { ...a, status: action.status, note: action.note ?? a.note } : a)),
        audit: audit(state, `${label} câu hỏi “${item?.topic ?? ''}”`),
      };
    }
    case 'UPDATE_ASSESSMENT': {
      const d = new Date();
      const at = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return {
        ...state,
        assessments: state.assessments.map((a) =>
          a.id === action.item.id
            ? {
                ...a,
                ...action.item,
                status: action.status ?? a.status,
                note: action.note ?? a.note,
                history: [...(a.history ?? []), { at, text: action.historyText }],
              }
            : a,
        ),
        audit: audit(state, `${action.historyText}: câu hỏi “${state.assessments.find((a) => a.id === action.item.id)?.topic ?? ''}”`),
      };
    }
    case 'DISMISS_DRIFT':
      return { ...state, dismissedDrifts: [...state.dismissedDrifts, action.taskId], recoveryOptions: [] };
    default:
      return state;
  }
}

function load(): AppState {
  return initialState;
}

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}
const StoreContext = createContext<StoreValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    let active = true;
    getCurrentSession()
      .then((user) => {
        if (!active) return;
        dispatch(user ? { type: 'LOGIN', user } : { type: 'AUTH_READY' });
      })
      .catch(() => active && dispatch({ type: 'AUTH_READY' }));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!state.user) return;
    let active = true;
    let refreshInFlight = false;
    let refreshQueued = false;
    loadWorkspace()
      .then((workspace) => active && dispatch({ type: 'HYDRATE_WORKSPACE', state: workspace.state as Partial<AppState> }))
      .catch(() => active && dispatch({ type: 'HYDRATE_WORKSPACE', state: {} }));
    const refresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        const result = await syncCanvas();
        if (active) dispatch({
          type: 'SYNC_CANVAS',
          courses: result.courses,
          tasks: result.tasks,
          guidance: result.guidance,
          assessments: result.assessments,
          courseData: result.courseData,
          reviewResolutions: result.reviewResolutions,
        });
      } catch {
        if (active) dispatch({ type: 'UPDATE_SETTINGS', patch: { staleData: true } });
      } finally {
        refreshInFlight = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          void refresh();
        }
      }
    };
    void refresh();

    const stream = typeof EventSource === 'undefined'
      ? null
      : new EventSource(lmsEventStreamUrl(), { withCredentials: true });
    const handleLmsChange = () => {
      if (!active) return;
      dispatch({ type: 'LMS_EVENT_RECEIVED' });
      void refresh();
    };
    stream?.addEventListener('lms.changed', handleLmsChange);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    // Safety net only. Normal updates arrive through the event stream.
    const fallbackTimer = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => {
      active = false;
      stream?.removeEventListener('lms.changed', handleLmsChange);
      stream?.close();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      window.clearInterval(fallbackTimer);
    };
  }, [state.user?.id]);
  useEffect(() => {
    if (!state.user || !state.workspaceReady) return;
    const timer = window.setTimeout(() => {
      void saveWorkspace(state as unknown as Record<string, unknown>);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [state]);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useAppStore must be used inside AppStoreProvider');
  return ctx;
}
