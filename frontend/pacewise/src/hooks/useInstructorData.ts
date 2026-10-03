import { useEffect, useState } from 'react';
import { ApiError, fetchInstructorData, type InstructorData } from '../services/api';
import { readInstructorOverviewCache, writeInstructorOverviewCache } from '../services/instructorOverviewCache';
import { useAppStore } from '../store/AppStore';

const inFlight = new Map<string, Promise<InstructorData>>();

function requestInstructorData(key: string) {
  const current = inFlight.get(key);
  if (current) return current;
  const request = fetchInstructorData().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Keeps every instructor tab backed by the same course-scoped LMS snapshot. */
export function useInstructorData() {
  const { state, dispatch } = useAppStore();
  const hasData = state.classGroups.length > 0;
  const [loading, setLoading] = useState(!hasData);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let active = true;
    const userId = state.user?.id;
    const courseId = state.user?.courseId;
    if (!userId || !courseId) return () => { active = false; };

    const cached = readInstructorOverviewCache(userId, courseId);
    if (cached) {
      dispatch({ type: 'SET_INSTRUCTOR_DATA', ...cached });
      setLoading(false);
    } else {
      setLoading(true);
    }

    const key = `${userId}:${courseId}:${state.lmsRevision}`;
    void requestInstructorData(key)
      .then((data) => {
        if (!active) return;
        writeInstructorOverviewCache(userId, courseId, data);
        dispatch({ type: 'SET_INSTRUCTOR_DATA', ...data });
        setError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof ApiError ? reason : new ApiError('UNKNOWN', 'Không thể tải dữ liệu giảng viên.'));
      })
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [dispatch, state.lmsRevision, state.user?.courseId, state.user?.id]);

  return { loading, error };
}
