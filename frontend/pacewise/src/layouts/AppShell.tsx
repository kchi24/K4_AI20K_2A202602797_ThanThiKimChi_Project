import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/ui/Icon';
import { Badge } from '../components/ui/Badge';
import { useAppStore } from '../store/AppStore';
import { logout as logoutApi } from '../services/api';
import { cx } from '../utils/cx';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
  end?: boolean;
  /** Shown directly in the mobile bottom bar (max 4, the rest go to "Thêm"). */
  primary?: boolean;
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-dark text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M3 15c3 0 3.5-7 6-7s3 8 6 8 3-5 6-5" />
        </svg>
      </span>
      {!compact && <span className="text-lg font-bold tracking-tight">PaceWise</span>}
    </span>
  );
}

export function AppShell({ items, roleLabel, roleTone, banner }: { items: NavItem[]; roleLabel: string; roleTone: 'primary' | 'accent'; banner?: ReactNode }) {
  const { state, dispatch } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const logout = async () => {
    try {
      await logoutApi();
    } finally {
      dispatch({ type: 'LOGOUT' });
      navigate('/login', { replace: true });
    }
  };
  const primary = items.filter((i) => i.primary).slice(0, 4);
  const rest = items.filter((i) => !primary.includes(i));

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors',
      isActive ? 'bg-primary-light font-semibold text-primary-ink' : 'text-slate-600 hover:bg-slate-50 hover:text-ink',
    );

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only z-50 rounded-lg bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Bỏ qua tới nội dung chính
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-line bg-white px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <div className="mt-6 rounded-2xl border border-line bg-canvas px-3 py-3">
          <Badge tone={roleTone} icon={roleTone === 'primary' ? 'book' : 'users'}>
            {roleLabel}
          </Badge>
          <p className="mt-2 truncate font-semibold">{state.user?.name}</p>
          <p className="caption truncate">{state.user?.email}</p>
        </div>
        <nav className="mt-6 flex flex-col gap-1" aria-label="Điều hướng chính">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={navClass}>
              <Icon name={i.icon} size={20} />
              <span className="flex-1">{i.label}</span>
              {!!i.badge && (
                <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-warning-light px-1.5 text-xs font-bold text-warning-ink" aria-label={`${i.badge} mục cần chú ý`}>
                  {i.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <button onClick={() => void logout()} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-slate-600 hover:bg-slate-50 hover:text-ink">
            <Icon name="logout" size={20} />
            Đăng xuất
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden">
        <Logo />
        <span className="flex-1" />
        <Badge tone={roleTone}>{roleLabel}</Badge>
      </header>

      <div className="min-w-0 flex-1">
        {banner}
        <main id="main" tabIndex={-1} className="focus:outline-none">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-[68px] grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Điều hướng chính">
        {primary.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) => cx('relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-primary-ink' : 'text-slate-500')}
          >
            <Icon name={i.icon} size={22} />
            {i.label}
            {!!i.badge && <span className="absolute right-[22%] top-2 h-2.5 w-2.5 rounded-full bg-warning" aria-label="Có mục cần chú ý" />}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={cx('relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold', rest.some((i) => location.pathname.startsWith(i.to)) ? 'text-primary-ink' : 'text-slate-500')}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <Icon name="menu" size={22} />
          Thêm
          {rest.some((i) => i.badge) && <span className="absolute right-[22%] top-2 h-2.5 w-2.5 rounded-full bg-warning" aria-hidden="true" />}
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Menu" className="w-full rounded-t-3xl bg-white px-4 pb-8 pt-3" onKeyDown={(e) => e.key === 'Escape' && setMoreOpen(false)}>
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" aria-hidden="true" />
            <nav className="flex flex-col gap-1">
              {rest.map((i) => (
                <NavLink key={i.to} to={i.to} className={navClass} autoFocus={i === rest[0]}>
                  <Icon name={i.icon} size={20} />
                  <span className="flex-1">{i.label}</span>
                  {!!i.badge && <Badge tone="warning">{i.badge}</Badge>}
                </NavLink>
              ))}
              <button onClick={() => void logout()} className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-slate-600 hover:bg-slate-50">
                <Icon name="logout" size={20} />
                Đăng xuất
              </button>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
