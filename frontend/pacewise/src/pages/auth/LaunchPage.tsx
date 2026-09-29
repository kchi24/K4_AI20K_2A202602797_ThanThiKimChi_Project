import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError, loginWithLaunch, syncCanvas } from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import { homeFor } from '../../routes/guards';

export function LaunchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { dispatch } = useAppStore();
  const [error, setError] = useState<ApiError | null>(null);
  const token = params.get('token') || '';

  const launch = useCallback(async () => {
    if (!token) {
      setError(new ApiError('UNAUTHENTICATED', 'Liên kết mở PaceWise không có launch token.'));
      return;
    }
    setError(null);
    try {
      const user = await loginWithLaunch(token);
      dispatch({ type: 'LOGIN', user });
      if (user.role === 'student') {
        const synced = await syncCanvas();
        dispatch({ type: 'SYNC_CANVAS', courses: synced.courses, tasks: synced.tasks, guidance: synced.guidance, courseData: synced.courseData });
      }
      navigate(homeFor(user.role), { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError('UNKNOWN', 'Không thể xác thực phiên Canvas.'));
    }
  }, [dispatch, navigate, token]);

  useEffect(() => { void launch(); }, [launch]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      {error ? (
        <ErrorState
          title="Không thể mở PaceWise từ Canvas"
          description={error.message}
          requestId={error.requestId}
          onRetry={() => void launch()}
          secondary={<Button variant="secondary" onClick={() => navigate('/login', { replace: true })}>Đăng nhập thủ công</Button>}
        />
      ) : (
        <LoadingState
          title="Đang kết nối Canvas với PaceWise"
          steps={['Xác thực launch token một lần', 'Khóa đúng vai trò và môn học', 'Đồng bộ dữ liệu học tập']}
          current={1}
          note="PaceWise không đưa service key LMS xuống trình duyệt."
        />
      )}
    </div>
  );
}
