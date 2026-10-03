import { Navigate, Route, Routes } from 'react-router-dom';
import { InstructorLayout } from '../layouts/InstructorLayout';
import { StudentLayout } from '../layouts/StudentLayout';
import { ForbiddenPage } from '../pages/auth/ForbiddenPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { LaunchPage } from '../pages/auth/LaunchPage';
import { AssessmentEditPage } from '../pages/instructor/AssessmentEditPage';
import { AssessmentPage } from '../pages/instructor/AssessmentPage';
import { InstructorOverviewPage } from '../pages/instructor/InstructorOverviewPage';
import { ReviewQueuePage } from '../pages/instructor/ReviewQueuePage';
import { DashboardPage } from '../pages/student/DashboardPage';
import { LearnPage } from '../pages/student/LearnPage';
import { PlanGeneratingPage } from '../pages/student/PlanGeneratingPage';
import { PlanPage } from '../pages/student/PlanPage';
import { PlanPreviewPage } from '../pages/student/PlanPreviewPage';
import { PlanWizardPage } from '../pages/student/PlanWizardPage';
import { ProgressPage } from '../pages/student/ProgressPage';
import { RecoverDiffPage } from '../pages/student/RecoverDiffPage';
import { RecoverPage } from '../pages/student/RecoverPage';
import { ReflectPage } from '../pages/student/ReflectPage';
import { SettingsPage } from '../pages/student/SettingsPage';
import { StudySessionPage } from '../pages/student/StudySessionPage';
import { TaskDetailPage } from '../pages/student/TaskDetailPage';
import { useAppStore } from '../store/AppStore';
import { RequireRole, homeFor } from './guards';

function RootRedirect() {
  const { state } = useAppStore();
  if (!state.authReady) return <div className="flex min-h-screen items-center justify-center text-muted">Đang kiểm tra phiên đăng nhập…</div>;
  return <Navigate to={homeFor(state.user?.role)} replace />;
}

export function AppRoutes() {
  return (
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
        <Route path="/plan/new" element={<PlanWizardPage />} />
        <Route path="/plan/generating" element={<PlanGeneratingPage />} />
        <Route path="/plan/preview" element={<PlanPreviewPage />} />
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
  );
}
