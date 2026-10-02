import { useEffect, useRef, useState } from 'react';
import { Select } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { switchCourse, syncCanvas } from '../../services/api';
import { useAppStore } from '../../store/AppStore';

export function CourseSwitcher() {
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [displayCourseId, setDisplayCourseId] = useState(state.user?.courseId ?? '');
  const activeCourseRef = useRef(state.user?.courseId);

  useEffect(() => {
    if (!busy) {
      setDisplayCourseId(state.user?.courseId ?? state.courses[0]?.id ?? '');
      activeCourseRef.current = state.user?.courseId;
    }
  }, [busy, state.courses, state.user?.courseId]);

  if (!state.user || state.courses.length < 2) return null;

  const selectCourse = async (courseId: string) => {
    if (busy || courseId === state.user?.courseId) return;
    const previousCourseId = state.user?.courseId;
    setDisplayCourseId(courseId);
    activeCourseRef.current = courseId;
    setBusy(true);
    try {
      await switchCourse(courseId);
      activeCourseRef.current = courseId;
      dispatch({ type: 'SET_ACTIVE_COURSE', courseId });
      toast({ tone: 'success', title: 'Đã chuyển môn học' });
    } catch (error) {
      activeCourseRef.current = previousCourseId;
      setDisplayCourseId(previousCourseId ?? state.courses[0]?.id ?? '');
      toast({
        tone: 'danger',
        title: 'Chưa chuyển được môn học',
        description: error instanceof Error ? error.message : 'Hãy thử lại.',
      });
      return;
    } finally {
      setBusy(false);
    }

    void syncCanvas()
      .then((synced) => {
        if (synced.activeCourseId !== activeCourseRef.current) return;
        dispatch({
          type: 'SYNC_CANVAS',
          courses: synced.courses,
          tasks: synced.tasks,
          guidance: synced.guidance,
          assessments: synced.assessments,
          courseData: synced.courseData,
        });
      })
      .catch(() => {
        toast({
          tone: 'warning',
          title: 'Đã chuyển môn, nhưng chưa làm mới được dữ liệu',
          description: 'PaceWise đang dùng dữ liệu đã đồng bộ gần nhất.',
        });
      });
  };

  return (
    <div className="border-b border-line bg-white px-4 py-3 sm:px-6 lg:px-10" aria-busy={busy}>
      <Select
        className="max-w-md"
        label="Môn học đang thao tác"
        value={displayCourseId || state.user.courseId || state.courses[0]?.id}
        disabled={busy}
        options={state.courses.map((course) => ({ value: course.id, label: `${course.code} — ${course.name}` }))}
        onChange={(event) => void selectCourse(event.target.value)}
      />
      <p className="caption mt-1">
        {busy ? 'Đang xác nhận môn học...' : 'Các chỉ số và học liệu bên dưới được lọc theo môn đang chọn.'}
      </p>
    </div>
  );
}
