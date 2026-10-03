import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { CourseSwitcher } from '../components/domain/CourseSwitcher';
import { ReminderCenter } from '../components/domain/ReminderCenter';
import { Banner } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useDerived } from '../hooks/useDerived';
import { syncCanvas } from '../services/api';
import { useAppStore } from '../store/AppStore';
import { AppShell, type NavItem } from './AppShell';

function StaleBanner() {
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lastSyncLabel = state.settings.lastSync
    ? new Date(state.settings.lastSync).toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      })
    : 'chưa có lần đồng bộ thành công';
  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-10">
      <Banner
        tone="warning"
        icon="clock"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await syncCanvas();
                dispatch({ type: 'SYNC_CANVAS', courses: r.courses, tasks: r.tasks, guidance: r.guidance, assessments: r.assessments, courseData: r.courseData });
                toast({ tone: 'success', title: 'Đã đồng bộ dữ liệu Canvas' });
              } finally {
                setBusy(false);
              }
            }}
          >
            Đồng bộ lại
          </Button>
        }
      >
        Dữ liệu Canvas được đồng bộ lần cuối lúc <strong>{lastSyncLabel} (GMT+7)</strong> và có thể chưa phản ánh thay đổi mới.
      </Banner>
    </div>
  );
}

export function StudentLayout() {
  const { state } = useAppStore();
  const { drifts } = useDerived();
  const location = useLocation();
  const isGlobalPlan = location.pathname.startsWith('/plan');
  const allowAllCourses = ['/dashboard', '/plan', '/progress', '/recover'].some((path) => location.pathname.startsWith(path));
  const items: NavItem[] = [
    { to: '/dashboard', label: 'Tổng quan', icon: 'home', primary: true },
    { to: '/plan', label: 'Kế hoạch', icon: 'calendar', primary: true },
    { to: '/learn', label: 'Học tập', icon: 'book', primary: true },
    { to: '/progress', label: 'Tiến độ', icon: 'chart', primary: true },
    {
      to: '/recover',
      label: 'Phục hồi',
      icon: 'refresh',
      badge: drifts.length + state.planImpacts.filter((impact) => (
        impact.kind === 'schedule_conflict' || impact.kind === 'deadline_earlier' || impact.kind === 'assignment_added'
      )).length,
    },
    { to: '/reflect', label: 'Tổng kết', icon: 'notebook' },
    { to: '/settings', label: 'Cài đặt', icon: 'settings' },
  ];
  return (
    <AppShell
      items={items}
      roleLabel="Sinh viên"
      roleTone="primary"
      banner={<>
        {isGlobalPlan ? (
          <div className="px-4 pt-4 sm:px-6 lg:px-10">
            <Banner tone="info" icon="calendar">Kế hoạch luôn tổng hợp deadline và lịch bận của tất cả môn. Bộ lọc môn chỉ dùng ở các màn hình theo dõi.</Banner>
          </div>
        ) : <CourseSwitcher allowAll={allowAllCourses} />}
        {state.settings.staleData ? <StaleBanner /> : null}
        <ReminderCenter />
      </>}
    />
  );
}
