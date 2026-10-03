import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstructorData } from '../src/services/api';
import {
  readInstructorOverviewCache,
  writeInstructorOverviewCache,
} from '../src/services/instructorOverviewCache';

const data: InstructorData = {
  classGroups: [{ id: 'all', name: 'Cả lớp', n: 8 }],
  groupStats: {},
  reviewQueue: [],
  assessments: [],
  audit: [],
  guidance: [],
  privacy: { minimumGroupSize: 5, containsDirectIdentifiers: false },
  lmsSummary: null,
};

describe('instructor overview cache', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('restores the latest aggregate for the same user and course', () => {
    writeInstructorOverviewCache('teacher-1', 'course-1', data);

    expect(readInstructorOverviewCache('teacher-1', 'course-1')).toEqual(data);
  });

  it('does not reuse another course cache', () => {
    writeInstructorOverviewCache('teacher-1', 'course-1', data);

    expect(readInstructorOverviewCache('teacher-1', 'course-2')).toBeNull();
  });

  it('drops expired data', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(3_700_001);
    writeInstructorOverviewCache('teacher-1', 'course-1', data);

    expect(readInstructorOverviewCache('teacher-1', 'course-1')).toBeNull();
    vi.restoreAllMocks();
  });
});
