// Domain types for PaceWise. These mirror the shapes a real backend API would return.

export type Role = 'student' | 'instructor' | 'guest';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Course bound to the authenticated LMS launch/session. */
  courseId?: string;
  courseIds?: string[];
  /** Demo flag: a first-time student who has no saved plan yet. */
  isNew?: boolean;
}

export interface CanvasSyncResult {
  courses: Course[];
  tasks: Task[];
  guidance?: ClassGuidance[];
  syncedAt: string;
  source: string;
  activeCourseId: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  tone: Tone;
}

export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

export type Priority = 'high' | 'medium' | 'low';
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  courseId: string;
  /** Local date `YYYY-MM-DD`, deadline is 23:59 GMT+7 of that day. */
  deadline: string;
  estimateMin: number;
  loggedMin: number;
  status: TaskStatus;
  priority: Priority;
  objective: string;
  /** True when the estimate came from PaceWise rather than the student. */
  estimateIsAssumption?: boolean;
}

/** `HH:MM` 24h clock. */
export type Clock = string;

export interface TimeBlock {
  id: string;
  taskId: string;
  /** Local date `YYYY-MM-DD`. */
  date: string;
  start: Clock;
  end: Clock;
}

export interface Plan {
  id: string;
  weekStart: string;
  blocks: TimeBlock[];
  savedAt: string;
  version: number;
}

/** 0 = Thứ Hai … 6 = Chủ Nhật */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvailabilityDay {
  weekday: Weekday;
  enabled: boolean;
  start: Clock;
  end: Clock;
}

export interface UnavailableSlot {
  id: string;
  label: string;
  weekday: Weekday;
  start: Clock;
  end: Clock;
}

export type PreferredTime = 'morning' | 'afternoon' | 'evening';

export interface PlanInput {
  goal: string;
  tasks: { taskId: string; remainingMin: number }[];
  availability: AvailabilityDay[];
  unavailable: UnavailableSlot[];
  preferred: PreferredTime;
}

export interface Feasibility {
  availableMin: number;
  requiredMin: number;
  remainingMin: number;
  feasible: boolean;
  deficitMin: number;
  /** Tasks that could not be fully placed before their deadline. */
  shortfalls: { taskId: string; missingMin: number }[];
}

export interface PlanDraft {
  input: PlanInput;
  blocks: TimeBlock[];
  feasibility: Feasibility;
  reasons: string[];
  assumptions: string[];
  createdAt: string;
}

export interface StudySession {
  id: string;
  taskId: string;
  date: string;
  minutes: number;
  note?: string;
  source: 'timer' | 'manual';
}

export interface ActiveSession {
  taskId: string;
  /** epoch ms when the current running segment started, null when paused */
  runningSince: number | null;
  accumulatedMs: number;
}

export interface Source {
  id: string;
  name: string;
  location: string;
  excerpt: string;
  context?: string;
}

export type QAKind = 'grounded' | 'abstained' | 'integrity' | 'hint';

export interface QAMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  kind?: QAKind;
  citations?: string[];
  suggestions?: string[];
  createdAt: string;
}

export type DiffType = 'added' | 'removed' | 'moved' | 'unchanged';

export interface DiffItem {
  type: DiffType;
  taskId: string;
  before?: { date: string; start: Clock; end: Clock };
  after?: { date: string; start: Clock; end: Clock };
}

export interface Drift {
  taskId: string;
  expectedMin: number;
  loggedMin: number;
  deficitMin: number;
  deadline: string;
}

export interface RecoveryOption {
  id: 'A' | 'B' | 'C';
  title: string;
  summary: string;
  changes: string[];
  impact: string;
  time: string;
  tradeoff: string;
  newBlocks: TimeBlock[];
  /** Availability assumptions the option relies on, always shown to the user. */
  assumptions: string[];
  fullyRecovers: boolean;
}

export interface Reflection {
  weekStart: string;
  answers: [string, string, string];
  savedAt: string;
  aiDraft?: Record<string, unknown>;
  aiSummary?: string;
}

export interface Toast {
  id: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
  title: string;
  description?: string;
}

/* ---------- Instructor ---------- */

export interface ClassGroup {
  id: string;
  name: string;
  n: number;
}

export interface GroupStats {
  groupId: string;
  onTimeRate: number; // 0..1
  onTimeCount: number;
  weeklyCompletion: { week: string; rate: number; count: number; total: number }[];
  topics: { topic: string; needsSupport: number; n: number }[];
  atRisk: number;
}

export type ReviewStatus = 'pending' | 'in_review' | 'approved' | 'needs_review';

export interface ReviewItem {
  id: string;
  topic: string;
  question: string;
  responseExcerpt: string;
  confidence: 'low' | 'medium';
  reason: string;
  status: ReviewStatus;
  submittedAt: string;
  note?: string;
}

export type AssessmentStatus = 'draft' | 'review' | 'approved' | 'rejected';

export interface AssessmentItem {
  id: string;
  topic: string;
  question: string;
  rubric: string[];
  status: AssessmentStatus;
  note?: string;
  level?: string;
  source?: string;
  aiGenerated?: boolean;
  history?: { at: string; text: string }[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
}

export type EvidenceState = 'demonstrated' | 'developing' | 'misconception' | 'abstained';

export interface QuickCheckResult {
  id: string;
  topic: string;
  question: string;
  answer: string;
  evidenceState: EvidenceState;
  confidence: 'high' | 'medium' | 'low';
  feedback: string;
  submittedAt: string;
  reviewItemId?: string;
  instructorNote?: string;
}

export interface ClassGuidance {
  id: string;
  topic: string;
  message: string;
  at: string;
  instructorName: string;
}
