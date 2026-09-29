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
  courseData: Record<string, LMSCourseData>;
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
  lmsAssignmentId?: string;
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
  dueAt?: string | null;
  unlockAt?: string | null;
  lockAt?: string | null;
  overrideTarget?: 'student' | 'group' | 'section' | null;
  pointsPossible?: number;
  assignmentGroup?: LMSAssignmentGroup | null;
  gradingType?: string;
  peerReviews?: boolean;
  groupCategoryId?: string | null;
  rubric?: LMSRubric | null;
  submission?: LMSSubmissionSummary;
}

export interface LMSAssignmentGroup {
  id: string;
  name: string;
  weight: number;
}

export interface LMSRubricRating {
  id: number;
  description: string;
  points: number;
}

export interface LMSRubricCriterion {
  id: number;
  description: string;
  long_description?: string;
  points: number;
  position: number;
  ratings: LMSRubricRating[];
}

export interface LMSRubric {
  id: number;
  title: string;
  points_possible: number;
  criteria: LMSRubricCriterion[];
}

export interface LMSSubmissionSummary {
  state: string;
  attempts: number;
  late: boolean;
  score: number | null;
  feedback: string;
  rubricAssessment: Record<string, unknown>;
}

export interface LMSModuleRequirement {
  id: number;
  module_item_id: number;
  requirement_type: string;
  min_score: number | null;
  status: string;
}

export interface LMSModule {
  id: number;
  name: string;
  position: number;
  published: boolean;
  sequential_progress: boolean;
  prerequisite_module_ids: number[];
  requirements: LMSModuleRequirement[];
  items: Array<{ id: number; title: string; type: string; published: boolean }>;
}

export interface LMSResource {
  id: number;
  title: string;
  kind: string;
  source_url: string;
  folder: { id: number; name: string } | null;
  latest_version: {
    version: number;
    checksum_sha256: string;
    content_type: string;
    created_at: string;
  } | null;
  access_scope: Array<{ type: string; id: number }>;
}

export interface LMSPlannerItem {
  id: number;
  course_id: number;
  assignment_id: number | null;
  title: string;
  due_at: string | null;
  completed: boolean;
}

export interface LMSAppointmentGroup {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  slot_minutes: number;
  participants_per_slot: number;
  reservations: Array<{ id: number; user_id: number; starts_at: string; ends_at: string }>;
}

export interface LMSAnalytics {
  events: number;
  active_users: number;
  duration_seconds: number;
  by_type: Record<string, number>;
}

export interface LMSCourseData {
  courseId: string;
  modules: LMSModule[];
  resources: LMSResource[];
  plannerItems: LMSPlannerItem[];
  appointmentGroups: LMSAppointmentGroup[];
  sections?: Array<{ id: number; name: string; member_ids: number[] }>;
  groups?: Array<{
    id: number;
    name: string;
    self_signup: boolean;
    groups: Array<{ id: number; name: string; member_ids: number[] }>;
  }>;
  analytics?: LMSAnalytics;
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

export interface LMSInstructorSummary {
  analytics: LMSAnalytics;
  sections: Array<{ id: string; name: string; memberCount: number }>;
  groups: Array<{ id: string; name: string; teamCount: number }>;
  modules: Array<{ id: string; name: string; requirementCount: number }>;
  weightedAssignments: number;
  rubricAssignments: number;
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
