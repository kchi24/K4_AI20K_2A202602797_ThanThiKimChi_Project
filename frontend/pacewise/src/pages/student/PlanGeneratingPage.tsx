import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { ApiError, generatePlan } from '../../services/api';
import { useAppStore } from '../../store/AppStore';

const STEPS = ['Đang phân tích lịch học...', 'Đang phân bổ thời gian...', 'Đang kiểm tra tính khả thi...'];
const HARD_TIMEOUT = 30000;

export function PlanGeneratingPage() {
  useDocumentTitle('Đang tạo kế hoạch');
  const { state, dispatch } = useAppStore();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<{ title: string; description: string; requestId?: string } | null>(null);
  const run = useRef(0);

  const start = useCallback(async () => {
    if (!state.wizardInput) return;
    const id = ++run.current;
    setError(null);
    setStep(0);
    const t1 = window.setTimeout(() => run.current === id && setStep(1), 900);
    const t2 = window.setTimeout(() => run.current === id && setStep(2), 1800);
    const timeout = new Promise<never>((_, rej) => window.setTimeout(() => rej(new ApiError('TIMEOUT', 'Tác vụ mất nhiều thời gian hơn dự kiến.')), HARD_TIMEOUT));
    try {
      const draft = await Promise.race([generatePlan(state.wizardInput, state.tasks), timeout]);
      if (run.current !== id) return;
      dispatch({ type: 'SET_DRAFT', draft });
      navigate('/plan/preview', { replace: true });
    } catch (e) {
      if (run.current !== id) return;
      const err = e instanceof ApiError ? e : new ApiError('AI_UNAVAILABLE', 'Chưa thể tạo kế hoạch.');
      setError({
        title: err.code === 'TIMEOUT' ? 'Tác vụ mất nhiều thời gian hơn dự kiến' : 'Chưa thể tạo kế hoạch',
        description: 'Dữ liệu bạn nhập vẫn được giữ lại và chưa có thay đổi nào được lưu. Bạn có thể thử lại với cùng dữ liệu.',
        requestId: err.requestId,
      });
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    }
  }, [state.wizardInput, state.tasks, dispatch, navigate]);

  useEffect(() => {
    start();
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state.wizardInput) return <Navigate to="/plan/new" replace />;

  return (
    <div className="page max-w-3xl">
      <PageHeader title="Tạo kế hoạch tuần" description="Bạn có thể rời màn hình này; dữ liệu nhập vẫn được giữ." />
      {error ? (
        <ErrorState
          title={error.title}
          description={error.description}
          requestId={error.requestId}
          onRetry={start}
          secondary={
            <Button variant="secondary" onClick={() => navigate('/plan/new')}>
              Quay lại chỉnh sửa
            </Button>
          }
        />
      ) : (
        <>
          <LoadingState title="Đang tạo bản nháp kế hoạch" steps={STEPS} current={step} note="Nếu quá 30 giây, hệ thống sẽ dừng an toàn và giữ nguyên dữ liệu bạn nhập." />
          <div className="mx-auto mt-4 max-w-xl">
            <Button
              variant="ghost"
              onClick={() => {
                run.current++;
                navigate('/plan/new');
              }}
            >
              Hủy và quay lại chỉnh sửa
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
