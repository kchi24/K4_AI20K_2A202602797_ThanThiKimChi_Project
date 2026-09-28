import { useAppStore } from '../store/AppStore';
import { CourseSwitcher } from '../components/domain/CourseSwitcher';
import { AppShell, type NavItem } from './AppShell';

export function InstructorLayout() {
  const { state } = useAppStore();
  const pending = state.reviewQueue.filter((r) => r.status === 'pending' || r.status === 'in_review').length;
  const toReview = state.assessments.filter((a) => a.status === 'review').length;
  const items: NavItem[] = [
    { to: '/instructor', label: 'Tổng quan lớp', icon: 'chart', end: true, primary: true },
    { to: '/instructor/assessment', label: 'Ngân hàng câu hỏi', icon: 'clipboard', badge: toReview, primary: true },
    { to: '/instructor/review', label: 'Hàng chờ duyệt', icon: 'inbox', badge: pending, primary: true },
  ];
  return <AppShell items={items} roleLabel="Giảng viên" roleTone="accent" banner={<CourseSwitcher />} />;
}
