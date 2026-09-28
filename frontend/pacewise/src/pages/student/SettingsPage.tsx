import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Switch } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { formatDuration, toMin, weekdayName } from '../../utils/time';

export function SettingsPage() {
  useDocumentTitle('Cài đặt');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const navigate = useNavigate();

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

        <Card aria-labelledby="privacy">
          <CardHeader id="privacy" title="Quyền riêng tư" />
          <ul className="list-disc space-y-1.5 pl-5 text-[15px]">
            <li>Giảng viên chỉ thấy số liệu tổng hợp của nhóm từ 5 sinh viên trở lên.</li>
            <li>Nội dung hỏi đáp và tổng kết tuần không hiển thị cho giảng viên.</li>
            <li>PaceWise không tự nộp bài, đổi deadline hay ghi điểm lên Canvas.</li>
          </ul>
        </Card>

        <Card aria-labelledby="demo">
          <CardHeader id="demo" title="Công cụ demo" subtitle="Mô phỏng các trạng thái để kiểm thử giao diện." />
          <div className="space-y-5">
            <Switch
              label="Mô phỏng lỗi dịch vụ AI"
              description="Tạo kế hoạch và hỏi đáp sẽ trả về lỗi để xem trạng thái Error / Thử lại."
              checked={state.settings.simulateAiError}
              onChange={(v) => dispatch({ type: 'UPDATE_SETTINGS', patch: { simulateAiError: v } })}
            />
            <Switch
              label="Mô phỏng dữ liệu Canvas cũ"
              description="Hiện banner dữ liệu có thể đã cũ trên mọi trang."
              checked={state.settings.staleData}
              onChange={(v) => dispatch({ type: 'UPDATE_SETTINGS', patch: { staleData: v } })}
            />
            <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row">
              <Button
                variant="secondary"
                icon="calendar"
                disabled={!state.plan}
                onClick={() => {
                  dispatch({ type: 'CLEAR_PLAN' });
                  toast({ tone: 'info', title: 'Đã gỡ kế hoạch hiện tại', description: 'Xem trạng thái “Chưa có kế hoạch”.' });
                  navigate('/dashboard');
                }}
              >
                Xem trạng thái chưa có kế hoạch
              </Button>
              <Button
                variant="danger"
                icon="refresh"
                onClick={() => {
                  dispatch({ type: 'RESET_DEMO' });
                  toast({ tone: 'success', title: 'Đã khôi phục dữ liệu demo' });
                }}
              >
                Khôi phục dữ liệu demo
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
