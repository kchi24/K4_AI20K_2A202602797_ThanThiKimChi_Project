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
  assessments?: AssessmentItem[];
  reviewResolutions?: Record<string, {
    status: ReviewStatus;
    note?: string;
    resolvedStatus?: string;
  }>;
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
export type PersonalPriority = 1 | 2 | 3 | 4;
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
  /** Learner-owned preference; independent from LMS weight and system risk. */
  personalPriority?: PersonalPriority;
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

/** User-owned fields layered on top of the latest LMS task snapshot. */
export interface TaskProgress {
  estimateMin: number;
  estimateIsAssumption?: boolean;
  loggedMin: number;
  status: TaskStatus;
  personalPriority?: PersonalPriority;
  updatedAt: string;
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
  submittedAt?: string | null;
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

export interface LMSCalendarItem {
  id: string;
  source_id: number;
  type: 'assignment' | 'event';
  course_id: number | null;
  course_code: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  event_kind: string;
  editable: boolean;
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
  calendarItems?: LMSCalendarItem[];
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
  /** Optional AI decomposition; calendar placement remains deterministic. */
  milestoneId?: string | null;
  milestoneTitle?: string | null;
  /** Local date `YYYY-MM-DD`. */
  date: string;
  start: Clock;
  end: Clock;
  /** Current week is committed; next-week blocks remain a forecast. */
  status?: 'confirmed' | 'tentative' | 'history';
}

export interface WeeklyGoal {
  id: string;
  title: string;
  taskIds: string[];
  confirmed: boolean;
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
  /** Exact local date for LMS/Google constraints; manual recurring slots omit it. */
  date?: string;
  source?: 'manual' | 'google' | 'lms' | 'routine';
  /** Self-study is a preferred window; the other categories are hard constraints. */
  category?: PersonalSlotCategory;
  readOnly?: boolean;
}

export type PersonalSlotCategory = 'meal' | 'self_study' | 'sleep' | 'other';
export type PreferredTime = 'late_night' | 'morning' | 'afternoon' | 'evening';

export interface RoutineProfile {
  wakeTime: Clock;
  sleepTime: Clock;
  preferred: PreferredTime[];
}

export interface PlanInput {
  goal: string;
  /** Monday of the selected calendar week. Optional for legacy saved drafts. */
  weekStart?: string;
  /** End of the visible forecast horizon (normally Sunday next week). */
  horizonEnd?: string;
  weeklyGoals?: WeeklyGoal[];
  tasks: {
    taskId: string;
    remainingMin: number;
    personalPriority?: PersonalPriority;
    weeklyGoalId?: string;
  }[];
  availability: AvailabilityDay[];
  unavailable: UnavailableSlot[];
  /** One or more preferred study periods. A scalar is accepted for old workspaces. */
  preferred: PreferredTime | PreferredTime[];
  /** Student-positioned blocks that the AI must preserve while scheduling the remainder. */
  pinnedBlocks?: TimeBlock[];
}

export interface Feasibility {
  availableMin: number;
  requiredMin: number;
  remainingMin: number;
  feasible: boolean;
  deficitMin: number;
  /** Tasks that could not be fully placed before their deadline. */
  shortfalls: { taskId: string; missingMin: number }[];
  /** Open 14-day deadlines intentionally left outside this draft. */
  uncoveredTasks?: { taskId: string; title: string; deadline: string }[];
}

export interface PlanDraft {
  input: PlanInput;
  weekStart?: string;
  weekEnd?: string;
  horizonEnd?: string;
  scheduleStart?: string;
  weeklyGoals?: WeeklyGoal[];
  blocks: TimeBlock[];
  feasibility: Feasibility;
  reasons: string[];
  assumptions: string[];
  createdAt: string;
  /** Work that must be completed inside this 7-day window, not the whole assignment. */
  planningTargets?: Array<{ taskId: string; targetMin: number; remainingMin: number }>;
  /** Canonical task priority: deadline, priority, group weight, then points. */
  priorityOrder?: Array<{
    rank: number;
    taskId: string;
    title: string;
    deadline: string;
    priority: Priority;
    personalPriority: PersonalPriority;
    assignmentGroupWeight: number;
    pointsPossible: number;
  }>;
  milestones?: Array<{
    milestoneId: string;
    taskId: string;
    weeklyGoalId?: string | null;
    title: string;
    deliverable: string;
    estimatedMin: number;
    targetMin: number;
    dependsOn: string[];
    sourceRefs?: string[];
    deadline: string;
  }>;
}

export interface StudySession {
  id: string;
  taskId: string;
  date: string;
  minutes: number;
  note?: string;
  source: 'timer' | 'manual';
  blockId?: string;
  plannedMin?: number;
  completionPercent?: number;
  outcome?: DoOutcome;
  blocker?: DoBlocker;
  blockerNote?: string;
  needsRecovery?: boolean;
}

export type DoOutcome = 'on_track' | 'completed' | 'needs_more_time' | 'blocked' | 'missed';
export type DoBlocker = 'none' | 'knowledge' | 'time' | 'interruption' | 'other';

export interface DoResource {
  id: string;
  title: string;
  kind: string;
  url?: string | null;
  module: string;
  citation: string;
}

export interface DoSessionPreparation {
  action: 'prepare';
  status: 'ready';
  block_id: string;
  task_id: string;
  title: string;
  objective: string;
  planned_minutes: number;
  recommended_resources: DoResource[];
  opening_prompt: string;
}

export interface DoSessionEvaluation {
  action: 'complete';
  status: DoOutcome;
  block_id: string;
  task_id: string;
  planned_minutes: number;
  actual_minutes: number;
  variance_minutes: number;
  completion_percent: number;
  remaining_minutes: number;
  blocker: DoBlocker;
  blocker_note: string;
  needs_recovery: boolean;
  needs_understanding_check: boolean;
  next_action: string;
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
  sources?: Source[];
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
  courseId: string;
  kind: 'missed_progress' | 'capacity_gap';
  expectedMin: number;
  loggedMin: number;
  deficitMin: number;
  deadline: string;
}

export type PlanImpactKind =
  | 'schedule_conflict'
  | 'capacity_released'
  | 'deadline_earlier'
  | 'deadline_later'
  | 'assignment_removed'
  | 'assignment_added';

export interface PlanImpact {
  id: string;
  kind: PlanImpactKind;
  /** Constraint that caused a conflict; used to retire stale impacts after replanning. */
  constraintId?: string;
  title: string;
  message: string;
  courseId?: string;
  taskId?: string;
  deadline?: string;
  deficitMin: number;
  affectedBlockIds: string[];
  detectedAt: string;
}

export type ReminderKind =
  | 'study_block'
  | 'deadline_72h'
  | 'deadline_24h'
  | 'deadline_2h'
  | 'missed_block'
  | 'lms_change'
  | 'online_class'
  | 'quiz'
  | 'exam_24h'
  | 'exam_60m'
  | 'evening_digest';

export type ReminderUrgency = 'normal' | 'urgent' | 'critical';

/** A deterministic reminder derived from the saved plan and the latest LMS projection. */
export interface Reminder {
  id: string;
  kind: ReminderKind;
  title: string;
  message: string;
  scheduledAt: string;
  expiresAt: string;
  urgency: ReminderUrgency;
  courseId?: string;
  taskId?: string;
  href?: string;
}

export interface ReminderPreferences {
  enabled: boolean;
  browserEnabled: boolean;
  dailyCap: number;
  studyBlockLeadMinutes: number;
  digestHour: number;
}

/** Delivery receipts are persisted to avoid duplicate notifications across reloads/devices. */
export interface ReminderState {
  preferences: ReminderPreferences;
  deliveredAt: Record<string, string>;
  readIds: string[];
}

export interface EstimateProfile {
  courseId: string;
  sampleCount: number;
  /** Exponential moving average of actual / estimated duration. */
  multiplier: number;
  updatedAt: string;
}

export interface PilotMetrics {
  measuredAt: string;
  openDeadlineCount: number;
  plannedDeadlineCount: number;
  atRiskDeadlineCount: number;
  onTimeSubmissionCount: number;
  gradedSubmissionCount: number;
  /** Submitted assignments used as the denominator, including ungraded work. */
  submittedAssignmentCount?: number;
  planCoverageRate: number;
  onTimeSubmissionRate: number | null;
  estimateMaePercent: number | null;
  recoveryCount: number;
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
  /** Structured capacity evidence; optional for legacy persisted options. */
  workloadMinutes?: number;
  scheduledMinutes?: number;
  missingMinutes?: number;
  shortfalls?: Array<{ taskId: string; missingMin: number }>;
}

export interface Reflection {
  courseId: string;
  weekStart: string;
  effectiveWeekStart?: string;
  scope?: 'weekly' | 'activity';
  activityId?: string;
  activityTitle?: string;
  activityKind?: string;
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
  onTimeTotal: number;
  weeklyCompletion: { week: string; rate: number; count: number; total: number }[];
  topics: { topic: string; needsSupport: number; n: number }[];
  atRisk: number;
  riskWindowDays: number;
  progressImprovement: number | null;
  assignmentRisks: Array<{
    assignmentId: string;
    title: string;
    dueAt: string;
    atRiskCount: number;
    totalStudents: number;
    missingMinutes: number;
  }>;
}

export interface LMSInstructorSummary {
  analytics: LMSAnalytics;
  sections: Array<{ id: string; name: string; memberCount: number }>;
  groups: Array<{ id: string; name: string; teamCount: number }>;
  modules: Array<{ id: string; name: string; requirementCount: number }>;
  weightedAssignments: number;
  rubricAssignments: number;
}

export type ReviewStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'needs_evidence';

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
  suggestedStatus?: string;
  rubricVersion?: number;
  aiConclusion?: string;
  rubricCriteria?: Array<{ name: string; score?: number | string; maxScore?: number }>;
  evidenceQuotes?: string[];
  sourceRefs?: Array<{ label: string; type: string; id: string; url?: string }>;
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
  version?: number;
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
  rubricVersion?: number;
}

export interface ClassGuidance {
  id: string;
  topic: string;
  message: string;
  at: string;
  instructorName: string;
}
