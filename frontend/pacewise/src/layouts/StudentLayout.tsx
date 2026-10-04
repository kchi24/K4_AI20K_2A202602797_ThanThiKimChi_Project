import { useLocation } from 'react-router-dom';
import { CourseSwitcher } from '../components/domain/CourseSwitcher';
import { ReminderCenter } from '../components/domain/ReminderCenter';
import { AppShell, type NavItem } from './AppShell';

function StudentUtilityHeader({ showCourse }: { showCourse: boolean }) {
  return (
    <div className="sticky top-16 z-40 flex h-14 items-center justify-end gap-1 border-b border-line bg-white/95 px-4 backdrop-blur lg:top-0 lg:px-5" aria-label="Công cụ nhanh">
      {showCourse && <CourseSwitcher compact />}
      <ReminderCenter compact />
    </div>
  );
}

export function StudentLayout() {
  const location = useLocation();
  const isPlan = location.pathname.startsWith('/plan');
  const items: NavItem[] = [
    { to: '/plan', label: 'Plan', icon: 'calendar', primary: true },
    { to: '/learn', label: 'Do', icon: 'play', primary: true },
    { to: '/settings', label: 'Cài đặt', icon: 'settings', primary: true },
  ];
  return (
    <AppShell
      items={items}
      roleLabel="Sinh viên"
      roleTone="primary"
      iconOnly
      banner={isPlan ? undefined : <StudentUtilityHeader showCourse={location.pathname.startsWith('/learn')} />}
    />
  );
}
