import { useState } from 'react';
import { Icon } from '../ui/Icon';

type Theme = 'light' | 'dark';

const currentTheme = (): Theme => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

export function ThemeToggle({ sidebar = false }: { sidebar?: boolean }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next = theme === 'light' ? 'dark' : 'light';
  const toggle = () => {
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem('pacewise-theme', next);
    setTheme(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={sidebar
        ? 'relative flex h-11 w-full items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50 hover:text-ink'
        : 'relative flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-muted hover:bg-primary-light hover:text-primary-ink'}
      aria-label={`Chuyển sang giao diện ${next === 'dark' ? 'tối' : 'sáng'}`}
      title={`Chuyển sang giao diện ${next === 'dark' ? 'tối' : 'sáng'}`}
      aria-pressed={theme === 'dark'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
    </button>
  );
}
