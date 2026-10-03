import { useEffect, useState } from 'react';
import { StatTile } from '../../components/domain/StatTile';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Textarea } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { Banner } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { confirmReflection, createReflection, type AgentResponse } from '../../services/api';
import { formatDM, formatHours } from '../../utils/time';
import { weekStats } from '../../utils/progress';
import { weeklyReflectionCycle } from '../../utils/weeklyReflection';

const QUESTIONS = [
  'Tuần này việc gì đã hoàn thành hoặc chưa hoàn thành?',
  'Nguyên nhân chính khiến kế hoạch đúng hoặc bị lệch?',
  'Tuần sau cần thay đổi thời lượng, khung giờ hay cách chia task nào?',
] as const;
const MAX = 500;

export function ReflectPage() {
  useDocumentTitle('Tổng kết tuần');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const courseId = 'all';
  const cycle = weeklyReflectionCycle(state.plan);
  const reflectionKey = `${courseId}:${cycle.weekStart}`;
  const currentReflection = state.reflections[reflectionKey]
    ?? Object.values(state.reflections).find((item) => item.courseId === courseId && item.weekStart === cycle.weekStart);
  const stats = weekStats(state.tasks, state.sessions, state.plan, cycle.weekStart);
  const [answers, setAnswers] = useState<[string, string, string]>(currentReflection?.answers ?? ['', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<AgentResponse | null>(null);
  const dirty = JSON.stringify(answers) !== JSON.stringify(currentReflection?.answers ?? ['', '', '']);

  useEffect(() => {
    setAnswers(currentReflection?.answers ?? ['', '', '']);
    setDraft(null);
    setError('');
  }, [reflectionKey, currentReflection?.savedAt]);

  const save = async () => {
    if (answers.every((a) => !a.trim())) {
      setError('Trả lời ít nhất một câu để lưu tổng kết.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await createReflection(
        answers.map((a) => a.trim()) as [string, string, string],
        {
          ...stats,
          week_start: cycle.weekStart,
          week_end: cycle.weekEnd,
          effective_week_start: cycle.effectiveWeekStart,
          timezone: 'Asia/Ho_Chi_Minh',
        },
      );
      setDraft(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa tạo được bản phản tư.');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      await confirmReflection();
      dispatch({
        type: 'SAVE_REFLECTION',
        courseId,
        weekStart: cycle.weekStart,
        effectiveWeekStart: cycle.effectiveWeekStart,
        answers: answers.map((a) => a.trim()) as [string, string, string],
        aiDraft: draft.reflection_draft ?? undefined,
        aiSummary: draft.response,
      });
      setDraft(null);
      toast({ tone: 'success', title: 'Đã lưu tổng kết tuần', description: `Điều chỉnh sẽ là đầu vào cho bản nháp tuần ${formatDM(cycle.effectiveWeekStart)}; PaceWise không tự áp dụng kế hoạch.` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa xác nhận được bản phản tư.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page max-w-4xl">
      <PageHeader
        title="Tổng kết tuần học"
        description={`Nhìn lại tất cả môn từ Thứ Hai ${formatDM(cycle.weekStart)} đến Chủ Nhật ${formatDM(cycle.weekEnd)}. Đây không phải đánh giá về tính cách hay năng lực.`}
      />
      <div className="mb-5">
        {cycle.isGracePeriod ? (
          <Banner tone="warning" icon="clock">
            Bạn đang dùng thời gian hoàn thành bù. Weekly Reflect đóng lúc 09:00 sáng nay.
          </Banner>
        ) : cycle.isOpen ? (
          <Banner tone="info" icon="clock">
            Weekly Reflect đã mở. Hoàn thành trong 5–10 phút để chuẩn bị bản nháp tuần sau.
          </Banner>
        ) : (
          <Banner tone="neutral" icon="clock">
            Weekly Reflect mở Chủ Nhật {formatDM(cycle.weekEnd)} lúc {cycle.opensAt}. Nếu có study block muộn, hệ thống mở sau block cuối cùng.
          </Banner>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon="checkCircle" label="Nhiệm vụ hoàn thành" value={`${stats.done} / ${stats.total}`} />
        <StatTile icon="clock" label="Phiên học" value={stats.sessionCount} />
        <StatTile icon="chart" label="Thời gian học" value={formatHours(stats.studiedMin)} />
        <StatTile icon="calendar" label="Kế hoạch dự kiến" value={formatHours(stats.plannedMin)} />
      </div>

      <Card className="mt-5" aria-labelledby="q">
        <CardHeader id="q" title="Ba câu hỏi" subtitle="Viết ngắn thôi — vài câu là đủ." />
        {currentReflection && !dirty && (
          <div className="mb-4">
            <Banner tone="success" icon="checkCircle">
              Đã lưu lúc {new Date(currentReflection.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}. Bạn vẫn có thể chỉnh sửa.
            </Banner>
          </div>
        )}
        <div className="space-y-5">
          {QUESTIONS.map((label, i) => (
            <Textarea
              key={label}
              label={`${i + 1}. ${label}`}
              value={answers[i]}
              maxLength={MAX}
              hint={`${answers[i].length}/${MAX} ký tự`}
              onChange={(e) => {
                const next = [...answers] as [string, string, string];
                next[i] = e.target.value;
                setAnswers(next);
              }}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-danger-ink">
            {error}
          </p>
        )}
        {draft && (
          <div className="mt-5 rounded-xl border border-[#D6E2FD] bg-primary-light p-4">
            <h3 className="font-semibold">Bản phản tư do AI đề xuất — chưa lưu</h3>
            <p className="mt-2 whitespace-pre-line text-sm">{draft.response}</p>
            <div className="mt-4 flex gap-3">
              <Button icon="check" onClick={confirm} loading={loading}>Xác nhận điều chỉnh</Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>Chỉnh lại câu trả lời</Button>
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button icon="check" onClick={save} loading={loading} disabled={!cycle.isOpen || (!!currentReflection && !dirty)}>
            Tạo bản phản tư
          </Button>
          {!cycle.isOpen && <span className="caption">Chưa đến cửa sổ tổng kết tuần</span>}
          {dirty && <span className="caption">Có thay đổi chưa lưu</span>}
        </div>
      </Card>
    </div>
  );
}
