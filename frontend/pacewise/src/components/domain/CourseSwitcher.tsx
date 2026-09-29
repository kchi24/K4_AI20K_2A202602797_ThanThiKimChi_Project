import { useState } from 'react';
import { Select } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { switchCourse, syncCanvas } from '../../services/api';
import { useAppStore } from '../../store/AppStore';

export function CourseSwitcher() {
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!state.user || state.courses.length < 2) return null;
  return (
    <div className="border-b border-line bg-white px-4 py-3 sm:px-6 lg:px-10">
      <Select
        className="max-w-md"
        label="Môn học đang thao tác"
        value={state.user.courseId ?? state.courses[0]?.id}
        disabled={busy}
        options={state.courses.map((course) => ({ value: course.id, label: `${course.code} — ${course.name}` }))}
        onChange={async (event) => {
          const courseId = event.target.value;
          setBusy(true);
          try {
            await switchCourse(courseId);
            dispatch({ type: 'SET_ACTIVE_COURSE', courseId });
            const synced = await syncCanvas();
            dispatch({ type: 'SYNC_CANVAS', courses: synced.courses, tasks: synced.tasks, guidance: synced.guidance, courseData: synced.courseData });
            toast({ tone: 'success', title: 'Đã chuyển môn học' });
          } finally {
            setBusy(false);
          }
        }}
      />
      <p className="caption mt-1">Trang tổng quan sinh viên vẫn tổng hợp deadline của tất cả môn.</p>
    </div>
  );
}
