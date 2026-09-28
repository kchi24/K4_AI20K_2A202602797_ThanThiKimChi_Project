import type {
  AssessmentItem,
  AuditEntry,
  CanvasSyncResult,
  ClassGuidance,
  ClassGroup,
  GroupStats,
  PlanDraft,
  PlanInput,
  ReviewItem,
  Task,
  User,
} from '../types';
import { explainPlan, schedule } from '../utils/scheduler';
import type { QAResult } from '../utils/qa';

const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public code: 'AI_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_CREDENTIALS' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UPSTREAM' | 'UNKNOWN',
    message: string,
    public requestId = `PW-REQ-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
  ) {
    super(message);
  }
}

function cookie(name: string) {
  return document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = cookie('pacewise_csrf');
    if (csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError('UPSTREAM', 'Không thể kết nối PaceWise API.');
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string };
    const code = response.status === 401
      ? path === '/auth/lms-login' ? 'INVALID_CREDENTIALS' : 'UNAUTHENTICATED'
      : response.status === 403 ? 'FORBIDDEN'
      : response.status >= 502 ? 'UPSTREAM'
      : 'UNKNOWN';
    throw new ApiError(code, payload.detail || `Yêu cầu thất bại (${response.status}).`, response.headers.get('X-Request-ID') || undefined);
  }
  return (await response.json()) as T;
}

export async function login(email: string, password: string, courseId?: number): Promise<User> {
  const result = await request<{ user: User }>('/auth/lms-login', {
    method: 'POST',
    body: JSON.stringify({ email, password, course_id: courseId }),
  });
  return result.user;
}

export async function loginWithLaunch(token: string): Promise<User> {
  const result = await request<{ user: User }>('/auth/lms-launch', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  return result.user;
}

export async function getCurrentSession(): Promise<User | null> {
  try {
    return (await request<{ user: User }>('/auth/me')).user;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return null;
    throw error;
  }
}

export async function logout(): Promise<void> {
  try {
    await request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'UNAUTHENTICATED') throw error;
  }
}

export async function switchCourse(courseId: string): Promise<{ courseId: string }> {
  return request<{ courseId: string }>('/auth/course', {
    method: 'POST',
    body: JSON.stringify({ courseId: Number(courseId) }),
  });
}

export async function loadWorkspace(): Promise<{ state: Record<string, unknown>; version: number }> {
  return request<{ state: Record<string, unknown>; version: number }>('/workspace');
}

export async function saveWorkspace(state: Record<string, unknown>): Promise<{ version: number; updatedAt: string }> {
  return request<{ version: number; updatedAt: string }>('/workspace', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  });
}

export async function saveInstructorAction(
  actionType: 'review' | 'assessment' | 'guidance',
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await request('/instructor/actions', {
    method: 'POST',
    body: JSON.stringify({ actionType, entityId, payload }),
  });
}

export interface RequestOptions { simulateError?: boolean }

interface AgentResponse {
  response: string;
  workflow: 'plan' | 'tracking' | 'qa' | 'understanding' | 'recover' | 'reflect';
  mode?: string;
  status: string;
  pending_action?: Record<string, unknown> | null;
  output?: { plan_validation?: { valid: boolean; errors: { code: string }[] } } | null;
  source_refs: { citation: string }[];
}

async function runAgent(
  message: string,
  workflow: AgentResponse['workflow'],
  context: Record<string, unknown> = {},
): Promise<AgentResponse> {
  return request<AgentResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify({ message, workflow, context }),
  });
}

export async function generatePlan(input: PlanInput, tasks: Task[], opts: RequestOptions = {}): Promise<PlanDraft> {
  if (opts.simulateError) throw new ApiError('AI_UNAVAILABLE', 'Chưa thể kết nối dịch vụ AI.');
  const selected = input.tasks
    .map((item) => tasks.find((task) => task.id === item.taskId)?.title)
    .filter(Boolean)
    .join(', ');
  const agentResult = await runAgent(
    `Lập kế hoạch tuần cho mục tiêu “${input.goal}”. Các nhiệm vụ đã chọn: ${selected}.`,
    'plan',
    {
      availability: input.availability
        .filter((item) => item.enabled)
        .map((item) => ({ day: String(item.weekday), start: item.start, end: item.end })),
      unavailable_slots: input.unavailable.map((item) => ({
        id: item.id,
        label: item.label,
        day: String(item.weekday),
        start: item.start,
        end: item.end,
      })),
      goals: [{ title: input.goal }],
    },
  );
  if (agentResult.output?.plan_validation && !agentResult.output.plan_validation.valid) {
    throw new ApiError(
      'AI_UNAVAILABLE',
      `Kế hoạch AI chưa khả thi: ${agentResult.output.plan_validation.errors.map((item) => item.code).join(', ')}.`,
    );
  }
  const result = schedule(input, tasks);
  const explained = explainPlan(input, result, tasks);
  return {
    input,
    blocks: result.blocks,
    feasibility: result.feasibility,
    reasons: [agentResult.response, ...explained.reasons],
    assumptions: explained.assumptions,
    createdAt: new Date().toISOString(),
  };
}

export async function askQuestion(question: string, opts: RequestOptions = {}): Promise<QAResult> {
  if (opts.simulateError) throw new ApiError('AI_UNAVAILABLE', 'Chưa thể kết nối dịch vụ AI.');
  const result = await runAgent(question, 'qa');
  return {
    kind: result.mode === 'integrity' ? 'integrity' : result.source_refs.length ? 'grounded' : 'abstained',
    text: result.response,
    citations: result.source_refs.map((item) => item.citation),
    suggestions: [],
  };
}

export async function askHint(): Promise<QAResult> {
  const result = await runAgent(
    'Hãy gợi ý từng bước và đặt câu hỏi Socratic để tôi tự làm, không đưa đáp án hoàn chỉnh.',
    'qa',
  );
  return {
    kind: 'hint',
    text: result.response,
    citations: result.source_refs.map((item) => item.citation),
    suggestions: [],
  };
}

export async function confirmPlan(): Promise<void> {
  await runAgent('Tôi xác nhận kế hoạch này.', 'plan');
}

export async function syncCanvas(): Promise<CanvasSyncResult> {
  return request<CanvasSyncResult>('/lms/sync');
}

export async function reportCitation(sourceId: string): Promise<{ disputeId: string }> {
  return { disputeId: `CD-${sourceId.length}${Math.floor(Math.random() * 9000 + 1000)}` };
}

export interface InstructorData {
  classGroups: ClassGroup[];
  groupStats: Record<string, GroupStats>;
  reviewQueue: ReviewItem[];
  assessments: AssessmentItem[];
  audit: AuditEntry[];
  guidance: ClassGuidance[];
  privacy: { minimumGroupSize: number; containsDirectIdentifiers: boolean };
}

export async function fetchInstructorData(): Promise<InstructorData> {
  return request<InstructorData>('/instructor/overview');
}
