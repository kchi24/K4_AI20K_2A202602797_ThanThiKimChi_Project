import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { InstructorLayout } from '../layouts/InstructorLayout';
import { StudentLayout } from '../layouts/StudentLayout';
import { ForbiddenPage } from '../pages/auth/ForbiddenPage';
import { useAppStore } from '../store/AppStore';
import { RequireRole, homeFor } from './guards';

const LoginPage = lazy(() => import('../pages/auth/LoginPage').then((module) => ({ default: module.LoginPage })));
const LaunchPage = lazy(() => import('../pages/auth/LaunchPage').then((module) => ({ default: module.LaunchPage })));
const AssessmentEditPage = lazy(() => import('../pages/instructor/AssessmentEditPage').then((module) => ({ default: module.AssessmentEditPage })));
const AssessmentPage = lazy(() => import('../pages/instructor/AssessmentPage').then((module) => ({ default: module.AssessmentPage })));
const InstructorOverviewPage = lazy(() => import('../pages/instructor/InstructorOverviewPage').then((module) => ({ default: module.InstructorOverviewPage })));
const ReviewQueuePage = lazy(() => import('../pages/instructor/ReviewQueuePage').then((module) => ({ default: module.ReviewQueuePage })));
const DashboardPage = lazy(() => import('../pages/student/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const LearnPage = lazy(() => import('../pages/student/LearnPage').then((module) => ({ default: module.LearnPage })));
const PlanPage = lazy(() => import('../pages/student/PlanPage').then((module) => ({ default: module.PlanPage })));
const ProgressPage = lazy(() => import('../pages/student/ProgressPage').then((module) => ({ default: module.ProgressPage })));
const RecoverDiffPage = lazy(() => import('../pages/student/RecoverDiffPage').then((module) => ({ default: module.RecoverDiffPage })));
const RecoverPage = lazy(() => import('../pages/student/RecoverPage').then((module) => ({ default: module.RecoverPage })));
const ReflectPage = lazy(() => import('../pages/student/ReflectPage').then((module) => ({ default: module.ReflectPage })));
const SettingsPage = lazy(() => import('../pages/student/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const StudySessionPage = lazy(() => import('../pages/student/StudySessionPage').then((module) => ({ default: module.StudySessionPage })));
const TaskDetailPage = lazy(() => import('../pages/student/TaskDetailPage').then((module) => ({ default: module.TaskDetailPage })));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <span className="flex items-center gap-2 text-sm font-semibold text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-r-transparent" aria-hidden="true" />
        Đang mở trang…
      </span>
    </div>
  );
}

function RootRedirect() {
  const { state } = useAppStore();
  if (!state.authReady) return <div className="flex min-h-screen items-center justify-center text-muted">Đang kiểm tra phiên đăng nhập…</div>;
  return <Navigate to={homeFor(state.user?.role)} replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/launch" element={<LaunchPage />} />
      <Route path="/403" element={<ForbiddenPage />} />

      <Route
        element={
          <RequireRole role="student">
            <StudentLayout />
          </RequireRole>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/plan/new" element={<Navigate to="/plan" replace />} />
        <Route path="/plan/generating" element={<Navigate to="/plan" replace />} />
        <Route path="/plan/preview" element={<Navigate to="/plan" replace />} />
        <Route path="/study/:taskId" element={<TaskDetailPage />} />
        <Route path="/study/:taskId/session" element={<StudySessionPage />} />
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/recover/:optionId" element={<RecoverDiffPage />} />
        <Route path="/reflect" element={<ReflectPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route
        element={
          <RequireRole role="instructor">
            <InstructorLayout />
          </RequireRole>
        }
      >
        <Route path="/instructor" element={<InstructorOverviewPage />} />
        <Route path="/instructor/assessment" element={<AssessmentPage />} />
        <Route path="/instructor/assessment/:itemId" element={<AssessmentEditPage />} />
        <Route path="/instructor/review" element={<ReviewQueuePage />} />
      </Route>

      <Route path="*" element={<ForbiddenPage notFound />} />
      </Routes>
    </Suspense>
  );
}
