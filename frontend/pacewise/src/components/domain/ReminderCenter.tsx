import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../ui/Toast';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useAppStore } from '../../store/AppStore';
import type { Reminder } from '../../types';
import { activeReminders, buildReminders, selectBrowserDeliveries } from '../../utils/reminders';

const formatTime = (value: string) => new Date(value).toLocaleString('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});

const tone = (item: Reminder) => item.urgency === 'critical' ? 'danger' : item.urgency === 'urgent' ? 'warning' : 'primary';

export function ReminderCenter({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [clock, setClock] = useState(() => Date.now());
  const now = useMemo(() => new Date(clock), [clock]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const reminders = useMemo(() => buildReminders({
    now,
    plan: state.plan,
    tasks: state.tasks,
    courses: state.courses,
    courseData: state.courseData,
    sessions: state.sessions,
    planImpacts: state.planImpacts,
    studyBlockLeadMinutes: state.reminders.preferences.studyBlockLeadMinutes,
    digestHour: state.reminders.preferences.digestHour,
  }), [
    now,
    state.plan,
    state.tasks,
    state.courses,
    state.courseData,
    state.sessions,
    state.planImpacts,
    state.reminders.preferences.studyBlockLeadMinutes,
    state.reminders.preferences.digestHour,
  ]);

  const active = useMemo(() => activeReminders(reminders, now), [reminders, now]);
  const upcoming = useMemo(() => reminders
    .filter((item) => {
      const at = new Date(item.scheduledAt).getTime();
      return at > now.getTime() && at <= now.getTime() + 24 * 60 * 60 * 1000;
    })
    .slice(0, 3), [reminders, now]);
  const visible = active.length ? active : upcoming;
  const unread = active.filter((item) => !state.reminders.readIds.includes(item.id));

  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const deliveries = selectBrowserDeliveries(reminders, state.reminders, now);
    if (!deliveries.length) return;
    deliveries.forEach((item) => {
      const notification = new Notification(item.title, {
        body: item.message,
        tag: item.id,
      });
      notification.onclick = () => {
        window.focus();
        if (item.href) window.location.assign(item.href);
        notification.close();
      };
    });
    dispatch({
      type: 'RECORD_REMINDER_DELIVERY',
      ids: deliveries.map((item) => item.id),
      deliveredAt: now.toISOString(),
    });
  }, [dispatch, now, reminders, state.reminders]);

  const enableBrowserNotifications = async () => {
    if (typeof Notification === 'undefined') {
      toast({ tone: 'warning', title: 'Trình duyệt này không hỗ trợ thông báo.' });
      return;
    }
    const permission = await Notification.requestPermission();
    dispatch({ type: 'UPDATE_REMINDER_PREFERENCES', patch: { browserEnabled: permission === 'granted' } });
    toast({
      tone: permission === 'granted' ? 'success' : 'warning',
      title: permission === 'granted' ? 'Đã bật nhắc việc trên trình duyệt' : 'Chưa được cấp quyền thông báo',
      description: permission === 'granted' ? 'PaceWise giới hạn tối đa 3 thông báo chủ động mỗi ngày.' : 'Bạn vẫn xem được mọi nhắc việc trong PaceWise.',
    });
  };

  if (compact) {
    return (
      <details className="group relative">
        <summary
          className="relative flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl text-slate-600 marker:hidden hover:bg-primary-light hover:text-primary-ink"
          aria-label={`Nhắc việc${unread.length ? `, ${unread.length} chưa đọc` : ''}`}
          title="Nhắc việc"
        >
          <Icon name="bell" size={20} />
          {unread.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-ink">
              {unread.length > 9 ? '9+' : unread.length}
            </span>
          )}
        </summary>

        <div className="absolute right-0 top-12 z-50 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-light text-primary-ink"><Icon name="bell" size={17} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Nhắc việc</p>
              <p className="truncate text-xs text-muted">{active[0]?.title ?? upcoming[0]?.title ?? 'Không có cảnh báo mới'}</p>
            </div>
            {unread.length > 0 && (
              <button type="button" className="text-xs font-semibold text-primary-ink hover:underline" onClick={() => dispatch({ type: 'MARK_REMINDERS_READ', ids: unread.map((item) => item.id) })}>
                Đã đọc
              </button>
            )}
          </div>

          <div className="auto-hide-scrollbar max-h-[60vh] overflow-y-auto p-3">
            {visible.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-muted">Kế hoạch đang ổn. PaceWise sẽ báo khi có việc cần xử lý.</p>
            ) : (
              <ul className="space-y-2">
                {visible.slice(0, 5).map((item) => (
                  <li key={item.id} className="rounded-xl border border-line px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={tone(item)}>{item.urgency === 'critical' ? 'Khẩn' : item.urgency === 'urgent' ? 'Cần chú ý' : 'Sắp tới'}</Badge>
                      <span className="caption ml-auto">{formatTime(item.scheduledAt)}</span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{item.message}</p>
                    {item.href && (
                      <Link to={item.href} onClick={() => dispatch({ type: 'MARK_REMINDERS_READ', ids: [item.id] })} className="mt-2 inline-flex text-xs font-semibold text-primary-ink hover:underline">
                        {item.kind === 'missed_block' || item.kind === 'lms_change' || item.kind === 'deadline_2h' ? 'Mở Phục hồi' : 'Xem chi tiết'}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!state.reminders.preferences.browserEnabled && (
            <div className="border-t border-line p-3">
              <Button block size="sm" variant="secondary" icon="bell" onClick={() => void enableBrowserNotifications()}>Bật thông báo trình duyệt</Button>
            </div>
          )}
        </div>
      </details>
    );
  }

  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-10">
      <details className="group rounded-2xl border border-line bg-white shadow-card">
        <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-ink">
            <Icon name="bell" size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-semibold">
              Nhắc việc
              {unread.length > 0 && <Badge tone="warning">{unread.length} mới</Badge>}
            </span>
            <span className="caption block truncate">
              {active[0]?.title ?? upcoming[0] ? `Tiếp theo: ${(active[0] ?? upcoming[0]).title}` : 'Không có cảnh báo cần xử lý trong 24 giờ tới'}
            </span>
          </span>
          <Icon name="chevronDown" size={18} className="transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-line px-4 pb-4 pt-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="caption">Nhắc theo study block, deadline và thay đổi từ LMS · tối đa 3 thông báo/ngày</p>
            <div className="flex flex-wrap gap-2">
              {!state.reminders.preferences.browserEnabled && (
                <Button size="sm" variant="secondary" icon="bell" onClick={() => void enableBrowserNotifications()}>
                  Bật thông báo
                </Button>
              )}
              {unread.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dispatch({ type: 'MARK_REMINDERS_READ', ids: unread.map((item) => item.id) })}
                >
                  Đánh dấu đã đọc
                </Button>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-muted">Kế hoạch đang ổn. PaceWise sẽ nhắc khi có ca học, deadline hoặc thay đổi lịch cần chú ý.</p>
          ) : (
            <ul className="space-y-2">
              {visible.slice(0, 5).map((item) => (
                <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(item)}>{item.urgency === 'critical' ? 'Khẩn' : item.urgency === 'urgent' ? 'Cần chú ý' : 'Sắp tới'}</Badge>
                      <span className="caption">{formatTime(item.scheduledAt)}</span>
                    </div>
                    <p className="mt-1 font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{item.message}</p>
                  </div>
                  {item.href && (
                    <Link
                      to={item.href}
                      onClick={() => dispatch({ type: 'MARK_REMINDERS_READ', ids: [item.id] })}
                      className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-xl px-3 text-sm font-semibold text-primary-ink hover:bg-primary-light"
                    >
                      {item.kind === 'missed_block' || item.kind === 'lms_change' || item.kind === 'deadline_2h' ? 'Mở Phục hồi' : 'Xem chi tiết'}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
