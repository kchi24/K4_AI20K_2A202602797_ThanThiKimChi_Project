import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Logo } from '../../layouts/AppShell';
import { homeFor } from '../../routes/guards';
import { ApiError, login, syncCanvas } from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const demoAccounts = [
  { email: 'student@canvas.local', label: 'Sinh viên', icon: 'calendar' as const },
  { email: 'minh@canvas.local', label: 'SV Minh', icon: 'book' as const },
  { email: 'teacher@canvas.local', label: 'Giảng viên', icon: 'users' as const },
];

export function LoginPage() {
  useDocumentTitle('Đăng nhập');
  const { state, dispatch } = useAppStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);

  if (!state.authReady) return <div className="flex min-h-screen items-center justify-center text-muted">Đang kiểm tra phiên đăng nhập…</div>;
  if (state.user) return <Navigate to={homeFor(state.user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Nhập email để đăng nhập.';
    else if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Email chưa đúng định dạng.';
    if (!password) next.password = 'Nhập mật khẩu.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      const user = await login(email, password);
      dispatch({ type: 'LOGIN', user });
      if (user.role === 'student') {
        const synced = await syncCanvas();
        dispatch({ type: 'SYNC_CANVAS', courses: synced.courses, tasks: synced.tasks });
      }
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Chưa thể đăng nhập. Vui lòng thử lại.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <section className="relative overflow-hidden bg-primary-light px-6 py-10 sm:px-10 lg:flex lg:w-[46%] lg:flex-col lg:px-14 lg:py-14">
        <Logo />
        <div className="mt-10 lg:mt-auto">
          <h1 className="text-[30px] font-bold leading-tight tracking-tight sm:text-4xl">Lập kế hoạch học tập nhẹ nhàng hơn.</h1>
          <p className="mt-4 max-w-md text-[17px] text-slate-600">Biết việc cần làm tiếp theo, hiểu vì sao — và luôn là người quyết định cuối cùng.</p>
          <ul className="mt-8 hidden space-y-3 sm:block">
            {['Không có thay đổi nào được lưu khi bạn chưa xác nhận', 'Câu trả lời luôn kèm nguồn từ tài liệu môn học', 'Phát hiện sớm khi kế hoạch bị lệch'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-success-ink">
                  <Icon name="check" size={16} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:mt-auto" />
      </section>

      <section className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold">Đăng nhập</h2>
          <p className="mt-1 text-muted">Hệ thống tự nhận vai trò từ tài khoản của bạn.</p>
          <form className="mt-8 space-y-4" onSubmit={submit} noValidate>
            {errors.form && (
              <div role="alert" className="flex gap-2 rounded-xl border border-[#F6CFCF] bg-danger-light px-4 py-3 text-sm font-medium text-danger-ink">
                <Icon name="info" size={18} className="shrink-0" />
                {errors.form}
              </div>
            )}
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} placeholder="ten@truong.edu.vn" />
            <Input
              label="Mật khẩu"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />
            <Button type="submit" size="lg" block loading={loading}>
              Đăng nhập
            </Button>
          </form>

          <div className="mt-8 rounded-2xl border border-line bg-white p-4">
            <p className="text-sm font-semibold">Tài khoản demo</p>
            <p className="caption">Chọn để điền sẵn · mật khẩu: demo123</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {demoAccounts.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword('demo123');
                    setErrors({});
                  }}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold hover:border-[#C9D8FB] hover:bg-primary-light"
                >
                  <Icon name={a.icon} size={16} />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
