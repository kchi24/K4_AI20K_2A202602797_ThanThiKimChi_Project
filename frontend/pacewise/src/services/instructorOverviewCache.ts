import type { InstructorData } from './api';

const CACHE_PREFIX = 'pacewise:instructor-overview:v1';
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

interface CachedInstructorOverview {
  savedAt: number;
  data: InstructorData;
}

const cacheKey = (userId: string, courseId: string) =>
  `${CACHE_PREFIX}:${userId}:${courseId}`;

function isInstructorData(value: unknown): value is InstructorData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<InstructorData>;
  return Array.isArray(data.classGroups)
    && !!data.groupStats
    && Array.isArray(data.reviewQueue)
    && Array.isArray(data.assessments)
    && Array.isArray(data.audit)
    && Array.isArray(data.guidance);
}

export function readInstructorOverviewCache(
  userId: string | undefined,
  courseId: string | undefined,
): InstructorData | null {
  if (!userId || !courseId) return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(userId, courseId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedInstructorOverview>;
    if (
      typeof cached.savedAt !== 'number'
      || Date.now() - cached.savedAt > CACHE_MAX_AGE_MS
      || !isInstructorData(cached.data)
    ) {
      window.sessionStorage.removeItem(cacheKey(userId, courseId));
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

export function writeInstructorOverviewCache(
  userId: string | undefined,
  courseId: string | undefined,
  data: InstructorData,
): void {
  if (!userId || !courseId) return;
  try {
    const cached: CachedInstructorOverview = { savedAt: Date.now(), data };
    window.sessionStorage.setItem(cacheKey(userId, courseId), JSON.stringify(cached));
  } catch {
    // A disabled/full browser storage must not break the instructor dashboard.
  }
}
