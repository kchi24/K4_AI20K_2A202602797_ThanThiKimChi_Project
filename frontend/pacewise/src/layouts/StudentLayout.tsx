import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Banner } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useDerived } from '../hooks/useDerived';
import { syncCanvas } from '../services/api';
import { useAppStore } from '../store/AppStore';
import { AppShell, type NavItem } from './AppShell';

function StaleBanner() {
  const { dispatch } = useAppStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-10">
      <Banner
        tone="warning"
        icon="clock"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await syncCanvas();
              setBusy(false);
              dispatch({ type: 'UPDATE_SETTINGS', patch: { staleData: false, lastSync: r.syncedAt } });
              toast({ tone: 'success', title: 'Đã đồng bộ dữ liệu Canvas' });
            }}
          >
            Đồng bộ lại
          </Button>
        }
      >
        Dữ liệu Canvas được đồng bộ lần cuối lúc <strong>08:10, 29/09 (GMT+7)</strong> và có thể chưa phản ánh thay đổi mới.
      </Banner>
    </div>
  );
}

export function StudentLayout() {
  const { state } = useAppStore();
  const { drifts } = useDerived();
  const items: NavItem[] = [
    { to: '/dashboard', label: 'Tổng quan', icon: 'home', primary: true },
    { to: '/plan', label: 'Kế hoạch', icon: 'calendar', primary: true },
    { to: '/learn', label: 'Học tập', icon: 'book', primary: true },
    { to: '/progress', label: 'Tiến độ', icon: 'chart', primary: true },
    { to: '/recover', label: 'Phục hồi', icon: 'refresh', badge: drifts.length },
    { to: '/reflect', label: 'Tổng kết', icon: 'notebook' },
    { to: '/settings', label: 'Cài đặt', icon: 'settings' },
  ];
  return <AppShell items={items} roleLabel="Sinh viên" roleTone="primary" banner={state.settings.staleData ? <StaleBanner /> : null} />;
}
