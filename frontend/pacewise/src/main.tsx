import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { AppRoutes } from './routes/AppRoutes';
import { AppStoreProvider } from './store/AppStore';
import './styles/index.css';

const savedTheme = window.localStorage.getItem('pacewise-theme');
const initialTheme = savedTheme === 'dark' || savedTheme === 'light'
  ? savedTheme
  : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
document.documentElement.dataset.theme = initialTheme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AppStoreProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AppStoreProvider>
    </HashRouter>
  </StrictMode>,
);
