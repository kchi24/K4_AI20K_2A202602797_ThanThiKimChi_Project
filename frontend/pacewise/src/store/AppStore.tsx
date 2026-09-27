import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { courses as seedCourses, tasks as seedTasks } from '../data/courses';
import { defaultAvailability, defaultUnavailable, savedPlan, sessions as seedSessions } from '../data/plan';
import { assessments as seedAssessments, auditLog as seedAudit, reviewQueue as seedReview } from '../data/instructor';
import type {
  ActiveSession,
  AssessmentItem,
  AssessmentStatus,
  AuditEntry,
  AvailabilityDay,
  ClassGuidance,
  Course,
  Plan,
  PlanDraft,
  PlanInput,
  QAMessage,
  QuickCheckResult,
  Reflection,
  ReviewItem,
  ReviewStatus,
  StudySession,
  Task,
  TimeBlock,
  UnavailableSlot,
  User,
} from '../types';
import { DEMO_TODAY, WEEK_START, uid } from '../utils/time';

export interface Settings {
  simulateAiError: boolean;
  staleData: boolean;
  lastSync: string;
}

export interface AppState {
  user: User | null;
  courses: Course[];
  tasks: Task[];
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
  reflection: Reflection | null;
  settings: Settings;
  reviewQueue: ReviewItem[];
  assessments: AssessmentItem[];
  audit: AuditEntry[];
  /** Tasks whose drift warning the student chose to keep as-is (plan unchanged). */
  dismissedDrifts: string[];
}

export const initialState: AppState = {
  user: null,
  courses: seedCourses,
  tasks: seedTasks,
  plan: savedPlan,
  planHistory: [],
  availability: defaultAvailability,
  unavailable: defaultUnavailable,
  sessions: seedSessions,
  activeSession: null,
  wizardInput: null,
  planDraft: null,
  qaMessages: [],
  quickChecks: [
    {
      id: 'qc-1',
      topic: 'Hypothesis Testing',
      question: 'Giải thích ý nghĩa của p-value = 0,03 trong kiểm định một mẫu.',
      answer: 'p-value 0,03 nghĩa là giả thuyết H0 có 3% khả năng đúng.',
      evidenceState: 'abstained',
      confidence: 'low',
      feedback: 'Chưa đủ bằng chứng để kết luận. Câu trả lời nằm ngoài rubric tự động và đã được chuyển cho Giảng viên xem xét.',
      submittedAt: '29/09 08:40',
      reviewItemId: 'PW-104',
    },
  ],
  guidance: [
    {
      id: 'gd-1',
      topic: 'Hypothesis Testing',
      message: 'Lưu ý p-value là xác suất quan sát được dữ liệu (hoặc cực đoan hơn) khi H0 đúng, KHÔNG PHẢI xác suất H0 đúng. Các bạn ôn lại Slide tuần 3 trang 12.',
      at: '28/09 14:00',
      instructorName: 'TS. Nguyễn Văn A',
    },
  ],
  reflection: null,
  settings: { simulateAiError: false, staleData: false, lastSync: '2026-09-29T08:10:00+07:00' },
  reviewQueue: seedReview,
  assessments: seedAssessments,
  audit: seedAudit,
  dismissedDrifts: [],
};

export type Action =
  | { type: 'LOGIN'; user: User }
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
  | { type: 'SAVE_REFLECTION'; answers: [string, string, string] }
  | { type: 'SAVE_AVAILABILITY'; availability: AvailabilityDay[]; unavailable: UnavailableSlot[] }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'SET_REVIEW_STATUS'; id: string; status: ReviewStatus; note?: string }
  | { type: 'SET_ASSESSMENT_STATUS'; id: string; status: AssessmentStatus; note?: string }
  | { type: 'UPDATE_ASSESSMENT'; item: Pick<AssessmentItem, 'id' | 'question' | 'rubric' | 'level' | 'source'>; status?: AssessmentStatus; note?: string; historyText: string }
  | { type: 'DISMISS_DRIFT'; taskId: string }
  | { type: 'SYNC_CANVAS'; tasks: Task[]; courses?: Course[] }
  | { type: 'RESET_DEMO' };

