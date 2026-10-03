import { useEffect, useRef, useState } from 'react';
import { Select } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { switchCourse, syncCanvas } from '../../services/api';
import { useAppStore } from '../../store/AppStore';

export function CourseSwitcher({ allowAll = false }: { allowAll?: boolean }) {
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const selectedScope = allowAll ? state.courseScope : state.user?.courseId ?? '';
  const [displayCourseId, setDisplayCourseId] = useState(selectedScope);
  const activeCourseRef = useRef(state.user?.courseId);

  useEffect(() => {
    if (!busy) {
      setDisplayCourseId(allowAll ? state.courseScope : state.user?.courseId ?? state.courses[0]?.id ?? '');
      activeCourseRef.current = state.user?.courseId;
    }
  }, [allowAll, busy, state.courseScope, state.courses, state.user?.courseId]);

  if (!state.user || state.courses.length < 2) return null;

  const selectCourse = async (courseId: string) => {
    if (busy || courseId === displayCourseId) return;
    if (courseId === 'all') {
      setDisplayCourseId('all');
      dispatch({ type: 'SET_COURSE_SCOPE', courseScope: 'all' });
      toast({ tone: 'success', title: 'Đang xem tổng quan tất cả môn' });
      return;
    }
    const previousCourseId = state.user?.courseId;
    const previousScope = state.courseScope;
    setDisplayCourseId(courseId);
    activeCourseRef.current = courseId;
    setBusy(true);
    try {
      await switchCourse(courseId);
      activeCourseRef.current = courseId;
      dispatch({ type: 'SET_ACTIVE_COURSE', courseId });
      if (allowAll) dispatch({ type: 'SET_COURSE_SCOPE', courseScope: courseId });
      toast({ tone: 'success', title: 'Đã chuyển môn học' });
    } catch (error) {
      activeCourseRef.current = previousCourseId;
      setDisplayCourseId(allowAll ? previousScope : previousCourseId ?? state.courses[0]?.id ?? '');
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
        label={allowAll ? 'Phạm vi hiển thị' : 'Môn học đang thao tác'}
        value={displayCourseId || (allowAll ? 'all' : state.user.courseId || state.courses[0]?.id)}
        disabled={busy}
        options={[
          ...(allowAll ? [{ value: 'all', label: 'Tất cả môn học' }] : []),
          ...state.courses.map((course) => ({ value: course.id, label: `${course.code} — ${course.name}` })),
        ]}
        onChange={(event) => void selectCourse(event.target.value)}
      />
      <p className="caption mt-1">
        {busy
          ? 'Đang xác nhận môn học...'
          : allowAll
            ? 'Tổng quan mặc định so sánh deadline và tiến độ giữa tất cả môn; chọn một môn khi cần xem chi tiết.'
            : 'Học liệu và hoạt động bên dưới thuộc môn đang chọn.'}
      </p>
    </div>
  );
}
