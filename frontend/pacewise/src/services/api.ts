/**
 * Mock API layer. Every function here is async and returns plain data, so it can be
 * swapped for real `fetch` calls to the FastAPI backend without touching UI code.
 */
import { users } from '../data/users';
import { assessments, auditLog, classGroups, groupStats, reviewQueue } from '../data/instructor';
import type { PlanDraft, PlanInput, Task, User } from '../types';
import { explainPlan, schedule } from '../utils/scheduler';
import { answerQuestion, hintFor, type QAResult } from '../utils/qa';
import { uid } from '../utils/time';

export class ApiError extends Error {
  constructor(
    public code: 'AI_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_CREDENTIALS' | 'FORBIDDEN',
    message: string,
    public requestId = `PW-REQ-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
  ) {
    super(message);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOptions {
  simulateError?: boolean;
}

export async function login(email: string, password: string): Promise<User> {
  await wait(500);
  const found = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password);
  if (!found) throw new ApiError('INVALID_CREDENTIALS', 'Email hoặc mật khẩu chưa đúng.');
  const { password: _pw, ...user } = found;
  void _pw;
  return user;
}

/** Plan generation. The UI drives the 3 visible steps; this resolves once the draft is ready. */
export async function generatePlan(input: PlanInput, tasks: Task[], opts: RequestOptions = {}): Promise<PlanDraft> {
  await wait(2700);
  if (opts.simulateError) throw new ApiError('AI_UNAVAILABLE', 'Chưa thể kết nối dịch vụ AI.');
  const result = schedule(input, tasks);
  const explained = explainPlan(input, result, tasks);
  return { input, blocks: result.blocks, feasibility: result.feasibility, ...explained, createdAt: new Date().toISOString() };
}

export async function askQuestion(question: string, opts: RequestOptions = {}): Promise<QAResult> {
  await wait(1100);
  if (opts.simulateError) throw new ApiError('AI_UNAVAILABLE', 'Chưa thể kết nối dịch vụ AI.');
  return answerQuestion(question);
}

export async function askHint(): Promise<QAResult> {
  await wait(800);
  return hintFor();
}

export async function syncCanvas(): Promise<{ syncedAt: string }> {
  await wait(900);
  return { syncedAt: new Date().toISOString() };
}

export async function reportCitation(sourceId: string): Promise<{ disputeId: string }> {
  await wait(400);
  return { disputeId: `CD-${sourceId.length}${Math.floor(Math.random() * 9000 + 1000)}` };
}

/* ---------- Instructor ---------- */

export async function fetchInstructorData() {
  await wait(300);
  return {
    classGroups,
    groupStats,
    reviewQueue: reviewQueue.map((r) => ({ ...r })),
    assessments: assessments.map((a) => ({ ...a })),
    audit: auditLog.map((a) => ({ ...a, id: a.id || uid('au') })),
  };
}