function audit(state: AppState, action: string): AuditEntry[] {
  const d = new Date();
  const at = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
  return [{ id: uid('au'), at, actor: state.user?.name ?? 'Hệ thống', action }, ...state.audit];
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOGIN':
      // A first-time student starts with NO tasks, NO deadlines, NO plan, and NO sessions
      if (action.user.isNew) {
        return {
          ...initialState,
          user: action.user,
          courses: seedCourses,
          tasks: [], // Sinh viên mới: hoàn toàn chưa có bài tập hay deadline nào
          plan: null,
          sessions: [],
          dismissedDrifts: [],
          reflection: null,
        };
      }
      return { ...state, user: action.user };
    case 'SYNC_CANVAS': {
      const incomingTasks = action.tasks.map((t) => ({ ...t, loggedMin: 0, status: 'todo' as const }));
      return {
        ...state,
        tasks: incomingTasks,
        courses: action.courses ?? state.courses,
        settings: { ...state.settings, staleData: false, lastSync: new Date().toISOString() },
      };
    }
    case 'LOGOUT':
      return { ...state, user: null, activeSession: null };
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
      return {
        ...state,
        activeSession: null,
        sessions: [session, ...state.sessions],
        tasks: state.tasks.map((t) =>
          t.id === s.taskId ? { ...t, loggedMin: t.loggedMin + action.minutes, status: t.status === 'done' ? 'done' : 'in_progress' } : t,
        ),
      };
    }
    case 'ADD_MANUAL_SESSION': {
      const session: StudySession = { ...action.session, id: uid('ses'), source: 'manual' };
      return {
        ...state,
        sessions: [session, ...state.sessions],
        tasks: state.tasks.map((t) =>
          t.id === session.taskId ? { ...t, loggedMin: t.loggedMin + session.minutes, status: t.status === 'done' ? 'done' : 'in_progress' } : t,
        ),
      };
    }
    case 'UPDATE_TASK_ESTIMATE':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.taskId ? { ...t, estimateMin: action.estimateMin } : t)),
      };
    case 'SET_TASK_DONE':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: action.done ? 'done' : t.loggedMin > 0 ? 'in_progress' : 'todo' } : t,
        ),
      };
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
      return { ...state, plan, planHistory: [state.plan, ...state.planHistory], dismissedDrifts: [] };
    }
    case 'SAVE_REFLECTION':
      return { ...state, reflection: { weekStart: WEEK_START, answers: action.answers, savedAt: new Date().toISOString() } };
    case 'SAVE_AVAILABILITY':
      return { ...state, availability: action.availability, unavailable: action.unavailable };
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'SET_REVIEW_STATUS': {
      const item = state.reviewQueue.find((r) => r.id === action.id);
      const label = { approved: 'Duyệt kết luận', needs_review: 'Yêu cầu xem lại', in_review: 'Bắt đầu xem', pending: 'Đưa về chờ' }[action.status];
      return {
        ...state,
        reviewQueue: state.reviewQueue.map((r) => (r.id === action.id ? { ...r, status: action.status, note: action.note ?? r.note } : r)),
        quickChecks: state.quickChecks.map((qc) =>
          qc.reviewItemId === action.id
            ? {
                ...qc,
                evidenceState: action.status === 'approved' ? 'misconception' : qc.evidenceState,
                instructorNote: action.note ?? (action.status === 'approved' ? 'Giảng viên đã xem và xác nhận phân tích.' : undefined),
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
      return { ...state, dismissedDrifts: [...state.dismissedDrifts, action.taskId] };
    case 'RESET_DEMO': {
      if (state.user?.isNew) {
        return {
          ...initialState,
          user: state.user,
          courses: seedCourses,
          tasks: [],
          plan: null,
          sessions: [],
          dismissedDrifts: [],
          reflection: null,
        };
      }
      return { ...initialState, user: state.user };
    }
    default:
      return state;
  }
}

const STORAGE_KEY = 'pacewise-state-v2';

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    if (parsed.user?.isNew) {
      return {
        ...initialState,
        ...parsed,
        courses: seedCourses,
        plan: parsed.plan ?? null,
        sessions: parsed.sessions ?? [],
        tasks: parsed.plan ? (parsed.tasks ?? []) : [],
      };
    }
    return {
      ...initialState,
      ...parsed,
      quickChecks: parsed.quickChecks ?? initialState.quickChecks,
      guidance: parsed.guidance ?? initialState.guidance,
    };
  } catch {
    return initialState;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}
const StoreContext = createContext<StoreValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: state stays in memory */
    }
  }, [state]);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useAppStore must be used inside AppStoreProvider');
  return ctx;
}
