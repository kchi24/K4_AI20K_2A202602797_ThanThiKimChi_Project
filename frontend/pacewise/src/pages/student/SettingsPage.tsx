import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  downloadPlanIcs,
  exportPlanToGoogleCalendar,
  getGoogleCalendarStatus,
  syncGoogleCalendarBusy,
  type GoogleCalendarStatus,
} from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import { addDays, formatDuration, toMin, weekdayName } from '../../utils/time';

export function SettingsPage() {
  useDocumentTitle('Cài đặt');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [calendar, setCalendar] = useState<GoogleCalendarStatus | null>(null);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);

  const weekStart = state.plan?.weekStart ?? new Date().toISOString().slice(0, 10);
  const calendarBlocks = useMemo(
    () =>
      (state.plan?.blocks ?? []).map((block) => ({
        blockId: block.id,
        title: `PaceWise: ${state.tasks.find((task) => task.id === block.taskId)?.title ?? 'Study block'}`,
        start: `${block.date}T${block.start}:00+07:00`,
        end: `${block.date}T${block.end}:00+07:00`,
      })),
    [state.plan, state.tasks],
  );

  const refreshCalendarStatus = async () => {
    try {
      setCalendar(await getGoogleCalendarStatus());
    } catch {
      setCalendar(null);
    } finally {
      setCalendarLoaded(true);
    }
  };

  useEffect(() => {
    void refreshCalendarStatus();
    const result = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('google_calendar');
    if (result) {
      toast({
        tone: result === 'connected' ? 'success' : 'danger',
        title: result === 'connected' ? 'Đã kết nối Google Calendar' : 'Chưa thể kết nối Google Calendar',
        description: result === 'denied' ? 'Bạn đã từ chối cấp quyền.' : result === 'error' ? 'OAuth không hoàn tất. Hãy thử kết nối lại.' : undefined,
      });
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/settings`);
    }
  }, []);

  const startGoogleConnect = async () => {
    setCalendarBusy(true);
    try {
      const result = await connectGoogleCalendar();
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast({ tone: 'danger', title: 'Không thể bắt đầu kết nối', description: error instanceof Error ? error.message : undefined });
      setCalendarBusy(false);
    }
  };

  const importBusyTime = async () => {
    setCalendarBusy(true);
    try {
      const result = await syncGoogleCalendarBusy(
        `${weekStart}T00:00:00+07:00`,
        `${addDays(weekStart, 7)}T00:00:00+07:00`,
      );
      const manualSlots = state.unavailable.filter((slot) => !slot.id.startsWith('google-'));
      dispatch({ type: 'SAVE_AVAILABILITY', availability: state.availability, unavailable: [...manualSlots, ...result.unavailableSlots] });
      toast({ tone: 'success', title: 'Đã nhập lịch bận', description: `${result.unavailableSlots.length} khoảng bận được dùng khi lập kế hoạch.` });
      await refreshCalendarStatus();
    } catch (error) {
      toast({ tone: 'danger', title: 'Không đọc được lịch bận', description: error instanceof Error ? error.message : undefined });
    } finally {
      setCalendarBusy(false);
    }
  };

  const exportBlocks = async () => {
    setCalendarBusy(true);
    try {
      const result = await exportPlanToGoogleCalendar(calendarBlocks);
      toast({
        tone: 'success',
        title: 'Đã cập nhật Google Calendar',
        description: `${result.created.length} sự kiện mới, ${result.skipped.length} sự kiện đã tồn tại.`,
      });
      setConfirmExport(false);
    } catch (error) {
      toast({ tone: 'danger', title: 'Không thể tạo sự kiện', description: error instanceof Error ? error.message : undefined });
    } finally {
      setCalendarBusy(false);
    }
  };

  const disconnectCalendar = async () => {
    setCalendarBusy(true);
    try {
      await disconnectGoogleCalendar();
      setCalendar((current) => current ? { ...current, connected: false, connectedAt: null, lastFreeBusySyncAt: null } : current);
      toast({ tone: 'success', title: 'Đã ngắt kết nối và thu hồi quyền Google' });
    } catch (error) {
      toast({ tone: 'danger', title: 'Chưa thể ngắt kết nối', description: error instanceof Error ? error.message : undefined });
    } finally {
      setCalendarBusy(false);
    }
  };

  const downloadIcs = async () => {
    setCalendarBusy(true);
    try {
      const file = await downloadPlanIcs(calendarBlocks);
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'pacewise-study-plan.ics';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ tone: 'success', title: 'Đã tải file lịch .ics' });
    } catch (error) {
      toast({ tone: 'danger', title: 'Không thể xuất file lịch', description: error instanceof Error ? error.message : undefined });
    } finally {
      setCalendarBusy(false);
    }
  };

  return (
    <div className="page max-w-3xl">
      <PageHeader title="Cài đặt" description="Tài khoản, thời gian rảnh mặc định và dữ liệu demo." />
      <div className="space-y-5">
        <Card aria-labelledby="acc">
          <CardHeader id="acc" title="Tài khoản" />
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="caption">Họ tên</dt>
              <dd className="font-medium">{state.user?.name}</dd>
            </div>
            <div>
              <dt className="caption">Email</dt>
              <dd className="break-all font-medium">{state.user?.email}</dd>
            </div>
            <div>
              <dt className="caption">Nguồn dữ liệu</dt>
              <dd className="font-medium">Canvas mô phỏng (chỉ đọc)</dd>
            </div>
            <div>
              <dt className="caption">Múi giờ</dt>
              <dd className="font-medium">GMT+7 (Asia/Ho_Chi_Minh)</dd>
            </div>
          </dl>
        </Card>

        <Card aria-labelledby="av">
          <CardHeader id="av" title="Thời gian rảnh mặc định" subtitle="Dùng khi tạo kế hoạch mới. Chỉnh trong bước 2 của trình tạo kế hoạch." />
          <ul className="divide-y divide-line">
            {state.availability.map((a) => (
              <li key={a.weekday} className="flex justify-between gap-3 py-2.5">
                <span>{weekdayName(a.weekday)}</span>
                <span className="font-medium tabular-nums">{a.enabled ? `${a.start}–${a.end} · ${formatDuration(toMin(a.end) - toMin(a.start))}` : 'Không rảnh'}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="google-calendar">
          <CardHeader
            id="google-calendar"
            title="Lịch cá nhân"
            subtitle="Kết nối Google Calendar hoặc tải file .ics dùng với ứng dụng lịch khác."
          />
          <div className="space-y-5">
            <section className="space-y-3" aria-labelledby="google-direct-title">
              <h3 id="google-direct-title" className="font-semibold">Kết nối trực tiếp</h3>
              {!calendarLoaded ? (
                <p className="text-sm text-muted">Đang kiểm tra trạng thái kết nối…</p>
              ) : !calendar?.configured ? (
                <div className="rounded-xl border border-warning/40 bg-warning-light p-4 text-sm text-warning-ink">
                  Quản trị viên chưa cấu hình Google OAuth. Bạn vẫn có thể tải file .ics bên dưới.
                </div>
              ) : !calendar.connected ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted">Tài khoản Google có thể khác tài khoản trường. PaceWise chỉ đọc busy/free và quản lý sự kiện do ứng dụng tạo.</p>
                  <Button icon="calendar" loading={calendarBusy} onClick={startGoogleConnect}>Kết nối Google Calendar</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-success/40 bg-success-light p-4 text-sm text-success-ink">
                    Đã kết nối{calendar.accountEmail ? <> với <strong>{calendar.accountEmail}</strong></> : ''}. PaceWise không sửa hoặc xóa sự kiện khác của bạn.
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="secondary" icon="refresh" loading={calendarBusy} onClick={importBusyTime}>Đọc lịch bận tuần này</Button>
                    <Button icon="calendar" disabled={!calendarBlocks.length} onClick={() => setConfirmExport(true)}>
                      Đưa kế hoạch lên Google
                    </Button>
                    <Button variant="danger" disabled={calendarBusy} onClick={disconnectCalendar}>Ngắt kết nối</Button>
                  </div>
                  {calendar.lastFreeBusySyncAt && <p className="caption">Đọc lịch bận gần nhất: {new Date(calendar.lastFreeBusySyncAt).toLocaleString('vi-VN')}</p>}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="ics-title">
              <div>
                <h3 id="ics-title" className="font-semibold">Xuất file lịch</h3>
                <p className="caption mt-1">Không cần Google OAuth; dùng được với Google Calendar, Outlook và Apple Calendar.</p>
              </div>
              <Button variant="secondary" icon="calendar" loading={calendarBusy} disabled={!calendarBlocks.length} onClick={downloadIcs}>
                Tải file .ics
              </Button>
            </section>
          </div>
        </Card>

        <Card aria-labelledby="privacy">
          <CardHeader id="privacy" title="Quyền riêng tư" />
          <ul className="list-disc space-y-1.5 pl-5 text-[15px]">
            <li>Giảng viên chỉ thấy số liệu tổng hợp của nhóm từ 5 sinh viên trở lên.</li>
            <li>Nội dung hỏi đáp và tổng kết tuần không hiển thị cho giảng viên.</li>
            <li>PaceWise không tự nộp bài, đổi deadline hay ghi điểm lên Canvas.</li>
          </ul>
        </Card>

      </div>
      <Modal
        open={confirmExport}
        onClose={() => !calendarBusy && setConfirmExport(false)}
        title="Xác nhận tạo sự kiện"
        description="Đây là hành động ghi dữ liệu ra Google Calendar."
        footer={(
          <>
            <Button variant="secondary" disabled={calendarBusy} onClick={() => setConfirmExport(false)}>Hủy</Button>
            <Button loading={calendarBusy} onClick={exportBlocks}>Xác nhận tạo {calendarBlocks.length} sự kiện</Button>
          </>
        )}
      >
        <div className="space-y-2 text-sm text-muted">
          {calendar?.accountEmail && <p>Tài khoản đích: <strong className="text-ink">{calendar.accountEmail}</strong></p>}
          <p>PaceWise sẽ tạo các study block của kế hoạch hiện tại. Những block đã xuất trước đó sẽ được bỏ qua để tránh trùng lịch.</p>
        </div>
      </Modal>
    </div>
  );
}
